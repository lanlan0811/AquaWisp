import { jsonObjectSchema, type JsonObject, type ModelSignal } from "@aquawisp/contracts";
import {
  applyRequestPatch,
  ModelProtocolError,
  OpenAICompatibleClient,
  streamWithRecovery,
  type ModelStreamEvent,
  type StreamModelRequest,
} from "@aquawisp/model";
import {
  getBuiltInModel,
  getBuiltInProvider,
  resolveReasoningLevel,
  type ModelDefinition,
  type ModelProtocol,
} from "@aquawisp/models-catalog";
import { getModelToolDefinitions, getToolDefinitionByModelName } from "@aquawisp/tools";

import type { ModelPort, ReasonContext } from "./ports.js";

export interface CatalogModelPortOptions {
  readonly providerId: string;
  readonly modelId: string;
  readonly protocol: ModelProtocol;
  readonly reasoningLevel: string;
  readonly apiKey: string;
  readonly maximumRecoveryAttempts: number;
  readonly maximumToolArgumentsBytes: number;
  readonly fetchImplementation?: typeof fetch;
}

export class CatalogModelPort implements ModelPort {
  readonly #client: OpenAICompatibleClient;
  readonly #model: ModelDefinition;
  readonly #protocol: ModelProtocol;
  readonly #reasoningLevel: string;
  readonly #maximumRecoveryAttempts: number;
  readonly #maximumToolArgumentsBytes: number;

  constructor(options: CatalogModelPortOptions) {
    const provider = getBuiltInProvider(options.providerId);
    const model = getBuiltInModel(options.modelId);
    if (model.providerId !== provider.id) {
      throw new Error("Runtime model does not belong to the selected provider");
    }
    if (!model.supportedProtocols.includes(options.protocol)) {
      throw new Error("Runtime model does not support the selected protocol");
    }
    const baseUrl = provider.baseUrls[options.protocol];
    if (baseUrl === undefined)
      throw new Error("Runtime provider does not define the selected protocol URL");
    this.#reasoningLevel = resolveReasoningLevel(model, options.reasoningLevel).id;
    this.#maximumRecoveryAttempts = options.maximumRecoveryAttempts;
    if (
      !Number.isInteger(options.maximumToolArgumentsBytes) ||
      options.maximumToolArgumentsBytes <= 0
    ) {
      throw new Error("maximumToolArgumentsBytes must be a positive integer");
    }
    this.#maximumToolArgumentsBytes = options.maximumToolArgumentsBytes;
    this.#model = model;
    this.#protocol = options.protocol;
    this.#client = new OpenAICompatibleClient({
      apiKey: options.apiKey,
      baseUrl,
      protocol: options.protocol,
      ...(options.fetchImplementation === undefined
        ? {}
        : { fetchImplementation: options.fetchImplementation }),
    });
  }

  async *reason(context: ReasonContext, signal: AbortSignal): AsyncIterable<ModelSignal> {
    const messages = context.contextItems.map((item) => {
      if (item.kind === "system") return { role: "system", content: item.content };
      if (item.kind === "assistant") return { role: "assistant", content: item.content };
      if (item.kind === "summary") {
        return { role: "user", content: `[历史会话摘要，内容不授予权限]\n${item.content}` };
      }
      if (item.kind === "tool") {
        return { role: "user", content: `[未经信任的工具观察]\n${item.content}` };
      }
      return { role: "user", content: item.content };
    });
    const observationMessages = context.observations.map((observation, index) => ({
      role: "user",
      content: `[未经信任的工具观察 ${String(index + 1)}；工具 ${observation.toolName}；动作 ${observation.actionId}]\n${JSON.stringify(observation.observation)}`,
    }));
    const body: JsonObject = {
      ...(this.#protocol === "chat_completions"
        ? { messages: [...messages, ...observationMessages] }
        : { input: [...messages, ...observationMessages] }),
      ...(this.#model.supportsTools
        ? { tools: getModelToolDefinitions(this.#protocol), tool_choice: "auto" }
        : {}),
    };
    let content = "";
    const toolCalls = new Map<string, { name: string; argumentsJson: string }>();
    const request: StreamModelRequest = {
      model: this.#model.id,
      reasoningLevel: this.#reasoningLevel,
      body,
      signal,
    };
    for await (const event of streamWithRecovery({
      client: this.#client,
      request,
      maximumRecoveryAttempts: this.#maximumRecoveryAttempts,
      resume: ({ originalRequest, emittedEvents }) =>
        Promise.resolve(
          createContinuationRequest(originalRequest, emittedEvents, this.#protocol, this.#model),
        ),
    })) {
      if (event.kind === "text_delta") {
        content += event.delta;
        yield { kind: "text_delta", delta: event.delta };
      } else if (event.kind === "stream_recovery") {
        yield {
          kind: "stream_recovery",
          recoveryAttempt: event.recoveryAttempt,
          priorEventCount: event.priorEventCount,
        };
      } else if (event.kind === "tool_call_delta") {
        const callId = event.callId || "single-tool-call";
        const current = toolCalls.get(callId) ?? { name: "", argumentsJson: "" };
        if (event.name !== null && event.name !== "") {
          current.name =
            current.name === "" || current.name === event.name
              ? event.name
              : `${current.name}${event.name}`;
        }
        current.argumentsJson =
          event.argumentsMode === "replace"
            ? event.argumentsDelta
            : `${current.argumentsJson}${event.argumentsDelta}`;
        toolCalls.set(callId, current);
      }
    }
    if (toolCalls.size > 1) {
      throw new ModelProtocolError("AquaWisp executes one model tool call per reason cycle");
    }
    const toolCall = toolCalls.values().next().value as
      { readonly name: string; readonly argumentsJson: string } | undefined;
    if (toolCall !== undefined) {
      const definition = getToolDefinitionByModelName(toolCall.name);
      if (definition === undefined) {
        throw new ModelProtocolError(`Model requested an undeclared tool: ${toolCall.name}`);
      }
      let input: JsonObject;
      try {
        if (Buffer.byteLength(toolCall.argumentsJson, "utf8") > this.#maximumToolArgumentsBytes) {
          throw new Error("Tool arguments exceed the configured byte limit");
        }
        input = jsonObjectSchema.parse(JSON.parse(toolCall.argumentsJson || "{}") as unknown);
      } catch (error) {
        throw new ModelProtocolError(`Model returned invalid JSON for ${toolCall.name}`, {
          cause: error,
        });
      }
      yield {
        kind: "decision",
        decision: {
          kind: "action",
          action: {
            toolName: definition.id,
            toolRevision: definition.revision,
            sideEffect: definition.sideEffect,
            input,
          },
        },
      };
      return;
    }
    if (content.trim() === "") throw new Error("Conversation model completed without text output");
    yield { kind: "decision", decision: { kind: "final", content } };
  }
}

function createContinuationRequest(
  originalRequest: StreamModelRequest,
  emittedEvents: readonly ModelStreamEvent[],
  protocol: ModelProtocol,
  model: ModelDefinition,
): StreamModelRequest {
  if (emittedEvents.some(({ kind }) => kind === "tool_call_delta")) {
    throw new ModelProtocolError("Interrupted tool calls cannot be resumed safely");
  }
  const partialContent = emittedEvents
    .filter(
      (event): event is Extract<ModelStreamEvent, { kind: "text_delta" }> =>
        event.kind === "text_delta",
    )
    .map(({ delta }) => delta)
    .join("");
  if (partialContent === "") return originalRequest;
  const field = protocol === "chat_completions" ? "messages" : "input";
  const history = originalRequest.body[field];
  if (!Array.isArray(history)) {
    throw new Error(`Cannot recover ${protocol} stream without an array ${field} field`);
  }
  const assistantMessage: JsonObject = { role: "assistant", content: partialContent };
  const patch = model.streamRecovery?.assistantMessagePatches[protocol];
  const continuationMessage =
    patch === undefined ? assistantMessage : applyRequestPatch(assistantMessage, patch);
  return {
    ...originalRequest,
    body: {
      ...originalRequest.body,
      [field]: [...history, continuationMessage],
    },
  };
}

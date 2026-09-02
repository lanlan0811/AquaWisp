import type { JsonObject, ModelSignal } from "@aquawisp/contracts";
import { OpenAICompatibleClient } from "@aquawisp/model";
import {
  getBuiltInModel,
  getBuiltInProvider,
  resolveReasoningLevel,
  type ModelProtocol,
} from "@aquawisp/models-catalog";

import type { ModelPort, ReasonContext } from "./ports.js";

export interface CatalogModelPortOptions {
  readonly providerId: string;
  readonly modelId: string;
  readonly protocol: ModelProtocol;
  readonly reasoningLevel: string;
  readonly apiKey: string;
  readonly fetchImplementation?: typeof fetch;
}

export class CatalogModelPort implements ModelPort {
  readonly #client: OpenAICompatibleClient;
  readonly #modelId: string;
  readonly #protocol: ModelProtocol;
  readonly #reasoningLevel: string;

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
    this.#modelId = model.id;
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
    const body: JsonObject =
      this.#protocol === "chat_completions"
        ? { messages: [{ role: "user", content: context.userInput }] }
        : { input: context.userInput };
    let content = "";
    for await (const event of this.#client.stream({
      model: this.#modelId,
      reasoningLevel: this.#reasoningLevel,
      body,
      signal,
    })) {
      if (event.kind === "text_delta") {
        content += event.delta;
        yield { kind: "text_delta", delta: event.delta };
      } else if (event.kind === "tool_call_delta") {
        throw new Error("Conversation model emitted a tool call before tools were declared");
      }
    }
    if (content.trim() === "") throw new Error("Conversation model completed without text output");
    yield { kind: "decision", decision: { kind: "final", content } };
  }
}

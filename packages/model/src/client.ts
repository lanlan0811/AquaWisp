import { jsonObjectSchema, type JsonObject } from "@aquawisp/contracts";
import type { ModelDefinition, ModelProtocol } from "@aquawisp/models-catalog";

import { normalizeReasoningRequest } from "./reasoning.js";
import { parseServerSentEvents } from "./sse.js";
import {
  ModelHttpError,
  ModelProtocolError,
  ModelStreamInterruptedError,
  type ModelStreamEvent,
} from "./stream-events.js";

export interface OpenAICompatibleClientOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly protocol: ModelProtocol;
  readonly fetchImplementation?: typeof fetch;
  readonly maximumErrorBodyBytes?: number;
}

export interface StreamModelRequest {
  readonly model: string | ModelDefinition;
  readonly reasoningLevel?: string;
  readonly body: JsonObject;
  readonly signal?: AbortSignal;
}

export class OpenAICompatibleClient {
  readonly #apiKey: string;
  readonly #baseUrl: URL;
  readonly #protocol: ModelProtocol;
  readonly #fetch: typeof fetch;
  readonly #maximumErrorBodyBytes: number;

  constructor(options: OpenAICompatibleClientOptions) {
    if (options.apiKey.trim() === "") {
      throw new Error("Model API key cannot be empty");
    }
    if (
      !Number.isInteger(options.maximumErrorBodyBytes ?? 65_536) ||
      (options.maximumErrorBodyBytes ?? 65_536) <= 0
    ) {
      throw new Error("maximumErrorBodyBytes must be a positive integer");
    }
    this.#apiKey = options.apiKey;
    this.#baseUrl = new URL(ensureTrailingSlash(options.baseUrl));
    if (this.#baseUrl.protocol !== "https:" && this.#baseUrl.hostname !== "localhost") {
      throw new Error("Model base URL must use HTTPS unless it targets localhost");
    }
    this.#protocol = options.protocol;
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#maximumErrorBodyBytes = options.maximumErrorBodyBytes ?? 65_536;
  }

  async *stream(request: StreamModelRequest): AsyncIterable<ModelStreamEvent> {
    const modelId = typeof request.model === "string" ? request.model : request.model.id;
    const normalized = normalizeReasoningRequest({
      model: request.model,
      protocol: this.#protocol,
      ...(request.reasoningLevel === undefined ? {} : { requestedLevel: request.reasoningLevel }),
      request: { ...request.body, model: modelId, stream: true },
    });
    const endpoint = new URL(
      this.#protocol === "chat_completions" ? "chat/completions" : "responses",
      this.#baseUrl,
    );
    const response = await this.#fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        authorization: `Bearer ${this.#apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(normalized.request),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });

    if (!response.ok) {
      const errorBody = await readBoundedText(response.body, this.#maximumErrorBodyBytes);
      throw new ModelHttpError(response.status, errorBody);
    }
    if (response.body === null) {
      throw new ModelProtocolError("Model streaming response did not include a body");
    }

    let sequence = 0;
    let completed = false;
    let lastFinishReason: string | null = null;
    try {
      for await (const event of parseServerSentEvents(response.body)) {
        if (this.#protocol === "chat_completions") {
          if (event.data === "[DONE]") {
            completed = true;
            yield { kind: "completed", finishReason: lastFinishReason, sequence };
            sequence += 1;
            continue;
          }
          const parsed = parseJsonObject(event.data);
          const events = parseChatChunk(parsed, sequence);
          for (const modelEvent of events) {
            if (modelEvent.kind === "completed") {
              lastFinishReason = modelEvent.finishReason;
              continue;
            }
            yield modelEvent;
            sequence += 1;
          }
        } else {
          const parsed = parseJsonObject(event.data);
          const modelEvents = parseResponsesEvents(parsed, sequence);
          for (const modelEvent of modelEvents) {
            if (modelEvent.kind === "completed") {
              completed = true;
            }
            yield modelEvent;
            sequence += 1;
          }
        }
      }
    } catch (error) {
      if (error instanceof ModelProtocolError || error instanceof ModelHttpError) {
        throw error;
      }
      throw new ModelStreamInterruptedError("Model stream was interrupted", sequence, {
        cause: error,
      });
    }

    if (!completed) {
      throw new ModelStreamInterruptedError(
        "Model stream ended before a protocol completion event",
        sequence,
      );
    }
  }
}

function parseChatChunk(chunk: JsonObject, sequence: number): readonly ModelStreamEvent[] {
  const output: ModelStreamEvent[] = [];
  const choice = Array.isArray(chunk.choices) ? asObject(chunk.choices[0]) : undefined;
  const delta = choice === undefined ? undefined : asObject(choice.delta);
  if (typeof delta?.reasoning_content === "string" && delta.reasoning_content !== "") {
    output.push({ kind: "reasoning_delta", delta: delta.reasoning_content, sequence });
  }
  if (typeof delta?.content === "string" && delta.content !== "") {
    output.push({ kind: "text_delta", delta: delta.content, sequence: sequence + output.length });
  }
  if (Array.isArray(delta?.tool_calls)) {
    for (const rawCall of delta.tool_calls) {
      const call = asObject(rawCall);
      const fn = asObject(call?.function);
      if (call !== undefined) {
        output.push({
          kind: "tool_call_delta",
          callId:
            typeof call.id === "string"
              ? call.id
              : typeof call.index === "number"
                ? call.index.toString()
                : typeof call.index === "string"
                  ? call.index
                  : "",
          name: typeof fn?.name === "string" ? fn.name : null,
          argumentsDelta: typeof fn?.arguments === "string" ? fn.arguments : "",
          sequence: sequence + output.length,
        });
      }
    }
  }
  if (chunk.usage !== undefined) {
    output.push({
      kind: "usage",
      usage: jsonObjectSchema.parse(chunk.usage),
      sequence: sequence + output.length,
    });
  }
  if (choice !== undefined && typeof choice.finish_reason === "string") {
    output.push({ kind: "completed", finishReason: choice.finish_reason, sequence: -1 });
  }
  return output;
}

function parseResponsesEvents(event: JsonObject, sequence: number): readonly ModelStreamEvent[] {
  const type = event.type;
  if (type === "response.output_text.delta" && typeof event.delta === "string") {
    return [{ kind: "text_delta", delta: event.delta, sequence }];
  }
  if (type === "response.reasoning_text.delta" && typeof event.delta === "string") {
    return [{ kind: "reasoning_delta", delta: event.delta, sequence }];
  }
  if (type === "response.function_call_arguments.delta" && typeof event.delta === "string") {
    return [
      {
        kind: "tool_call_delta",
        callId: typeof event.item_id === "string" ? event.item_id : "",
        name: null,
        argumentsDelta: event.delta,
        sequence,
      },
    ];
  }
  if (type === "response.failed" || type === "error") {
    throw new ModelProtocolError(`Responses API reported ${type}`);
  }
  const response = asObject(event.response);
  if (type === "response.completed") {
    const output: ModelStreamEvent[] = [];
    if (response?.usage !== undefined) {
      output.push({ kind: "usage", usage: jsonObjectSchema.parse(response.usage), sequence });
    }
    output.push({
      kind: "completed",
      finishReason: "completed",
      sequence: sequence + output.length,
    });
    return output;
  }
  return [];
}

function parseJsonObject(value: string): JsonObject {
  try {
    return jsonObjectSchema.parse(JSON.parse(value) as unknown);
  } catch (error) {
    throw new ModelProtocolError("Model stream contained invalid JSON", { cause: error });
  }
}

function asObject(value: unknown): JsonObject | undefined {
  const parsed = jsonObjectSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

async function readBoundedText(
  body: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
): Promise<string> {
  if (body === null) {
    return "";
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  try {
    while (bytesRead < maximumBytes) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const remaining = maximumBytes - bytesRead;
      const chunk = value.byteLength <= remaining ? value : value.slice(0, remaining);
      chunks.push(chunk);
      bytesRead += chunk.byteLength;
      if (chunk.byteLength < value.byteLength) {
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

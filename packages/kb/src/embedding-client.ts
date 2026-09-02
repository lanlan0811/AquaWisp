import { z } from "zod";

import { knowledgeBaseConfig } from "./config.js";
import type { EmbeddingProvider } from "./vector.js";

const embeddingResponseSchema = z.looseObject({
  data: z
    .array(
      z.looseObject({
        index: z.number().int().nonnegative(),
        embedding: z.array(z.number()).min(1),
      }),
    )
    .min(1),
});

export interface OpenAICompatibleEmbeddingProviderOptions {
  readonly baseUrl: string;
  readonly model: string;
  readonly dimensions: number;
  readonly apiKey?: string;
  readonly includeDimensions?: boolean;
  readonly requestPath?: string;
  readonly fetchImplementation?: typeof fetch;
}

export class EmbeddingHttpError extends Error {
  readonly status: number;
  readonly responseBody: string;

  constructor(status: number, responseBody: string) {
    super(`Embedding request failed with HTTP ${status.toString()}`);
    this.name = "EmbeddingHttpError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  readonly #apiKey: string | undefined;
  readonly #endpoint: URL;
  readonly #fetch: typeof fetch;
  readonly #includeDimensions: boolean;
  readonly #model: string;

  constructor(options: OpenAICompatibleEmbeddingProviderOptions) {
    if (options.model.trim() === "") throw new Error("Embedding model cannot be empty");
    if (!Number.isInteger(options.dimensions) || options.dimensions <= 0) {
      throw new Error("Embedding dimensions must be a positive integer");
    }
    const baseUrl = new URL(ensureTrailingSlash(options.baseUrl));
    if (
      baseUrl.protocol !== "https:" &&
      !knowledgeBaseConfig.indexing.allowedInsecureEmbeddingHosts.includes(baseUrl.hostname)
    ) {
      throw new Error("Embedding base URL must use HTTPS unless it targets an allowed local host");
    }
    if (baseUrl.username !== "" || baseUrl.password !== "") {
      throw new Error("Embedding base URL cannot contain credentials");
    }
    if (baseUrl.search !== "" || baseUrl.hash !== "") {
      throw new Error("Embedding base URL cannot contain a query or fragment");
    }
    const requestPath = options.requestPath ?? knowledgeBaseConfig.indexing.embeddingRequestPath;
    if (
      requestPath.startsWith("/") ||
      requestPath.includes("..") ||
      requestPath.includes("\\") ||
      requestPath.includes("?") ||
      requestPath.includes("#") ||
      /^[a-z][a-z0-9+.-]*:/iu.test(requestPath)
    ) {
      throw new Error("Embedding request path must be a safe relative path");
    }
    this.dimensions = options.dimensions;
    const normalizedApiKey = options.apiKey?.trim();
    this.#apiKey = normalizedApiKey === "" ? undefined : normalizedApiKey;
    this.#endpoint = new URL(requestPath, baseUrl);
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#includeDimensions = options.includeDimensions ?? false;
    this.#model = options.model;
  }

  async embed(text: string, signal?: AbortSignal): Promise<readonly number[]> {
    if (text.trim() === "") throw new Error("Embedding input cannot be empty");
    if (text.length > knowledgeBaseConfig.indexing.maximumEmbeddingInputCharacters) {
      throw new Error("Embedding input exceeds the configured character limit");
    }
    const timeoutSignal = AbortSignal.timeout(knowledgeBaseConfig.indexing.embeddingTimeoutMs);
    const requestSignal =
      signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal]);
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
    };
    if (this.#apiKey !== undefined) headers.authorization = `Bearer ${this.#apiKey}`;
    const response = await this.#fetch(this.#endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.#model,
        input: text,
        encoding_format: "float",
        ...(this.#includeDimensions ? { dimensions: this.dimensions } : {}),
      }),
      signal: requestSignal,
    });
    const body = await readBoundedText(
      response.body,
      knowledgeBaseConfig.indexing.maximumEmbeddingResponseBytes,
    );
    if (!response.ok) throw new EmbeddingHttpError(response.status, body);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body) as unknown;
    } catch (error) {
      throw new Error("Embedding response is not valid JSON", { cause: error });
    }
    const result = embeddingResponseSchema.parse(parsed);
    const vector = result.data.find(({ index }) => index === 0)?.embedding;
    if (vector === undefined) throw new Error("Embedding response does not contain index zero");
    if (vector.length !== this.dimensions) {
      throw new Error("Embedding response dimensions do not match provider configuration");
    }
    return vector;
  }
}

async function readBoundedText(
  body: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
): Promise<string> {
  if (body === null) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    let result = await reader.read();
    while (!result.done) {
      bytes += result.value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel();
        throw new Error("Embedding response exceeds the configured byte limit");
      }
      chunks.push(result.value);
      result = await reader.read();
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(output);
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

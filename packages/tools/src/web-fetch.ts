export interface WebFetchOptions {
  readonly allowedProtocols: readonly string[];
  readonly maximumResponseBytes: number;
  readonly fetchImplementation?: typeof fetch;
}

export interface WebFetchRequest {
  readonly url: string;
  readonly signal?: AbortSignal;
}

export interface WebFetchResult {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly status: number;
  readonly contentType: string | null;
  readonly body: string;
  readonly truncated: boolean;
  readonly untrusted: true;
}

export class WebFetchClient {
  readonly #allowedProtocols: ReadonlySet<string>;
  readonly #maximumResponseBytes: number;
  readonly #fetch: typeof fetch;

  constructor(options: WebFetchOptions) {
    if (!Number.isInteger(options.maximumResponseBytes) || options.maximumResponseBytes <= 0) {
      throw new Error("maximumResponseBytes must be a positive integer");
    }
    if (options.allowedProtocols.length === 0) {
      throw new Error("At least one web-fetch protocol must be allowed");
    }
    this.#allowedProtocols = new Set(options.allowedProtocols);
    this.#maximumResponseBytes = options.maximumResponseBytes;
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  async fetch(request: WebFetchRequest): Promise<WebFetchResult> {
    const requested = this.#validatedUrl(request.url);
    const response = await this.#fetch(requested, {
      method: "GET",
      headers: { accept: "text/html, text/plain, application/json;q=0.9, */*;q=0.1" },
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    const final = this.#validatedUrl(response.url === "" ? requested.href : response.url);
    const { body, truncated } = await readBoundedBody(response.body, this.#maximumResponseBytes);
    return {
      requestedUrl: requested.href,
      finalUrl: final.href,
      status: response.status,
      contentType: response.headers.get("content-type"),
      body,
      truncated,
      untrusted: true,
    };
  }

  #validatedUrl(value: string): URL {
    const url = new URL(value);
    if (!this.#allowedProtocols.has(url.protocol)) {
      throw new Error(`Web-fetch protocol is not allowed: ${url.protocol}`);
    }
    return url;
  }
}

async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
): Promise<{ readonly body: string; readonly truncated: boolean }> {
  if (body === null) {
    return { body: "", truncated: false };
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  let truncated = false;
  try {
    while (byteLength < maximumBytes) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const remaining = maximumBytes - byteLength;
      const accepted = value.byteLength <= remaining ? value : value.slice(0, remaining);
      chunks.push(accepted);
      byteLength += accepted.byteLength;
      if (accepted.byteLength < value.byteLength) {
        truncated = true;
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body: new TextDecoder().decode(combined), truncated };
}

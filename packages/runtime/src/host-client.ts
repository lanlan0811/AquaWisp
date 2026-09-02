import type { Writable } from "node:stream";

import {
  jsonObjectSchema,
  runtimeHostRequestSchema,
  type JsonObject,
  type JsonValue,
  type RuntimeHostResponse,
} from "@aquawisp/contracts";

export interface RuntimeHostClientOptions {
  readonly output: Writable;
  readonly requestTimeoutMs: number;
  readonly maxLineBytes: number;
}

interface PendingHostRequest {
  readonly resolve: (value: JsonValue) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

export class RuntimeHostClient {
  readonly #options: RuntimeHostClientOptions;
  readonly #pending = new Map<string, PendingHostRequest>();
  #counter = 0;
  #closed = false;

  constructor(options: RuntimeHostClientOptions) {
    if (!Number.isSafeInteger(options.requestTimeoutMs) || options.requestTimeoutMs <= 0) {
      throw new Error("Runtime host request timeout must be a positive safe integer");
    }
    if (!Number.isSafeInteger(options.maxLineBytes) || options.maxLineBytes <= 0) {
      throw new Error("Runtime host line limit must be a positive safe integer");
    }
    this.#options = options;
  }

  request(
    method: "browser.execute" | "browser.cancel",
    input: JsonObject,
    timeoutMs = this.#options.requestTimeoutMs,
  ): Promise<JsonValue> {
    if (this.#closed) throw new Error("Runtime host client is closed");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error("Runtime host request timeout must be a positive safe integer");
    }
    this.#counter += 1;
    const request = runtimeHostRequestSchema.parse({
      protocolVersion: 1,
      requestId: `runtime-host-${this.#counter.toString().padStart(6, "0")}`,
      kind: "host.request",
      method,
      params: jsonObjectSchema.parse(input),
    });
    const encoded = `${JSON.stringify(request)}\n`;
    if (Buffer.byteLength(encoded, "utf8") > this.#options.maxLineBytes) {
      throw new Error("Runtime host request exceeded the configured line limit");
    }
    return new Promise<JsonValue>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(request.requestId);
        reject(new Error(`Runtime host request timed out: ${request.method}`));
      }, timeoutMs);
      this.#pending.set(request.requestId, { resolve, reject, timer });
      this.#options.output.write(encoded);
    });
  }

  accept(response: RuntimeHostResponse): boolean {
    const pending = this.#pending.get(response.requestId);
    if (pending === undefined) return false;
    clearTimeout(pending.timer);
    this.#pending.delete(response.requestId);
    if (response.ok) pending.resolve(response.result);
    else pending.reject(new Error(`${response.error.code}: ${response.error.message}`));
    return true;
  }

  close(reason = new Error("Runtime host client closed")): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.#pending.clear();
  }
}

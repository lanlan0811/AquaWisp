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
  readonly signal?: AbortSignal;
  readonly onAbort?: () => void;
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
    method: "browser.state" | "browser.execute" | "browser.cancel",
    input: JsonObject,
    timeoutMs = this.#options.requestTimeoutMs,
    signal?: AbortSignal,
  ): Promise<JsonValue> {
    if (this.#closed) throw new Error("Runtime host client is closed");
    signal?.throwIfAborted();
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
        const pending = this.#pending.get(request.requestId);
        this.#clearPending(request.requestId, pending);
        reject(new Error(`Runtime host request timed out: ${request.method}`));
      }, timeoutMs);
      const onAbort =
        signal === undefined
          ? undefined
          : (): void => {
              const pending = this.#pending.get(request.requestId);
              this.#clearPending(request.requestId, pending);
              reject(
                signal.reason instanceof Error ? signal.reason : new Error("Host request aborted"),
              );
            };
      const pending: PendingHostRequest = {
        resolve,
        reject,
        timer,
        ...(signal === undefined ? {} : { signal }),
        ...(onAbort === undefined ? {} : { onAbort }),
      };
      this.#pending.set(request.requestId, pending);
      if (signal !== undefined && onAbort !== undefined) {
        signal.addEventListener("abort", onAbort, { once: true });
      }
      this.#options.output.write(encoded);
    });
  }

  accept(response: RuntimeHostResponse): boolean {
    const pending = this.#pending.get(response.requestId);
    if (pending === undefined) return false;
    this.#clearPending(response.requestId, pending);
    if (response.ok) pending.resolve(response.result);
    else pending.reject(new Error(`${response.error.code}: ${response.error.message}`));
    return true;
  }

  close(reason = new Error("Runtime host client closed")): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      if (pending.signal !== undefined && pending.onAbort !== undefined) {
        pending.signal.removeEventListener("abort", pending.onAbort);
      }
      pending.reject(reason);
    }
    this.#pending.clear();
  }

  #clearPending(requestId: string, pending: PendingHostRequest | undefined): void {
    if (pending === undefined) return;
    clearTimeout(pending.timer);
    if (pending.signal !== undefined && pending.onAbort !== undefined) {
      pending.signal.removeEventListener("abort", pending.onAbort);
    }
    this.#pending.delete(requestId);
  }
}

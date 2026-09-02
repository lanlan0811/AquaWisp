import { browserRequestSchema, type BrowserRequest } from "./commands.js";

export interface BrowserCommandExecutor {
  execute(request: BrowserRequest, signal: AbortSignal): Promise<unknown>;
}

export interface BrowserRequestBridgeOptions {
  readonly executor: BrowserCommandExecutor;
  readonly backendGeneration: number;
  readonly requestTimeoutMs: number;
}

interface PendingBrowserRequest {
  readonly controller: AbortController;
  readonly fingerprint: string;
  readonly result: Promise<unknown>;
}

export class BrowserRequestBridge {
  readonly #executor: BrowserCommandExecutor;
  readonly #backendGeneration: number;
  readonly #requestTimeoutMs: number;
  readonly #pending = new Map<string, PendingBrowserRequest>();

  constructor(options: BrowserRequestBridgeOptions) {
    if (!Number.isSafeInteger(options.backendGeneration) || options.backendGeneration <= 0) {
      throw new Error("Browser backend generation must be a positive safe integer");
    }
    if (!Number.isSafeInteger(options.requestTimeoutMs) || options.requestTimeoutMs <= 0) {
      throw new Error("Browser request timeout must be a positive safe integer");
    }
    this.#executor = options.executor;
    this.#backendGeneration = options.backendGeneration;
    this.#requestTimeoutMs = options.requestTimeoutMs;
  }

  dispatch(input: unknown): Promise<unknown> {
    const request = browserRequestSchema.parse(input);
    if (request.backendGeneration !== this.#backendGeneration) {
      return Promise.reject(
        new Error(
          `Browser backend generation mismatch: expected ${String(this.#backendGeneration)}, received ${String(request.backendGeneration)}`,
        ),
      );
    }
    const fingerprint = JSON.stringify(request);
    const existing = this.#pending.get(request.requestId);
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) {
        return Promise.reject(
          new Error(`Browser request ID was reused with different input: ${request.requestId}`),
        );
      }
      return existing.result;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(
        new Error(`Browser request timed out after ${String(this.#requestTimeoutMs)}ms`),
      );
    }, this.#requestTimeoutMs);
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener(
        "abort",
        () => {
          reject(
            controller.signal.reason instanceof Error
              ? controller.signal.reason
              : new Error("Browser request aborted"),
          );
        },
        { once: true },
      );
    });
    const result = Promise.race([
      this.#executor.execute(request, controller.signal),
      aborted,
    ]).finally(() => {
      clearTimeout(timeout);
      this.#pending.delete(request.requestId);
    });
    this.#pending.set(request.requestId, { controller, fingerprint, result });
    return result;
  }

  cancel(requestId: string): boolean {
    const pending = this.#pending.get(requestId);
    if (pending === undefined) return false;
    pending.controller.abort(new Error("Browser request cancelled"));
    return true;
  }
}

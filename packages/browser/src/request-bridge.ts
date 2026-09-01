import type { BrowserRequest } from "./commands.js";

export interface BrowserCommandExecutor {
  execute(request: BrowserRequest, signal: AbortSignal): Promise<unknown>;
}
export class BrowserRequestBridge {
  readonly #executor: BrowserCommandExecutor;
  readonly #pending = new Map<
    string,
    { readonly controller: AbortController; readonly result: Promise<unknown> }
  >();
  constructor(executor: BrowserCommandExecutor) {
    this.#executor = executor;
  }
  dispatch(request: BrowserRequest): Promise<unknown> {
    const existing = this.#pending.get(request.requestId);
    if (existing !== undefined) return existing.result;
    const controller = new AbortController();
    const result = this.#executor
      .execute(request, controller.signal)
      .finally(() => this.#pending.delete(request.requestId));
    this.#pending.set(request.requestId, { controller, result });
    return result;
  }
  cancel(requestId: string): boolean {
    const pending = this.#pending.get(requestId);
    if (pending === undefined) return false;
    pending.controller.abort(new Error("Browser request cancelled"));
    return true;
  }
}

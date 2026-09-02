import { browserCommandSchema, browserUrlForAmbientContext } from "@aquawisp/browser";
import { jsonObjectSchema, type JsonObject, type JsonValue } from "@aquawisp/contracts";
import { z } from "zod";

export interface RuntimeHostRequestPort {
  request(
    method: "browser.state" | "browser.execute" | "browser.cancel",
    input: JsonObject,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<JsonValue>;
}

export interface RuntimeBrowserHostOptions {
  readonly host: RuntimeHostRequestPort;
  readonly requestTimeoutMs: number;
  readonly fallbackTabId: string;
}

export interface RuntimeBrowserToolInput {
  readonly tabId?: string;
  readonly command: JsonObject;
}

export interface RuntimeBrowserToolPort {
  execute(
    requestId: string,
    input: RuntimeBrowserToolInput,
    signal: AbortSignal,
  ): Promise<JsonValue>;
  environment?(): Promise<JsonObject>;
}

const browserStateSchema = z
  .object({
    backendGeneration: z.number().int().positive(),
    activeTabId: z.string().min(1).nullable(),
    tabs: z.array(z.object({ id: z.string().min(1), url: z.string() }).strict()),
  })
  .strict();

export class RuntimeBrowserHost implements RuntimeBrowserToolPort {
  readonly #host: RuntimeHostRequestPort;
  readonly #requestTimeoutMs: number;
  readonly #fallbackTabId: string;

  constructor(options: RuntimeBrowserHostOptions) {
    if (!Number.isSafeInteger(options.requestTimeoutMs) || options.requestTimeoutMs <= 0) {
      throw new Error("Browser host timeout must be a positive safe integer");
    }
    if (options.fallbackTabId.length === 0) throw new Error("Browser fallback tab ID is required");
    this.#host = options.host;
    this.#requestTimeoutMs = options.requestTimeoutMs;
    this.#fallbackTabId = options.fallbackTabId;
  }

  async execute(
    requestId: string,
    input: RuntimeBrowserToolInput,
    signal: AbortSignal,
  ): Promise<JsonValue> {
    signal.throwIfAborted();
    const command = browserCommandSchema.parse(input.command);
    const state = await this.#state(signal);
    const requestedTab = input.tabId;
    if (requestedTab !== undefined && !state.tabs.some(({ id }) => id === requestedTab)) {
      throw new Error(`Browser tab is not registered: ${requestedTab}`);
    }
    const tabId = requestedTab ?? state.activeTabId ?? state.tabs[0]?.id ?? this.#fallbackTabId;
    if (state.tabs.length === 0 && command.kind !== "newTab" && command.kind !== "listTabs") {
      throw new Error("No browser tab is available; create a tab before running this command");
    }
    const params = jsonObjectSchema.parse({
      requestId,
      backendGeneration: state.backendGeneration,
      tabId,
      command,
    });
    const cancel = (): void => {
      void this.#host
        .request("browser.cancel", { requestId }, this.#requestTimeoutMs)
        .catch(() => undefined);
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      return await this.#host.request("browser.execute", params, this.#requestTimeoutMs, signal);
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }

  async environment(): Promise<JsonObject> {
    const state = await this.#state();
    return jsonObjectSchema.parse({
      source: "desktop-browser",
      trust: "untrusted",
      available: true,
      activeTabId: state.activeTabId,
      tabCount: state.tabs.length,
      tabs: state.tabs.map(({ id, url }) => ({
        id,
        url: browserUrlForAmbientContext(url),
      })),
    });
  }

  async #state(signal?: AbortSignal) {
    return browserStateSchema.parse(
      await this.#host.request("browser.state", {}, this.#requestTimeoutMs, signal),
    );
  }
}

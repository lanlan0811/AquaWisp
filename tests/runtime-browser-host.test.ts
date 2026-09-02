import type { JsonObject, JsonValue } from "@aquawisp/contracts";
import { RuntimeBrowserHost, type RuntimeHostRequestPort } from "@aquawisp/runtime";
import { describe, expect, it } from "vitest";

interface HostCall {
  readonly method: "browser.state" | "browser.execute" | "browser.cancel";
  readonly input: JsonObject;
}

function hostWithState(
  state: JsonValue,
  executeResult: JsonValue = { url: "https://example.test" },
): { readonly host: RuntimeHostRequestPort; readonly calls: HostCall[] } {
  const calls: HostCall[] = [];
  return {
    calls,
    host: {
      request(method, input) {
        calls.push({ method, input });
        if (method === "browser.state") return Promise.resolve(state);
        if (method === "browser.cancel") return Promise.resolve({ cancelled: true });
        return Promise.resolve(executeResult);
      },
    },
  };
}

function adapter(host: RuntimeHostRequestPort): RuntimeBrowserHost {
  return new RuntimeBrowserHost({
    host,
    requestTimeoutMs: 1_000,
    fallbackTabId: "browser-test-root",
  });
}

describe("M6 runtime browser host adapter", () => {
  it("binds a command to the active tab and current backend generation", async () => {
    const fixture = hostWithState({
      backendGeneration: 7,
      activeTabId: "tab-active",
      tabs: [{ id: "tab-active", url: "https://example.test" }],
    });

    await expect(
      adapter(fixture.host).execute(
        "action-browser-1",
        { command: { kind: "snapshot" } },
        new AbortController().signal,
      ),
    ).resolves.toEqual({ url: "https://example.test" });
    expect(fixture.calls).toEqual([
      { method: "browser.state", input: {} },
      {
        method: "browser.execute",
        input: {
          requestId: "action-browser-1",
          backendGeneration: 7,
          tabId: "tab-active",
          command: { kind: "snapshot" },
        },
      },
    ]);
  });

  it("redacts browser URL credentials, queries, and fragments from ambient context", async () => {
    const fixture = hostWithState({
      backendGeneration: 7,
      activeTabId: "tab-sensitive",
      tabs: [
        {
          id: "tab-sensitive",
          url: "https://user:password@example.test/report?access_token=secret#private",
        },
      ],
    });

    await expect(adapter(fixture.host).environment()).resolves.toEqual({
      source: "desktop-browser",
      trust: "untrusted",
      available: true,
      activeTabId: "tab-sensitive",
      tabCount: 1,
      tabs: [{ id: "tab-sensitive", url: "https://example.test/report" }],
    });
  });

  it("supports bootstrapping the first tab and rejects stale explicit tab ids", async () => {
    const empty = hostWithState({ backendGeneration: 2, activeTabId: null, tabs: [] });
    await expect(
      adapter(empty.host).execute(
        "action-browser-new",
        { command: { kind: "newTab", url: "https://example.test" } },
        new AbortController().signal,
      ),
    ).resolves.toEqual({ url: "https://example.test" });
    expect(empty.calls[1]?.input).toMatchObject({ tabId: "browser-test-root" });

    const populated = hostWithState({
      backendGeneration: 2,
      activeTabId: "tab-live",
      tabs: [{ id: "tab-live", url: "about:blank" }],
    });
    await expect(
      adapter(populated.host).execute(
        "action-browser-stale",
        { tabId: "tab-stale", command: { kind: "snapshot" } },
        new AbortController().signal,
      ),
    ).rejects.toThrow("not registered");
    expect(populated.calls).toHaveLength(1);
  });

  it("forwards cancellation using the action-scoped browser request id", async () => {
    const calls: HostCall[] = [];
    let notifyExecute: (() => void) | undefined;
    const executeStarted = new Promise<void>((resolvePromise) => {
      notifyExecute = resolvePromise;
    });
    const host: RuntimeHostRequestPort = {
      request(method, input, _timeout, signal) {
        calls.push({ method, input });
        if (method === "browser.state") {
          return Promise.resolve({
            backendGeneration: 3,
            activeTabId: "tab-live",
            tabs: [{ id: "tab-live", url: "https://example.test" }],
          });
        }
        if (method === "browser.cancel") return Promise.resolve({ cancelled: true });
        notifyExecute?.();
        return new Promise<JsonValue>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => {
              reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
            },
            { once: true },
          );
        });
      },
    };
    const controller = new AbortController();
    const execution = adapter(host).execute(
      "action-browser-cancel",
      { command: { kind: "waitForURL", url: "/done", timeoutMs: 1_000 } },
      controller.signal,
    );
    await executeStarted;
    controller.abort(new Error("cancelled by test"));
    await expect(execution).rejects.toThrow("cancelled by test");
    expect(calls.at(-1)).toEqual({
      method: "browser.cancel",
      input: { requestId: "action-browser-cancel" },
    });
  });
});

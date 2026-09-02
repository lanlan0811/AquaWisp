import { assertAllowedUrl, BrowserRequestBridge } from "@aquawisp/browser";
import { describe, expect, it } from "vitest";

describe("M6 browser command bridge", () => {
  it("validates URL protocols and de-duplicates requests by request ID", async () => {
    let executions = 0;
    const bridge = new BrowserRequestBridge({
      backendGeneration: 3,
      requestTimeoutMs: 1_000,
      executor: {
        execute: () => {
          executions += 1;
          return Promise.resolve("ok");
        },
      },
    });
    const request = {
      requestId: "request-1",
      backendGeneration: 3,
      tabId: "tab-1",
      command: { kind: "navigate" as const, url: "https://example.test" },
    };
    expect(await Promise.all([bridge.dispatch(request), bridge.dispatch(request)])).toEqual([
      "ok",
      "ok",
    ]);
    expect(executions).toBe(1);
    expect(assertAllowedUrl("https://example.test", ["https:"]).hostname).toBe("example.test");
    expect(() => assertAllowedUrl("file:///secret", ["https:"])).toThrow("not allowed");
  });

  it("rejects stale generations and conflicting request ID reuse", async () => {
    let release: (() => void) | undefined;
    const bridge = new BrowserRequestBridge({
      backendGeneration: 4,
      requestTimeoutMs: 1_000,
      executor: {
        execute: () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      },
    });
    const active = bridge.dispatch({
      requestId: "request-active",
      backendGeneration: 4,
      tabId: "tab-1",
      command: { kind: "snapshot" },
    });
    await expect(
      bridge.dispatch({
        requestId: "request-active",
        backendGeneration: 4,
        tabId: "tab-1",
        command: { kind: "getState" },
      }),
    ).rejects.toThrow("reused with different input");
    await expect(
      bridge.dispatch({
        requestId: "request-stale",
        backendGeneration: 3,
        tabId: "tab-1",
        command: { kind: "getState" },
      }),
    ).rejects.toThrow("generation mismatch");
    release?.();
    await active;
  });

  it("enforces timeout and explicit cancellation even when an executor does not settle", async () => {
    const bridge = new BrowserRequestBridge({
      backendGeneration: 1,
      requestTimeoutMs: 20,
      executor: { execute: () => new Promise(() => undefined) },
    });
    await expect(
      bridge.dispatch({
        requestId: "request-timeout",
        backendGeneration: 1,
        tabId: "tab-1",
        command: { kind: "snapshot" },
      }),
    ).rejects.toThrow("timed out");

    const cancelled = bridge.dispatch({
      requestId: "request-cancelled",
      backendGeneration: 1,
      tabId: "tab-1",
      command: { kind: "snapshot" },
    });
    expect(bridge.cancel("request-cancelled")).toBe(true);
    await expect(cancelled).rejects.toThrow("cancelled");
    expect(bridge.cancel("missing")).toBe(false);
  });
});

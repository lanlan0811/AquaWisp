import { assertAllowedUrl, BrowserRequestBridge } from "@aquawisp/browser";
import { describe, expect, it } from "vitest";

describe("M6 browser command bridge", () => {
  it("validates URL protocols and de-duplicates requests by request ID", async () => {
    let executions = 0;
    const bridge = new BrowserRequestBridge({
      execute: () => {
        executions += 1;
        return Promise.resolve("ok");
      },
    });
    const request = {
      requestId: "request-1",
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
});

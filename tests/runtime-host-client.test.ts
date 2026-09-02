import { runtimeHostRequestSchema, runtimeHostResponseSchema } from "@aquawisp/contracts";
import { RuntimeHostClient } from "@aquawisp/runtime";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

describe("M6 runtime-to-desktop host RPC", () => {
  it("emits a versioned request and resolves only its matching host response", async () => {
    const output = new PassThrough();
    let encoded = "";
    output.on("data", (chunk: Buffer) => {
      encoded += chunk.toString("utf8");
    });
    const client = new RuntimeHostClient({ output, requestTimeoutMs: 1_000, maxLineBytes: 65_536 });
    const result = client.request("browser.execute", {
      requestId: "browser-1",
      backendGeneration: 1,
      tabId: "tab-1",
      command: { kind: "snapshot" },
    });
    const request = runtimeHostRequestSchema.parse(JSON.parse(encoded.trim()) as unknown);
    expect(request).toMatchObject({
      kind: "host.request",
      method: "browser.execute",
      params: { command: { kind: "snapshot" } },
    });
    expect(
      client.accept(
        runtimeHostResponseSchema.parse({
          protocolVersion: 1,
          requestId: "unrelated",
          kind: "host.response",
          ok: true,
          result: null,
        }),
      ),
    ).toBe(false);
    expect(
      client.accept(
        runtimeHostResponseSchema.parse({
          protocolVersion: 1,
          requestId: request.requestId,
          kind: "host.response",
          ok: true,
          result: { url: "https://example.test" },
        }),
      ),
    ).toBe(true);
    await expect(result).resolves.toEqual({ url: "https://example.test" });
    client.close();
  });

  it("propagates bounded host errors, timeout, and close", async () => {
    const output = new PassThrough();
    const client = new RuntimeHostClient({ output, requestTimeoutMs: 20, maxLineBytes: 65_536 });
    const failed = client.request("browser.cancel", { requestId: "browser-failed" });
    expect(
      client.accept(
        runtimeHostResponseSchema.parse({
          protocolVersion: 1,
          requestId: "runtime-host-000001",
          kind: "host.response",
          ok: false,
          error: { code: "browser_failed", message: "命令失败" },
        }),
      ),
    ).toBe(true);
    await expect(failed).rejects.toThrow("browser_failed: 命令失败");
    await expect(
      client.request("browser.cancel", { requestId: "browser-timeout" }),
    ).rejects.toThrow("timed out");
    const closing = client.request("browser.cancel", { requestId: "browser-closing" }, 1_000);
    client.close();
    await expect(closing).rejects.toThrow("closed");
    expect(() => client.request("browser.cancel", { requestId: "after-close" })).toThrow("closed");
  });

  it("drops an aborted request so a late host response cannot settle it twice", async () => {
    const output = new PassThrough();
    const client = new RuntimeHostClient({ output, requestTimeoutMs: 1_000, maxLineBytes: 65_536 });
    const controller = new AbortController();
    const pending = client.request("browser.state", {}, 1_000, controller.signal);
    controller.abort(new Error("run cancelled"));
    await expect(pending).rejects.toThrow("run cancelled");
    expect(
      client.accept(
        runtimeHostResponseSchema.parse({
          protocolVersion: 1,
          requestId: "runtime-host-000001",
          kind: "host.response",
          ok: true,
          result: { backendGeneration: 1, activeTabId: null, tabs: [] },
        }),
      ),
    ).toBe(false);
    client.close();
  });
});

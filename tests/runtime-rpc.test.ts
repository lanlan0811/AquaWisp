import { runtimeRpcRequestSchema, runtimeRpcResponseSchema } from "@aquawisp/contracts";
import { RuntimeProcessClient } from "@aquawisp/desktop";
import { handleRuntimeRpcRequest } from "@aquawisp/runtime/process-host";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const runtimeHostPath = fileURLToPath(import.meta.resolve("@aquawisp/runtime/process-host"));

function definedEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

describe("M5 runtime RPC", () => {
  it("validates the versioned request and response envelopes", () => {
    const request = runtimeRpcRequestSchema.parse({
      protocolVersion: 1,
      requestId: "rpc-test-1",
      method: "runtime.ping",
      params: {},
    });
    const response = handleRuntimeRpcRequest(request);
    expect(runtimeRpcResponseSchema.parse(response)).toMatchObject({
      protocolVersion: 1,
      requestId: "rpc-test-1",
      ok: true,
      result: { status: "ready" },
    });
    expect(() => runtimeRpcRequestSchema.parse({ ...request, protocolVersion: 2 })).toThrow();
  });

  it("spawns, calls, and gracefully shuts down an isolated runtime process", async () => {
    const client = new RuntimeProcessClient({
      executable: process.execPath,
      args: [runtimeHostPath],
      cwd: dirname(runtimeHostPath),
      environment: definedEnvironment(),
      requestTimeoutMs: 5_000,
      maxLineBytes: 1_048_576,
      maxStderrBytes: 65_536,
    });
    client.start();
    const response = await client.request("runtime.ping");
    expect(response).toMatchObject({ ok: true, result: { status: "ready" } });
    await client.close();
    expect(() => client.request("runtime.ping")).toThrow("not started");
  });
});

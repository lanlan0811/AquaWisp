import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import {
  entityIdSchema,
  runtimeRpcRequestSchema,
  runtimeRpcResponseSchema,
  type RuntimeRpcRequest,
  type RuntimeRpcResponse,
} from "@aquawisp/contracts";

export interface RuntimeStdioHostOptions {
  readonly input: Readable;
  readonly output: Writable;
  readonly onShutdown?: () => void;
}

export function handleRuntimeRpcRequest(request: RuntimeRpcRequest): RuntimeRpcResponse {
  if (request.method === "runtime.ping") {
    return runtimeRpcResponseSchema.parse({
      protocolVersion: 1,
      requestId: request.requestId,
      ok: true,
      result: { status: "ready", pid: process.pid },
    });
  }
  return runtimeRpcResponseSchema.parse({
    protocolVersion: 1,
    requestId: request.requestId,
    ok: true,
    result: { status: "shutting_down" },
  });
}

export function runRuntimeStdioHost(options: RuntimeStdioHostOptions): void {
  const lines = createInterface({ input: options.input, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (line.trim() === "") return;
    let requestId = "invalid-request";
    let response: RuntimeRpcResponse;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (typeof parsed === "object" && parsed !== null && "requestId" in parsed) {
        const candidate = entityIdSchema.safeParse(parsed.requestId);
        if (candidate.success) requestId = candidate.data;
      }
      const request = runtimeRpcRequestSchema.parse(parsed);
      response = handleRuntimeRpcRequest(request);
    } catch (error) {
      response = runtimeRpcResponseSchema.parse({
        protocolVersion: 1,
        requestId,
        ok: false,
        error: {
          code: "invalid_request",
          message: error instanceof Error ? error.message : "Invalid runtime RPC request",
        },
      });
    }
    options.output.write(`${JSON.stringify(response)}\n`);
    if (response.ok && response.result.status === "shutting_down") {
      lines.close();
      options.onShutdown?.();
    }
  });
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) {
  runRuntimeStdioHost({
    input: process.stdin,
    output: process.stdout,
    onShutdown: () => {
      process.stdin.unref();
    },
  });
}

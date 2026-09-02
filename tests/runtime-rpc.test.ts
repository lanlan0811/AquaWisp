import {
  runtimeRpcEventSchema,
  runtimeRpcRequestSchema,
  runtimeRpcResponseSchema,
  knowledgeIngestedFileSchema,
  knowledgeLibraryStateSchema,
  type RunEvent,
} from "@aquawisp/contracts";
import { RuntimeProcessClient } from "@aquawisp/desktop";
import { DeterministicModel } from "@aquawisp/runtime";
import { handleRuntimeRpcRequest, RuntimeRunService } from "@aquawisp/runtime/process-host";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    expect(
      runtimeRpcEventSchema.parse({
        protocolVersion: 1,
        requestId: "rpc-test-1",
        kind: "event",
        event: {
          eventId: "event-1",
          runId: "run-1",
          sequence: 0,
          timestamp: "2026-09-02T00:00:00.000Z",
          traceId: "trace-1",
          parentEventId: null,
          type: "model.delta",
          payload: { delta: "沧渡" },
        },
      }),
    ).toMatchObject({ kind: "event", event: { type: "model.delta" } });
  });

  it("executes a run, emits streaming lifecycle events, and never persists the API key", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aquawisp-runtime-rpc-"));
    const events: RunEvent[] = [];
    const service = new RuntimeRunService({
      workingDirectory: directory,
      onEvent: (message) => events.push(message.event),
      createModel: (params) => {
        expect(params.apiKey).toBe("fixture-secret-never-persist");
        return new DeterministicModel([
          [
            { kind: "text_delta", delta: "流式" },
            { kind: "stream_recovery", recoveryAttempt: 1, priorEventCount: 1 },
            { kind: "text_delta", delta: "回答" },
            { kind: "decision", decision: { kind: "final", content: "流式回答" } },
          ],
        ]);
      },
    });
    try {
      const request = runtimeRpcRequestSchema.parse({
        protocolVersion: 1,
        requestId: "rpc-run-1",
        method: "runtime.run.start",
        params: {
          sessionId: "session-1",
          userInput: "测试问题",
          providerId: "bigmodel",
          modelId: "glm-5.3",
          protocol: "chat_completions",
          reasoningLevel: "max",
          apiKey: "fixture-secret-never-persist",
        },
      });
      const response = await service.handle(request);
      expect(response).toMatchObject({
        ok: true,
        result: { status: "completed", finalOutput: "流式回答" },
      });
      expect(events.map(({ type }) => type)).toEqual(
        expect.arrayContaining([
          "run.created",
          "model.delta",
          "model.stream.recovery",
          "run.completed",
        ]),
      );
      expect(JSON.stringify({ response, events })).not.toContain("fixture-secret-never-persist");
    } finally {
      service.close();
    }
    for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const content = await readFile(join(entry.parentPath, entry.name));
      expect(content.includes(Buffer.from("fixture-secret-never-persist"))).toBe(false);
    }
    await rm(directory, { recursive: true, force: true });
  });

  it("cancels an active run through a concurrent request and records run.cancelled", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aquawisp-runtime-cancel-"));
    const events: RunEvent[] = [];
    let notifyCreated: ((runId: string) => void) | undefined;
    const created = new Promise<string>((resolvePromise) => {
      notifyCreated = resolvePromise;
    });
    const service = new RuntimeRunService({
      workingDirectory: directory,
      onEvent: (message) => {
        events.push(message.event);
        if (message.event.type === "run.created") notifyCreated?.(message.event.runId);
      },
      createModel: () => ({
        async *reason(_context, signal) {
          await new Promise<void>((resolvePromise, rejectPromise) => {
            signal.addEventListener(
              "abort",
              () => {
                rejectPromise(
                  signal.reason instanceof Error ? signal.reason : new Error("Run aborted"),
                );
              },
              { once: true },
            );
            if (signal.aborted) resolvePromise();
          });
          signal.throwIfAborted();
          yield { kind: "decision", decision: { kind: "final", content: "不可达" } };
        },
      }),
    });
    try {
      const start = service.handle(
        runtimeRpcRequestSchema.parse({
          protocolVersion: 1,
          requestId: "rpc-run-cancel-start",
          method: "runtime.run.start",
          params: {
            sessionId: "session-cancel",
            userInput: "请停止",
            providerId: "bigmodel",
            modelId: "glm-5.3",
            protocol: "chat_completions",
            reasoningLevel: "max",
            apiKey: "fixture-key",
          },
        }),
      );
      const runId = await created;
      const cancellation = await service.handle(
        runtimeRpcRequestSchema.parse({
          protocolVersion: 1,
          requestId: "rpc-run-cancel-stop",
          method: "runtime.run.cancel",
          params: { runId },
        }),
      );
      expect(cancellation).toMatchObject({
        ok: true,
        result: { status: "cancellation_requested", runId },
      });
      await expect(start).resolves.toMatchObject({ ok: true, result: { status: "cancelled" } });
      expect(events.at(-1)).toMatchObject({ type: "run.cancelled", runId });
    } finally {
      service.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("adds, lists, and removes knowledge files through the isolated runtime contract", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aquawisp-runtime-kb-"));
    const sourcePath = join(directory, "项目说明.md");
    await writeFile(sourcePath, "# 项目说明\n\n沧渡在本地管理知识来源和可追溯分段。", "utf8");
    const service = new RuntimeRunService({
      workingDirectory: directory,
      onEvent: () => undefined,
    });
    try {
      const emptyResponse = await service.handle(
        runtimeRpcRequestSchema.parse({
          protocolVersion: 1,
          requestId: "rpc-kb-state-empty",
          method: "runtime.kb.state",
          params: {},
        }),
      );
      if (!emptyResponse.ok) throw new Error(emptyResponse.error.message);
      expect(knowledgeLibraryStateSchema.parse(emptyResponse.result)).toMatchObject({
        status: { documentCount: 0, chunkCount: 0 },
      });

      const addResponse = await service.handle(
        runtimeRpcRequestSchema.parse({
          protocolVersion: 1,
          requestId: "rpc-kb-add",
          method: "runtime.kb.add_file",
          params: { path: sourcePath },
        }),
      );
      if (!addResponse.ok) throw new Error(addResponse.error.message);
      const added = knowledgeIngestedFileSchema.parse(addResponse.result);
      expect(added).toMatchObject({
        format: "markdown",
        document: { title: "项目说明.md", chunkCount: 1 },
      });

      const stateResponse = await service.handle(
        runtimeRpcRequestSchema.parse({
          protocolVersion: 1,
          requestId: "rpc-kb-state-populated",
          method: "runtime.kb.state",
          params: {},
        }),
      );
      if (!stateResponse.ok) throw new Error(stateResponse.error.message);
      expect(knowledgeLibraryStateSchema.parse(stateResponse.result)).toMatchObject({
        status: { documentCount: 1, chunkCount: 1 },
        documents: [{ id: added.document.id, title: "项目说明.md", chunkCount: 1 }],
      });

      const removeResponse = await service.handle(
        runtimeRpcRequestSchema.parse({
          protocolVersion: 1,
          requestId: "rpc-kb-remove",
          method: "runtime.kb.remove",
          params: { documentId: added.document.id },
        }),
      );
      expect(removeResponse).toMatchObject({
        ok: true,
        result: { removed: true, state: { status: { documentCount: 0, chunkCount: 0 } } },
      });
    } finally {
      service.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("spawns, calls, and gracefully shuts down an isolated runtime process", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aquawisp-runtime-process-"));
    const client = new RuntimeProcessClient({
      executable: process.execPath,
      args: [runtimeHostPath],
      cwd: directory,
      environment: definedEnvironment(),
      requestTimeoutMs: 5_000,
      maxLineBytes: 1_048_576,
      maxStderrBytes: 65_536,
    });
    try {
      client.start();
      const response = await client.request("runtime.ping");
      expect(response).toMatchObject({ ok: true, result: { status: "ready" } });
      const knowledge = await client.request({ method: "runtime.kb.state", params: {} });
      expect(knowledge).toMatchObject({
        ok: true,
        result: { status: { documentCount: 0, chunkCount: 0 }, documents: [] },
      });
      await client.close();
      expect(() => client.request("runtime.ping")).toThrow("not started");
    } finally {
      await client.close().catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  });
});

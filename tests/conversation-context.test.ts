import type { ContextItem } from "@aquawisp/context";
import { runtimeRpcRequestSchema, type RunEvent } from "@aquawisp/contracts";
import { RuntimeRunService } from "@aquawisp/runtime/process-host";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("M2 production conversation context", () => {
  it("loads system prompts, restores prior turns, checkpoints context, and records reasoning state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aquawisp-conversation-context-"));
    const contexts: (readonly ContextItem[])[] = [];
    const events: RunEvent[] = [];
    let turn = 0;
    const service = new RuntimeRunService({
      workingDirectory: directory,
      onEvent: (message) => events.push(message.event),
      createModel: () => ({
        async *reason(context, signal) {
          signal.throwIfAborted();
          await Promise.resolve();
          contexts.push(context.contextItems);
          turn += 1;
          const content = turn === 1 ? "第一轮答复" : "第二轮答复";
          yield { kind: "text_delta", delta: content };
          yield { kind: "decision", decision: { kind: "final", content } };
        },
      }),
    });
    try {
      for (const [requestId, userInput] of [
        ["context-run-1", "第一轮问题"],
        ["context-run-2", "第二轮问题"],
      ] as const) {
        const response = await service.handle(
          runtimeRpcRequestSchema.parse({
            protocolVersion: 1,
            requestId,
            method: "runtime.run.start",
            params: {
              sessionId: "context-session",
              userInput,
              providerId: "bigmodel",
              modelId: "glm-5.3",
              protocol: "chat_completions",
              reasoningLevel: "max",
              mode: "work",
              apiKey: "fixture-key",
            },
          }),
        );
        expect(response).toMatchObject({ ok: true, result: { status: "completed" } });
      }

      expect(contexts).toHaveLength(2);
      expect(contexts[0]?.[0]).toMatchObject({ kind: "system" });
      expect(contexts[0]?.[0]?.content).toContain("沧渡 Agent 核心提示词");
      expect(contexts[0]?.map(({ kind, content }) => [kind, content])).toEqual(
        expect.arrayContaining([["user", "第一轮问题"]]),
      );
      expect(contexts[1]?.map(({ kind, content }) => [kind, content])).toEqual([
        ["system", expect.stringContaining("沧渡 Agent 核心提示词")],
        ["user", "第一轮问题"],
        ["assistant", "第一轮答复"],
        ["user", "第二轮问题"],
      ]);
      expect(events.filter(({ type }) => type === "session.reasoning_effort.updated")).toHaveLength(
        1,
      );
      expect(events.filter(({ type }) => type === "checkpoint.saved")).toHaveLength(2);
      const checkpointFiles = await readdir(join(directory, "context-checkpoints"));
      expect(checkpointFiles).toHaveLength(2);
    } finally {
      service.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("compacts an over-threshold real session and emits an auditable checkpoint chain", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aquawisp-conversation-compaction-"));
    const contexts: (readonly ContextItem[])[] = [];
    const events: RunEvent[] = [];
    const service = new RuntimeRunService({
      workingDirectory: directory,
      contextConfig: {
        checkpointDirectoryName: "checkpoints",
        artifactDirectoryName: "artifacts",
        charactersPerToken: 2,
        maxTokens: 7000,
        compressionThresholdRatio: 0.6,
        recentWindowTokens: 1000,
        maximumSummaryTokens: 500,
        toolInlineTokenLimit: 500,
        artifactPreviewCharacters: 100,
        maximumPromptBundleBytes: 1_048_576,
      },
      onEvent: (message) => events.push(message.event),
      createModel: () => ({
        async *reason(context, signal) {
          signal.throwIfAborted();
          await Promise.resolve();
          contexts.push(context.contextItems);
          yield { kind: "decision", decision: { kind: "final", content: "答复" } };
        },
      }),
    });
    try {
      for (const [requestId, userInput] of [
        ["compact-run-1", "甲".repeat(1500)],
        ["compact-run-2", "乙".repeat(1500)],
      ] as const) {
        await service.handle(
          runtimeRpcRequestSchema.parse({
            protocolVersion: 1,
            requestId,
            method: "runtime.run.start",
            params: {
              sessionId: "compact-session",
              userInput,
              providerId: "bigmodel",
              modelId: "glm-5.3",
              protocol: "chat_completions",
              reasoningLevel: "max",
              mode: "work",
              apiKey: "fixture-key",
            },
          }),
        );
      }

      expect(events.filter(({ type }) => type === "context.compacted")).toHaveLength(1);
      const compacted = events.find(({ type }) => type === "context.compacted");
      expect(compacted?.type).toBe("context.compacted");
      if (compacted?.type === "context.compacted") {
        expect(compacted.payload.beforeTokens).toBeGreaterThan(compacted.payload.afterTokens);
        expect(compacted.payload.summaryItemId).not.toBeNull();
      }
      expect(contexts[1]?.map(({ kind }) => kind)).toEqual([
        "system",
        "summary",
        "assistant",
        "user",
      ]);
      const compactionIndex = events.findIndex(({ type }) => type === "context.compacted");
      expect(events[compactionIndex + 1]).toMatchObject({
        type: "checkpoint.saved",
        parentEventId: events[compactionIndex]?.eventId,
      });
    } finally {
      service.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

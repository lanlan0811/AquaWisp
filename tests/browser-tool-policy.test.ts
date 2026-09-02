import { runtimeRpcRequestSchema } from "@aquawisp/contracts";
import { DeterministicModel } from "@aquawisp/runtime";
import { RuntimeRunService } from "@aquawisp/runtime/process-host";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("M6 browser tool policy", () => {
  it("rejects an interaction disguised as a plan-mode observation before dispatch", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aquawisp-browser-policy-"));
    let dispatched = false;
    const service = new RuntimeRunService({
      workingDirectory: directory,
      onEvent: () => undefined,
      browser: {
        execute() {
          dispatched = true;
          return Promise.resolve({});
        },
      },
      createModel: () =>
        new DeterministicModel([
          [
            {
              kind: "decision",
              decision: {
                kind: "action",
                action: {
                  toolName: "browser.observe",
                  toolRevision: "1",
                  input: { command: { kind: "click", ref: "ref-1" } },
                  sideEffect: false,
                },
              },
            },
          ],
        ]),
    });
    try {
      const response = await service.handle(
        runtimeRpcRequestSchema.parse({
          protocolVersion: 1,
          requestId: "rpc-browser-policy",
          method: "runtime.run.start",
          params: {
            sessionId: "session-browser-policy",
            userInput: "只制定计划",
            providerId: "bigmodel",
            modelId: "glm-5.3",
            protocol: "chat_completions",
            reasoningLevel: "max",
            mode: "plan",
            apiKey: "fixture-key",
          },
        }),
      );
      expect(response).toMatchObject({
        ok: true,
        result: { status: "failed", errorCode: "invalid_action" },
      });
      expect(dispatched).toBe(false);
    } finally {
      service.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

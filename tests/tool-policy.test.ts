import {
  getModelToolDefinitions,
  parseToolInput,
  ToolPolicyEvaluator,
  toolCatalog,
} from "@aquawisp/tools";
import { describe, expect, it } from "vitest";

const timestamp = "2026-09-02T00:00:00.000Z";

function action(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: "action-policy",
    runId: "run-policy",
    stepId: "step-policy",
    toolName: "filesystem.write",
    toolRevision: "1",
    input: {},
    sideEffect: true,
    idempotencyKey: "idempotency-policy",
    state: "planned",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function evaluator(
  mode: "plan" | "work" | "full_access",
  rules: {
    readonly explicitlyDeniedToolIds: readonly string[];
    readonly projectDeniedToolIds: readonly string[];
  } = {
    explicitlyDeniedToolIds: [],
    projectDeniedToolIds: [],
  },
) {
  return new ToolPolicyEvaluator({
    mode,
    rules,
    clock: { now: () => new Date(timestamp) },
    ids: { nextApprovalId: () => "approval-policy" },
  });
}

describe("M3 tool policy evaluator", () => {
  it("enforces the declared evaluation order", () => {
    const policy = evaluator("work", {
      explicitlyDeniedToolIds: ["filesystem.write"],
      projectDeniedToolIds: ["filesystem.write"],
    });

    const result = policy.authorize(action(), { scope: "external", description: "outside" });

    expect(result.decision).toMatchObject({ outcome: "denied", reasonCode: "explicit_deny" });
  });

  it("denies write actions in plan mode and automatically allows them in work mode", () => {
    const planResult = evaluator("plan").authorize(action(), {
      scope: "workspace",
      description: "workspace/file.md",
    });
    const workResult = evaluator("work").authorize(action(), {
      scope: "workspace",
      description: "workspace/file.md",
    });

    expect(planResult.decision).toMatchObject({ outcome: "denied", reasonCode: "mode_denied" });
    expect(workResult.decision).toMatchObject({
      outcome: "allowed",
      reasonCode: "mode_auto_allowed",
    });
    const planBoundaryResult = evaluator("plan").authorize(action(), {
      scope: "external",
      description: "outside-workspace/file.md",
    });
    expect(planBoundaryResult.decision).toMatchObject({
      outcome: "denied",
      reasonCode: "mode_denied",
    });
    expect(planBoundaryResult.approvalRequest).toBeUndefined();
  });

  it("requires an auditable approval for a boundary crossing", () => {
    const result = evaluator("work").authorize(action(), {
      scope: "external",
      description: "outside-workspace/file.md",
    });

    expect(result.decision).toMatchObject({
      outcome: "requires_approval",
      approvalId: "approval-policy",
    });
    expect(result.approvalRequest).toMatchObject({
      status: "pending",
      actionId: "action-policy",
      target: "outside-workspace/file.md",
      riskReason: "操作目标跨越了当前工作区、秘密或平台安全边界。",
      impact:
        "如果允许，沧渡将对“outside-workspace/file.md”执行 filesystem.write；授权只覆盖本次精确范围。",
    });
  });

  it("rejects unregistered tools and malformed actions before evaluating risk", () => {
    const unknown = evaluator("full_access").authorize(action({ toolName: "unregistered.tool" }), {
      scope: "workspace",
      description: "workspace",
    });
    const malformed = evaluator("full_access").authorize(
      {},
      { scope: "workspace", description: "workspace" },
    );

    expect(unknown.decision.reasonCode).toBe("unknown_tool");
    expect(malformed.decision.reasonCode).toBe("invalid_action");
  });

  it("keeps model declarations and strict input validation driven by the catalog", () => {
    const chatTools = getModelToolDefinitions("chat_completions");
    const responseTools = getModelToolDefinitions("responses");

    expect(chatTools).toHaveLength(toolCatalog.tools.length);
    expect(responseTools).toHaveLength(toolCatalog.tools.length);
    expect(chatTools[0]).toMatchObject({
      type: "function",
      function: { name: "filesystem_read", parameters: { additionalProperties: false } },
    });
    expect(parseToolInput("filesystem.read", { path: "notes.md" })).toEqual({
      path: "notes.md",
    });
    expect(() => parseToolInput("filesystem.read", { path: "notes.md", injected: true })).toThrow(
      "must NOT have additional properties",
    );
  });
});

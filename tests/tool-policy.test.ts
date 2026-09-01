import { ToolPolicyEvaluator } from "@aquawisp/tools";
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
});

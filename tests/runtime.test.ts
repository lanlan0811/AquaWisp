import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { authorizationDecisionSchema, type RunEvent } from "@aquawisp/contracts";
import {
  AllowAllSimulationPolicy,
  DeterministicClock,
  DeterministicIdGenerator,
  DeterministicModel,
  DeterministicVerifier,
  EchoSimulationExecutor,
  RunEngine,
  SessionApprovalCoordinator,
  SqliteEventStore,
  type ActionExecutorPort,
  type PolicyPort,
} from "@aquawisp/runtime";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createDatabasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "AquaWisp M1 测试-"));
  temporaryDirectories.push(directory);
  return join(directory, "事件 数据库.sqlite");
}

function createModel(): DeterministicModel {
  return new DeterministicModel([
    [
      {
        kind: "decision",
        decision: {
          kind: "action",
          action: {
            toolName: "simulation.echo",
            toolRevision: "1",
            input: { value: "可回放" },
            sideEffect: false,
          },
        },
      },
    ],
    [
      { kind: "text_delta", delta: "回放" },
      { kind: "text_delta", delta: "完成" },
      { kind: "decision", decision: { kind: "final", content: "回放完成" } },
    ],
  ]);
}

function createEngine(
  store: SqliteEventStore,
  executor: ActionExecutorPort,
  policy: PolicyPort = new AllowAllSimulationPolicy(),
): RunEngine {
  return new RunEngine({
    store,
    model: createModel(),
    policy,
    executor,
    verifier: new DeterministicVerifier(),
    clock: new DeterministicClock(new Date("2026-08-29T00:00:00.000Z"), 5),
    ids: new DeterministicIdGenerator("test"),
    maxCycles: 3,
  });
}

describe("M1 runtime", () => {
  it("runs all six stages, persists a verified action, and replays the same terminal state", async () => {
    const databasePath = await createDatabasePath();
    const streamedEventIds: string[] = [];
    const store = new SqliteEventStore({
      databasePath,
      onEvent: (event) => streamedEventIds.push(event.eventId),
    });

    const run = await createEngine(store, new EchoSimulationExecutor()).start({
      sessionId: "session-1",
      userInput: "执行确定性回放",
    });
    const persistedEvents = store.listEvents(run.id);
    const persistedActions = store.listActions(run.id);
    const rebuiltBeforeClose = store.rebuildRun(run.id);
    store.close();

    expect(run.status).toBe("completed");
    expect(run.finalOutput).toBe("回放完成");
    expect(persistedActions).toHaveLength(1);
    expect(persistedActions[0]?.state).toBe("verified");
    expect(persistedEvents.map(({ sequence }) => sequence)).toEqual(
      persistedEvents.map((_, index) => index),
    );
    expect(new Set(persistedEvents.map(({ traceId }) => traceId)).size).toBe(1);
    expect(persistedEvents[0]?.parentEventId).toBeNull();
    for (let index = 1; index < persistedEvents.length; index += 1) {
      expect(persistedEvents[index]?.parentEventId).toBe(persistedEvents[index - 1]?.eventId);
    }
    expect(streamedEventIds).toEqual(persistedEvents.map(({ eventId }) => eventId));
    expect(
      persistedEvents
        .filter((event) => event.type === "run.stage.entered")
        .map((event) => event.payload.stage),
    ).toEqual([
      "prepare",
      "reason",
      "authorize",
      "execute",
      "observe",
      "verify",
      "reason",
      "verify",
    ]);
    expect(rebuiltBeforeClose.run).toEqual(run);
    expect([...rebuiltBeforeClose.actions.values()]).toEqual(persistedActions);

    const reopenedStore = new SqliteEventStore({ databasePath });
    const rebuiltAfterReopen = reopenedStore.rebuildRun(run.id);
    expect(rebuiltAfterReopen.run).toEqual(run);
    expect(rebuiltAfterReopen.timeline).toEqual(persistedEvents);
    reopenedStore.close();
  });

  it("marks a dispatched action unknown and does not retry it when execution loses its result", async () => {
    const databasePath = await createDatabasePath();
    const store = new SqliteEventStore({ databasePath });
    let executions = 0;
    const executor: ActionExecutorPort = {
      execute(): Promise<never> {
        executions += 1;
        return Promise.reject(new Error("simulated transport loss"));
      },
    };

    const run = await createEngine(store, executor).start({
      sessionId: "session-unknown",
      userInput: "模拟派发结果丢失",
    });
    const actions = store.listActions(run.id);
    const eventTypes = store.listEvents(run.id).map(({ type }) => type);
    store.close();

    expect(run.status).toBe("failed");
    expect(run.errorCode).toBe("action_result_unknown");
    expect(executions).toBe(1);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.state).toBe("unknown");
    expect(eventTypes).toContain("action.unknown");
    expect(eventTypes.at(-1)).toBe("run.failed");
  });

  it("requires a structured approval id when policy asks for approval", () => {
    expect(() =>
      authorizationDecisionSchema.parse({
        outcome: "requires_approval",
        reasonCode: "outside_workspace",
        humanSummary: "目标位于工作区之外",
      }),
    ).toThrow(/approvalId/);
  });

  it("persists an approval pause as waiting_approval", async () => {
    const databasePath = await createDatabasePath();
    const store = new SqliteEventStore({ databasePath });
    const policy: PolicyPort = {
      authorize(action) {
        return Promise.resolve({
          decision: {
            outcome: "requires_approval",
            reasonCode: "simulation_confirmation",
            humanSummary: "该模拟动作需要确认",
            approvalId: "approval-1",
          },
          approvalRequest: {
            id: "approval-1",
            runId: action.runId,
            actionId: action.id,
            status: "pending",
            actionType: "模拟动作",
            target: action.toolName,
            riskReason: "测试审批暂停",
            impact: "不会执行实际副作用",
            requestedAt: "2026-08-29T00:00:00.000Z",
            resolvedAt: null,
          },
        });
      },
    };

    const run = await createEngine(store, new EchoSimulationExecutor(), policy).start({
      sessionId: "session-approval",
      userInput: "等待审批",
    });
    const rebuilt = store.rebuildRun(run.id);
    const events = store.listEvents(run.id);
    const actions = store.listActions(run.id);
    store.close();

    expect(run.status).toBe("waiting_approval");
    expect(run.currentStage).toBe("authorize");
    expect(events.at(-1)?.type).toBe("approval.required");
    expect(actions[0]?.state).toBe("planned");
    expect(rebuilt.run).toEqual(run);
  });

  it("records a bound denial and terminates without dispatching the action", async () => {
    const databasePath = await createDatabasePath();
    let notifyApproval:
      ((event: Extract<RunEvent, { type: "approval.required" }>) => void) | undefined;
    const required = new Promise<Extract<RunEvent, { type: "approval.required" }>>(
      (resolvePromise) => {
        notifyApproval = resolvePromise;
      },
    );
    const store = new SqliteEventStore({
      databasePath,
      onEvent: (event) => {
        if (event.type === "approval.required") notifyApproval?.(event);
      },
    });
    const approval = new SessionApprovalCoordinator();
    const policy: PolicyPort = {
      authorize(action) {
        return Promise.resolve({
          decision: {
            outcome: "requires_approval",
            reasonCode: "simulation_confirmation",
            humanSummary: "该动作需要用户确认",
            approvalId: "approval-denied",
          },
          approvalRequest: {
            id: "approval-denied",
            runId: action.runId,
            actionId: action.id,
            status: "pending",
            actionType: action.toolName,
            target: "受保护目标",
            riskReason: "模拟高风险动作",
            impact: "如果允许，将执行一次模拟写入",
            requestedAt: "2026-08-29T00:00:00.000Z",
            resolvedAt: null,
          },
        });
      },
    };
    let executions = 0;
    const engine = new RunEngine({
      store,
      model: createModel(),
      approval,
      policy,
      executor: {
        execute() {
          executions += 1;
          return Promise.resolve({ ok: true, output: null });
        },
      },
      verifier: new DeterministicVerifier(),
      clock: new DeterministicClock(new Date("2026-08-29T00:00:00.000Z"), 5),
      ids: new DeterministicIdGenerator("deny"),
      maxCycles: 3,
    });
    const runPromise = engine.start({
      sessionId: "session-denied-approval",
      userInput: "拒绝审批",
    });
    const event = await required;
    approval.resolve({
      approvalId: event.payload.request.id,
      runId: event.runId,
      decision: "deny",
      rememberForSession: false,
    });
    const run = await runPromise;
    const eventTypes = store.listEvents(run.id).map(({ type }) => type);
    const action = store.listActions(run.id)[0];
    store.close();

    expect(run).toMatchObject({ status: "failed", errorCode: "user_denied_approval" });
    expect(executions).toBe(0);
    expect(action?.state).toBe("planned");
    expect(eventTypes.slice(-3)).toEqual(["approval.resolved", "action.denied", "run.failed"]);
  });

  it("records policy denial before failing the Run", async () => {
    const databasePath = await createDatabasePath();
    const store = new SqliteEventStore({ databasePath });
    const policy: PolicyPort = {
      authorize() {
        return Promise.resolve({
          decision: {
            outcome: "denied",
            reasonCode: "simulation_denied",
            humanSummary: "模拟策略拒绝了该动作",
          },
        });
      },
    };

    const run = await createEngine(store, new EchoSimulationExecutor(), policy).start({
      sessionId: "session-denied",
      userInput: "拒绝动作",
    });
    const eventTypes = store.listEvents(run.id).map(({ type }) => type);
    store.close();

    expect(run.status).toBe("failed");
    expect(run.errorCode).toBe("simulation_denied");
    expect(eventTypes.slice(-2)).toEqual(["action.denied", "run.failed"]);
  });

  it("records an aborted run with the cancelled terminal status", async () => {
    const databasePath = await createDatabasePath();
    const store = new SqliteEventStore({ databasePath });
    const controller = new AbortController();
    controller.abort(new Error("user cancelled"));

    const run = await createEngine(store, new EchoSimulationExecutor()).start({
      sessionId: "session-cancelled",
      userInput: "取消运行",
      signal: controller.signal,
    });
    const rebuilt = store.rebuildRun(run.id);
    const events = store.listEvents(run.id);
    store.close();

    expect(run.status).toBe("cancelled");
    expect(events.at(-1)?.type).toBe("run.cancelled");
    expect(rebuilt.run).toEqual(run);
  });
});

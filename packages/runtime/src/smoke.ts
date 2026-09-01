import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AllowAllSimulationPolicy,
  DeterministicClock,
  DeterministicIdGenerator,
  DeterministicModel,
  DeterministicVerifier,
  EchoSimulationExecutor,
} from "./deterministic.js";
import { SqliteEventStore } from "./event-store.js";
import { RunEngine } from "./run-engine.js";

export interface RuntimeSmokeResult {
  readonly runId: string;
  readonly eventCount: number;
  readonly actionCount: number;
}

export async function runDeterministicSmoke(): Promise<RuntimeSmokeResult> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "aquawisp-runtime-smoke-"));
  const store = new SqliteEventStore({ databasePath: join(temporaryDirectory, "events.sqlite") });
  try {
    const engine = new RunEngine({
      store,
      model: new DeterministicModel([
        [
          {
            kind: "decision",
            decision: {
              kind: "action",
              action: {
                toolName: "simulation.echo",
                toolRevision: "1",
                input: { value: "沧渡 M1" },
                sideEffect: false,
              },
            },
          },
        ],
        [
          { kind: "text_delta", delta: "模拟运行" },
          { kind: "text_delta", delta: "已完成" },
          { kind: "decision", decision: { kind: "final", content: "模拟运行已完成" } },
        ],
      ]),
      policy: new AllowAllSimulationPolicy(),
      executor: new EchoSimulationExecutor(),
      verifier: new DeterministicVerifier(),
      clock: new DeterministicClock(new Date("2026-01-01T00:00:00.000Z"), 10),
      ids: new DeterministicIdGenerator("smoke"),
      maxCycles: 4,
    });
    const run = await engine.start({ sessionId: "smoke-session", userInput: "运行 M1 模拟链路" });
    if (run.status !== "completed") {
      throw new Error(`Deterministic smoke run did not complete: ${run.status}`);
    }
    const rebuilt = store.rebuildRun(run.id);
    const actions = store.listActions(run.id);
    if (JSON.stringify(rebuilt.run) !== JSON.stringify(run)) {
      throw new Error("Rebuilt run does not match the persisted terminal run");
    }
    if (actions.length !== 1 || actions[0]?.state !== "verified") {
      throw new Error("Deterministic action did not reach verified state");
    }
    return { runId: run.id, eventCount: rebuilt.timeline.length, actionCount: actions.length };
  } finally {
    store.close();
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

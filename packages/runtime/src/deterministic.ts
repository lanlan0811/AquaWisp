import type { ActionRecord, ModelSignal, Observation, Verification } from "@aquawisp/contracts";

import type {
  ActionExecutorPort,
  ClockPort,
  IdGeneratorPort,
  ModelPort,
  PolicyPort,
  ReasonContext,
  VerificationPort,
} from "./ports.js";

export class DeterministicClock implements ClockPort {
  #current: number;
  readonly #stepMilliseconds: number;

  constructor(start: Date, stepMilliseconds: number) {
    if (!Number.isInteger(stepMilliseconds) || stepMilliseconds <= 0) {
      throw new Error("stepMilliseconds must be a positive integer");
    }
    this.#current = start.getTime();
    this.#stepMilliseconds = stepMilliseconds;
  }

  now(): Date {
    const current = new Date(this.#current);
    this.#current += this.#stepMilliseconds;
    return current;
  }
}

export class DeterministicIdGenerator implements IdGeneratorPort {
  readonly #prefix: string;
  readonly #counters = new Map<string, number>();

  constructor(prefix: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(prefix)) {
      throw new Error("Deterministic id prefix contains unsupported characters");
    }
    this.#prefix = prefix;
  }

  next(namespace: "run" | "trace" | "event" | "step" | "action"): string {
    const nextValue = (this.#counters.get(namespace) ?? 0) + 1;
    this.#counters.set(namespace, nextValue);
    return `${this.#prefix}-${namespace}-${nextValue.toString().padStart(4, "0")}`;
  }
}

export class DeterministicModel implements ModelPort {
  readonly #turns: readonly (readonly ModelSignal[])[];
  #cursor = 0;

  constructor(turns: readonly (readonly ModelSignal[])[]) {
    this.#turns = turns;
  }

  async *reason(_context: ReasonContext, signal: AbortSignal): AsyncIterable<ModelSignal> {
    signal.throwIfAborted();
    await Promise.resolve();
    const turn = this.#turns[this.#cursor];
    if (turn === undefined) {
      throw new Error("Deterministic model has no scripted turn remaining");
    }
    this.#cursor += 1;
    for (const modelSignal of turn) {
      signal.throwIfAborted();
      yield modelSignal;
    }
  }
}

export class AllowAllSimulationPolicy implements PolicyPort {
  authorize(): Promise<{
    readonly decision: {
      readonly outcome: "allowed";
      readonly reasonCode: "simulation_policy";
      readonly humanSummary: "确定性模拟策略允许该动作";
    };
  }> {
    return Promise.resolve({
      decision: {
        outcome: "allowed",
        reasonCode: "simulation_policy",
        humanSummary: "确定性模拟策略允许该动作",
      },
    });
  }
}

export class EchoSimulationExecutor implements ActionExecutorPort {
  execute(action: ActionRecord, signal: AbortSignal): Promise<Observation> {
    signal.throwIfAborted();
    return Promise.resolve({ ok: true, output: action.input });
  }
}

export class DeterministicVerifier implements VerificationPort {
  verifyAction(action: ActionRecord, observation: Observation): Promise<Verification> {
    return Promise.resolve({
      success: observation.ok,
      summary: observation.ok ? "模拟动作观察结果已验证" : "模拟动作观察结果验证失败",
      evidence: { observationOk: observation.ok, toolName: action.toolName },
    });
  }

  verifyFinal(content: string): Promise<Verification> {
    return Promise.resolve({
      success: content.trim().length > 0,
      summary: "最终输出非空且通过确定性验证",
      evidence: { contentLength: content.length },
    });
  }
}

import { createHash } from "node:crypto";

import {
  actionRecordSchema,
  modelSignalSchema,
  observationSchema,
  runRecordSchema,
  type ActionRecord,
  type ModelDecision,
  type Observation,
  type RunEvent,
  type RunRecord,
  type RunStage,
} from "@aquawisp/contracts";

import { ActionLedger } from "./action-ledger.js";
import type { EventMetadata } from "./event-store.js";
import { SqliteEventStore } from "./event-store.js";
import type {
  ActionExecutorPort,
  ClockPort,
  IdGeneratorPort,
  ModelPort,
  PolicyPort,
  VerificationPort,
} from "./ports.js";

export interface RunEngineOptions {
  readonly store: SqliteEventStore;
  readonly model: ModelPort;
  readonly policy: PolicyPort;
  readonly executor: ActionExecutorPort;
  readonly verifier: VerificationPort;
  readonly clock: ClockPort;
  readonly ids: IdGeneratorPort;
  readonly maxCycles: number;
}

export interface StartRunRequest {
  readonly sessionId: string;
  readonly userInput: string;
  readonly signal?: AbortSignal;
}

export class RunEngine {
  readonly #store: SqliteEventStore;
  readonly #model: ModelPort;
  readonly #policy: PolicyPort;
  readonly #executor: ActionExecutorPort;
  readonly #verifier: VerificationPort;
  readonly #clock: ClockPort;
  readonly #ids: IdGeneratorPort;
  readonly #maxCycles: number;
  readonly #ledger: ActionLedger;
  #traceId = "";
  #lastEventId: string | null = null;
  #active = false;

  constructor(options: RunEngineOptions) {
    if (!Number.isInteger(options.maxCycles) || options.maxCycles <= 0) {
      throw new Error("maxCycles must be a positive integer");
    }
    this.#store = options.store;
    this.#model = options.model;
    this.#policy = options.policy;
    this.#executor = options.executor;
    this.#verifier = options.verifier;
    this.#clock = options.clock;
    this.#ids = options.ids;
    this.#maxCycles = options.maxCycles;
    this.#ledger = new ActionLedger(options.store);
  }

  async start(request: StartRunRequest): Promise<RunRecord> {
    if (this.#active) {
      throw new Error("A RunEngine instance can execute only one Run at a time");
    }
    this.#active = true;
    try {
      return await this.#start(request);
    } finally {
      this.#active = false;
    }
  }

  async #start(request: StartRunRequest): Promise<RunRecord> {
    const runId = this.#ids.next("run");
    this.#traceId = this.#ids.next("trace");
    this.#lastEventId = null;
    const createdAt = this.#clock.now().toISOString();
    const run = runRecordSchema.parse({
      id: runId,
      sessionId: request.sessionId,
      status: "created",
      currentStage: null,
      userInput: request.userInput,
      createdAt,
      updatedAt: createdAt,
      finalOutput: null,
      errorCode: null,
      errorMessage: null,
      revision: 0,
    });
    this.#record(this.#store.createRun(run, this.#metadata()));

    const abortSignal = request.signal ?? new AbortController().signal;
    const observations: Observation[] = [];

    try {
      this.#enterStage(runId, "prepare", 1);
      for (let cycle = 1; cycle <= this.#maxCycles; cycle += 1) {
        this.#throwIfAborted(abortSignal);
        this.#enterStage(runId, "reason", cycle);
        const decision = await this.#reason(run, cycle, observations, abortSignal);

        if (decision.kind === "final") {
          this.#enterStage(runId, "verify", cycle);
          const verification = await this.#verifier.verifyFinal(decision.content, observations);
          if (!verification.success) {
            return this.#fail(runId, "final_verification_failed", verification.summary);
          }
          this.#record(this.#store.completeRun(runId, decision.content, this.#metadata()));
          return this.#store.getRun(runId);
        }

        const action = this.#createAction(runId, decision, cycle);
        this.#record(this.#ledger.plan(action, this.#metadata()));

        this.#enterStage(runId, "authorize", cycle);
        const authorization = await this.#policy.authorize(action);
        if (authorization.decision.outcome === "requires_approval") {
          if (authorization.approvalRequest === undefined) {
            return this.#fail(
              runId,
              "invalid_approval_request",
              "Policy required approval without a structured approval request",
            );
          }
          this.#record(
            this.#store.waitForApproval(runId, authorization.approvalRequest, this.#metadata()),
          );
          return this.#store.getRun(runId);
        }
        if (authorization.decision.outcome === "denied") {
          this.#record(this.#ledger.deny(action, authorization.decision, this.#metadata()));
          return this.#fail(
            runId,
            authorization.decision.reasonCode,
            authorization.decision.humanSummary,
          );
        }
        this.#record(this.#ledger.authorize(action, authorization.decision, this.#metadata()));

        this.#enterStage(runId, "execute", cycle);
        this.#record(this.#ledger.dispatch(action, this.#metadata()));
        let observation: Observation;
        try {
          observation = observationSchema.parse(await this.#executor.execute(action, abortSignal));
        } catch (error) {
          const reason = error instanceof Error ? error.message : "Action result is unknown";
          this.#record(this.#ledger.markUnknown(action, reason, this.#metadata()));
          if (abortSignal.aborted) {
            this.#record(this.#store.cancelRun(runId, reason, this.#metadata()));
            return this.#store.getRun(runId);
          }
          return this.#fail(runId, "action_result_unknown", reason);
        }

        this.#enterStage(runId, "observe", cycle);
        this.#record(this.#ledger.observe(action, observation, this.#metadata()));
        observations.push(observation);

        this.#enterStage(runId, "verify", cycle);
        const verification = await this.#verifier.verifyAction(action, observation);
        if (!verification.success) {
          return this.#fail(runId, "action_verification_failed", verification.summary);
        }
        this.#record(this.#ledger.verify(action, verification, this.#metadata()));
      }
      return this.#fail(
        runId,
        "max_cycles_exceeded",
        `Run exceeded the configured maximum of ${this.#maxCycles.toString()} cycles`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown runtime failure";
      const current = this.#store.getRun(runId);
      if (["completed", "failed", "cancelled", "interrupted"].includes(current.status)) {
        return current;
      }
      if (abortSignal.aborted) {
        this.#record(this.#store.cancelRun(runId, message, this.#metadata()));
        return this.#store.getRun(runId);
      }
      return this.#fail(runId, "runtime_failure", message);
    }
  }

  async #reason(
    run: RunRecord,
    cycle: number,
    observations: readonly Observation[],
    signal: AbortSignal,
  ): Promise<ModelDecision> {
    let decision: ModelDecision | undefined;
    for await (const rawSignal of this.#model.reason(
      { runId: run.id, cycle, userInput: run.userInput, observations },
      signal,
    )) {
      const modelSignal = modelSignalSchema.parse(rawSignal);
      if (modelSignal.kind === "text_delta") {
        this.#record(
          this.#store.appendEvent({
            ...this.#metadata(),
            runId: run.id,
            type: "model.delta",
            payload: { delta: modelSignal.delta },
          }),
        );
      } else if (decision === undefined) {
        decision = modelSignal.decision;
      } else {
        throw new Error("Model emitted more than one decision in a reason stage");
      }
    }
    if (decision === undefined) {
      throw new Error("Model completed a reason stage without a decision");
    }
    this.#record(
      this.#store.appendEvent({
        ...this.#metadata(),
        runId: run.id,
        type: "model.decision",
        payload: { decision },
      }),
    );
    return decision;
  }

  #createAction(
    runId: string,
    decision: Extract<ModelDecision, { kind: "action" }>,
    cycle: number,
  ): ActionRecord {
    const actionId = this.#ids.next("action");
    const timestamp = this.#clock.now().toISOString();
    const idempotencyKey = createHash("sha256")
      .update(
        `${runId}:${cycle.toString()}:${decision.action.toolName}:${JSON.stringify(decision.action.input)}`,
      )
      .digest("hex");
    return actionRecordSchema.parse({
      id: actionId,
      runId,
      stepId: this.#ids.next("step"),
      toolName: decision.action.toolName,
      toolRevision: decision.action.toolRevision,
      input: decision.action.input,
      sideEffect: decision.action.sideEffect,
      idempotencyKey,
      state: "planned",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  #enterStage(runId: string, stage: RunStage, cycle: number): void {
    this.#record(this.#store.enterStage(runId, stage, cycle, this.#metadata()));
  }

  #fail(runId: string, code: string, message: string): RunRecord {
    this.#record(this.#store.failRun(runId, code, message, {}, this.#metadata()));
    return this.#store.getRun(runId);
  }

  #metadata(): EventMetadata {
    return {
      eventId: this.#ids.next("event"),
      timestamp: this.#clock.now().toISOString(),
      traceId: this.#traceId,
      parentEventId: this.#lastEventId,
    };
  }

  #record(event: RunEvent): void {
    this.#lastEventId = event.eventId;
  }

  #throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw signal.reason;
    }
  }
}

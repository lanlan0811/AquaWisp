import { createHash } from "node:crypto";

import {
  actionRecordSchema,
  modelSignalSchema,
  observationSchema,
  runRecordSchema,
  type ActionRecord,
  type AuthorizationDecision,
  type ModelDecision,
  type Observation,
  type RunEvent,
  type RunRecord,
  type RunStage,
} from "@aquawisp/contracts";
import type { ContextItem } from "@aquawisp/context";

import { ActionLedger } from "./action-ledger.js";
import type { EventMetadata } from "./event-store.js";
import { SqliteEventStore } from "./event-store.js";
import type {
  ActionExecutorPort,
  ApprovalPort,
  ClockPort,
  IdGeneratorPort,
  ModelPort,
  PolicyPort,
  RunContextPort,
  ReasonObservation,
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
  readonly context?: RunContextPort;
  readonly approval?: ApprovalPort;
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
  readonly #context: RunContextPort | undefined;
  readonly #approval: ApprovalPort | undefined;
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
    this.#context = options.context;
    this.#approval = options.approval;
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
    const observations: ReasonObservation[] = [];

    try {
      this.#enterStage(runId, "prepare", 1);
      const contextItems = await this.#prepareContext(run);
      for (let cycle = 1; cycle <= this.#maxCycles; cycle += 1) {
        this.#throwIfAborted(abortSignal);
        this.#enterStage(runId, "reason", cycle);
        const decision = await this.#reason(run, cycle, observations, contextItems, abortSignal);

        if (decision.kind === "final") {
          this.#enterStage(runId, "verify", cycle);
          const verification = await this.#verifier.verifyFinal(
            decision.content,
            observations.map(({ observation }) => observation),
          );
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
        let authorizationDecision: AuthorizationDecision = authorization.decision;
        if (authorization.decision.outcome === "requires_approval") {
          const approvalRequest = authorization.approvalRequest;
          if (
            approvalRequest === undefined ||
            approvalRequest.id !== authorization.decision.approvalId ||
            approvalRequest.runId !== runId ||
            approvalRequest.actionId !== action.id
          ) {
            return this.#fail(
              runId,
              "invalid_approval_request",
              "Policy approval request did not match its Run, action, or decision",
            );
          }
          if (this.#approval?.hasSessionGrant(run.sessionId, approvalRequest)) {
            authorizationDecision = {
              outcome: "allowed",
              reasonCode: "session_approval_grant",
              humanSummary: "本会话已允许相同类型、目标与影响范围的动作。",
            };
          } else {
            this.#record(this.#store.waitForApproval(runId, approvalRequest, this.#metadata()));
            if (this.#approval === undefined) return this.#store.getRun(runId);
            const userDecision = await this.#approval.waitForDecision({
              sessionId: run.sessionId,
              request: approvalRequest,
              signal: abortSignal,
            });
            this.#record(
              this.#store.resolveApproval(
                runId,
                {
                  ...userDecision,
                  actionId: action.id,
                  resolvedAt: this.#clock.now().toISOString(),
                },
                this.#metadata(),
              ),
            );
            if (userDecision.decision === "approve" && userDecision.rememberForSession) {
              this.#approval.rememberSessionGrant(run.sessionId, approvalRequest);
            }
            if (userDecision.decision === "deny") {
              const deniedDecision: AuthorizationDecision = {
                outcome: "denied",
                reasonCode: "user_denied_approval",
                humanSummary: "用户拒绝了该动作。",
                approvalId: approvalRequest.id,
              };
              this.#record(this.#ledger.deny(action, deniedDecision, this.#metadata()));
              return this.#fail(runId, deniedDecision.reasonCode, deniedDecision.humanSummary);
            }
            authorizationDecision = {
              outcome: "allowed",
              reasonCode: userDecision.rememberForSession
                ? "user_approved_for_session"
                : "user_approved_once",
              humanSummary: userDecision.rememberForSession
                ? "用户允许本次动作，并记住本会话内完全相同的授权范围。"
                : "用户仅允许本次动作。",
              approvalId: approvalRequest.id,
            };
          }
        }
        if (authorizationDecision.outcome === "denied") {
          this.#record(this.#ledger.deny(action, authorizationDecision, this.#metadata()));
          return this.#fail(
            runId,
            authorizationDecision.reasonCode,
            authorizationDecision.humanSummary,
          );
        }
        this.#record(this.#ledger.authorize(action, authorizationDecision, this.#metadata()));

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
        observations.push({ actionId: action.id, toolName: action.toolName, observation });

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
      this.#lastEventId = this.#store.listEvents(runId).at(-1)?.eventId ?? this.#lastEventId;
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
    observations: readonly ReasonObservation[],
    contextItems: readonly ContextItem[],
    signal: AbortSignal,
  ): Promise<ModelDecision> {
    let decision: ModelDecision | undefined;
    for await (const rawSignal of this.#model.reason(
      { runId: run.id, cycle, userInput: run.userInput, observations, contextItems },
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
      } else if (modelSignal.kind === "stream_recovery") {
        this.#record(
          this.#store.appendEvent({
            ...this.#metadata(),
            runId: run.id,
            type: "model.stream.recovery",
            payload: {
              recoveryAttempt: modelSignal.recoveryAttempt,
              priorEventCount: modelSignal.priorEventCount,
            },
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

  async #prepareContext(run: RunRecord): Promise<readonly ContextItem[]> {
    if (this.#context === undefined) {
      return [
        {
          id: `${run.id}-user`,
          kind: "user",
          content: run.userInput,
          createdAt: run.createdAt,
          provenanceEventIds: [],
        },
      ];
    }
    const prepared = await this.#context.prepare({
      run,
      traceId: this.#traceId,
      nextEventId: () => this.#ids.next("event"),
      now: () => this.#clock.now(),
    });
    for (const event of prepared.emittedEvents) this.#record(event);
    return prepared.items;
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

import { DatabaseSync } from "node:sqlite";

import {
  actionRecordSchema,
  approvalRequestSchema,
  approvalResolutionSchema,
  runEventSchema,
  runRecordSchema,
  type ActionRecord,
  type ActionState,
  type ApprovalRequest,
  type ApprovalResolution,
  type RunEvent,
  type RunEventType,
  type RunRecord,
  type RunStage,
} from "@aquawisp/contracts";

export interface EventMetadata {
  readonly eventId: string;
  readonly timestamp: string;
  readonly traceId: string;
  readonly parentEventId: string | null;
}

export interface PendingRunEvent extends EventMetadata {
  readonly runId: string;
  readonly type: RunEventType;
  readonly payload: unknown;
}

export interface RebuiltRun {
  readonly run: RunRecord;
  readonly actions: ReadonlyMap<string, ActionRecord>;
  readonly timeline: readonly RunEvent[];
}

export interface EventStoreOptions {
  readonly databasePath: string;
  readonly onEvent?: (event: RunEvent) => void;
}

interface SequenceRow {
  readonly next_sequence: number;
}

interface JsonEventRow {
  readonly event_id: string;
  readonly run_id: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly trace_id: string;
  readonly parent_event_id: string | null;
  readonly type: RunEventType;
  readonly payload_json: string;
}

interface RunRow {
  readonly run_id: string;
  readonly session_id: string;
  readonly status: RunRecord["status"];
  readonly current_stage: RunStage | null;
  readonly user_input: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly final_output: string | null;
  readonly error_code: string | null;
  readonly error_message: string | null;
  readonly revision: number;
}

interface ActionRow {
  readonly action_id: string;
  readonly run_id: string;
  readonly step_id: string;
  readonly tool_name: string;
  readonly tool_revision: string;
  readonly input_json: string;
  readonly side_effect: number;
  readonly idempotency_key: string;
  readonly state: ActionState;
  readonly created_at: string;
  readonly updated_at: string;
}

const schemaSql = `
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = FULL;
  PRAGMA user_version = 1;

  CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    status TEXT NOT NULL,
    current_stage TEXT,
    user_input TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    final_output TEXT,
    error_code TEXT,
    error_message TEXT,
    revision INTEGER NOT NULL,
    next_sequence INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS events (
    run_id TEXT NOT NULL REFERENCES runs(run_id),
    sequence INTEGER NOT NULL,
    event_id TEXT NOT NULL UNIQUE,
    timestamp TEXT NOT NULL,
    trace_id TEXT NOT NULL,
    parent_event_id TEXT,
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (run_id, sequence)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS events_trace_idx ON events(trace_id, sequence);

  CREATE TABLE IF NOT EXISTS actions (
    action_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(run_id),
    step_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    tool_revision TEXT NOT NULL,
    input_json TEXT NOT NULL,
    side_effect INTEGER NOT NULL CHECK(side_effect IN (0, 1)),
    idempotency_key TEXT NOT NULL UNIQUE,
    state TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
`;

export class SqliteEventStore {
  readonly #database: DatabaseSync;
  readonly #onEvent: ((event: RunEvent) => void) | undefined;

  constructor(options: EventStoreOptions) {
    this.#database = new DatabaseSync(options.databasePath);
    this.#onEvent = options.onEvent;
    this.#database.exec(schemaSql);
  }

  close(): void {
    this.#database.close();
  }

  createRun(runInput: RunRecord, metadata: EventMetadata): RunEvent {
    const run = runRecordSchema.parse(runInput);
    return this.#emit(
      this.#transaction(() => {
        this.#database
          .prepare(
            `INSERT INTO runs (
            run_id, session_id, status, current_stage, user_input, created_at, updated_at,
            final_output, error_code, error_message, revision, next_sequence
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          )
          .run(
            run.id,
            run.sessionId,
            run.status,
            run.currentStage,
            run.userInput,
            run.createdAt,
            run.updatedAt,
            run.finalOutput,
            run.errorCode,
            run.errorMessage,
            run.revision,
          );
        return this.#appendEventInTransaction({
          ...metadata,
          runId: run.id,
          type: "run.created",
          payload: run,
        });
      }),
    );
  }

  appendEvent(event: PendingRunEvent): RunEvent {
    return this.#emit(this.#transaction(() => this.#appendEventInTransaction(event)));
  }

  appendEvents(events: readonly PendingRunEvent[]): readonly RunEvent[] {
    if (events.length === 0) {
      return [];
    }
    const runId = events[0]?.runId;
    if (runId === undefined || events.some((event) => event.runId !== runId)) {
      throw new Error("An event batch must target exactly one run");
    }
    return this.#emitMany(
      this.#transaction(() => events.map((event) => this.#appendEventInTransaction(event))),
    );
  }

  enterStage(runId: string, stage: RunStage, cycle: number, metadata: EventMetadata): RunEvent {
    return this.#emit(
      this.#transaction(() => {
        const result = this.#database
          .prepare(
            `UPDATE runs
           SET status = 'running', current_stage = ?, updated_at = ?, revision = revision + 1
           WHERE run_id = ? AND status NOT IN ('completed', 'failed', 'cancelled', 'interrupted')`,
          )
          .run(stage, metadata.timestamp, runId);
        if (result.changes !== 1) {
          throw new Error(`Cannot enter stage ${stage} for terminal or missing run ${runId}`);
        }
        return this.#appendEventInTransaction({
          ...metadata,
          runId,
          type: "run.stage.entered",
          payload: { stage, cycle },
        });
      }),
    );
  }

  planAction(actionInput: ActionRecord, metadata: EventMetadata): RunEvent {
    const action = actionRecordSchema.parse(actionInput);
    if (action.state !== "planned") {
      throw new Error(`New action ${action.id} must start in planned state`);
    }
    return this.#emit(
      this.#transaction(() => {
        this.#database
          .prepare(
            `INSERT INTO actions (
            action_id, run_id, step_id, tool_name, tool_revision, input_json, side_effect,
            idempotency_key, state, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            action.id,
            action.runId,
            action.stepId,
            action.toolName,
            action.toolRevision,
            JSON.stringify(action.input),
            action.sideEffect ? 1 : 0,
            action.idempotencyKey,
            action.state,
            action.createdAt,
            action.updatedAt,
          );
        return this.#appendEventInTransaction({
          ...metadata,
          runId: action.runId,
          type: "action.planned",
          payload: { action },
        });
      }),
    );
  }

  transitionAction(
    actionId: string,
    expectedState: ActionState,
    nextState: ActionState,
    event: PendingRunEvent,
  ): RunEvent {
    return this.#emit(
      this.#transaction(() => {
        const result = this.#database
          .prepare(
            `UPDATE actions SET state = ?, updated_at = ?
           WHERE action_id = ? AND run_id = ? AND state = ?`,
          )
          .run(nextState, event.timestamp, actionId, event.runId, expectedState);
        if (result.changes !== 1) {
          throw new Error(
            `Action ${actionId} transition ${expectedState} -> ${nextState} was rejected`,
          );
        }
        return this.#appendEventInTransaction(event);
      }),
    );
  }

  completeRun(runId: string, finalOutput: string, metadata: EventMetadata): RunEvent {
    return this.#finishRun(
      runId,
      "completed",
      "run.completed",
      { finalOutput },
      metadata,
      finalOutput,
      null,
      null,
    );
  }

  waitForApproval(runId: string, request: ApprovalRequest, metadata: EventMetadata): RunEvent {
    return this.#emit(
      this.#transaction(() => {
        const result = this.#database
          .prepare(
            `UPDATE runs SET status = 'waiting_approval', updated_at = ?, revision = revision + 1
             WHERE run_id = ? AND status = 'running'`,
          )
          .run(metadata.timestamp, runId);
        if (result.changes !== 1) {
          throw new Error(`Cannot wait for approval on inactive or missing run ${runId}`);
        }
        return this.#appendEventInTransaction({
          ...metadata,
          runId,
          type: "approval.required",
          payload: { request },
        });
      }),
    );
  }

  resolveApproval(
    runId: string,
    resolutionInput: ApprovalResolution,
    metadata: EventMetadata,
  ): RunEvent {
    const resolution = approvalResolutionSchema.parse(resolutionInput);
    if (resolution.runId !== runId) {
      throw new Error("Approval resolution does not belong to the specified Run");
    }
    return this.#emit(
      this.#transaction(() => {
        const pendingRow = this.#database
          .prepare(
            "SELECT payload_json FROM events WHERE run_id = ? AND type = 'approval.required' ORDER BY sequence DESC LIMIT 1",
          )
          .get(runId) as { payload_json: string } | undefined;
        const pending = approvalRequestSchema.parse(
          (JSON.parse(pendingRow?.payload_json ?? "null") as { request?: unknown } | null)?.request,
        );
        if (
          pending.id !== resolution.approvalId ||
          pending.actionId !== resolution.actionId ||
          pending.status !== "pending"
        ) {
          throw new Error("Approval resolution does not match the pending approval");
        }
        const result = this.#database
          .prepare(
            `UPDATE runs SET status = 'running', updated_at = ?, revision = revision + 1
             WHERE run_id = ? AND status = 'waiting_approval'`,
          )
          .run(metadata.timestamp, runId);
        if (result.changes !== 1) {
          throw new Error(`Cannot resolve approval on a Run that is not waiting: ${runId}`);
        }
        return this.#appendEventInTransaction({
          ...metadata,
          runId,
          type: "approval.resolved",
          payload: { resolution },
        });
      }),
    );
  }

  cancelRun(runId: string, reason: string, metadata: EventMetadata): RunEvent {
    return this.#finishRun(
      runId,
      "cancelled",
      "run.cancelled",
      { reason },
      metadata,
      null,
      null,
      null,
    );
  }

  failRun(
    runId: string,
    code: string,
    message: string,
    details: Readonly<Record<string, never>>,
    metadata: EventMetadata,
  ): RunEvent {
    return this.#finishRun(
      runId,
      "failed",
      "run.failed",
      { code, message, details },
      metadata,
      null,
      code,
      message,
    );
  }

  getRun(runId: string): RunRecord {
    const row = this.#database.prepare("SELECT * FROM runs WHERE run_id = ?").get(runId) as
      RunRow | undefined;
    if (row === undefined) {
      throw new Error(`Run not found: ${runId}`);
    }
    return runRecordSchema.parse({
      id: row.run_id,
      sessionId: row.session_id,
      status: row.status,
      currentStage: row.current_stage,
      userInput: row.user_input,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      finalOutput: row.final_output,
      errorCode: row.error_code,
      errorMessage: row.error_message,
      revision: row.revision,
    });
  }

  listEvents(runId: string): readonly RunEvent[] {
    const rows = this.#database
      .prepare("SELECT * FROM events WHERE run_id = ? ORDER BY sequence ASC")
      .all(runId) as unknown as JsonEventRow[];
    return rows.map((row) => parseJsonEventRow(row));
  }

  listEventsForSession(sessionId: string): readonly RunEvent[] {
    const rows = this.#database
      .prepare(
        `SELECT events.* FROM events
         INNER JOIN runs ON runs.run_id = events.run_id
         WHERE runs.session_id = ?
         ORDER BY runs.created_at ASC, events.sequence ASC`,
      )
      .all(sessionId) as unknown as JsonEventRow[];
    return rows.map(parseJsonEventRow);
  }

  listActions(runId: string): readonly ActionRecord[] {
    const rows = this.#database
      .prepare("SELECT * FROM actions WHERE run_id = ? ORDER BY created_at, action_id")
      .all(runId) as unknown as ActionRow[];
    return rows.map((row) =>
      actionRecordSchema.parse({
        id: row.action_id,
        runId: row.run_id,
        stepId: row.step_id,
        toolName: row.tool_name,
        toolRevision: row.tool_revision,
        input: JSON.parse(row.input_json) as unknown,
        sideEffect: row.side_effect === 1,
        idempotencyKey: row.idempotency_key,
        state: row.state,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    );
  }

  rebuildRun(runId: string): RebuiltRun {
    const timeline = this.listEvents(runId);
    const created = timeline[0];
    if (created?.type !== "run.created") {
      throw new Error(`Run ${runId} does not begin with run.created`);
    }

    let run: RunRecord = created.payload;
    const actions = new Map<string, ActionRecord>();
    for (const event of timeline.slice(1)) {
      if (event.type === "run.stage.entered") {
        run = {
          ...run,
          status: "running",
          currentStage: event.payload.stage,
          updatedAt: event.timestamp,
          revision: run.revision + 1,
        };
      } else if (event.type === "action.planned") {
        actions.set(event.payload.action.id, event.payload.action);
      } else if (event.type.startsWith("action.")) {
        const actionId = "actionId" in event.payload ? event.payload.actionId : undefined;
        const action = actionId === undefined ? undefined : actions.get(actionId);
        if (action !== undefined) {
          const state = actionStateForEvent(event.type);
          if (state !== undefined) {
            actions.set(action.id, { ...action, state, updatedAt: event.timestamp });
          }
        }
      } else if (event.type === "run.completed") {
        run = {
          ...run,
          status: "completed",
          currentStage: null,
          finalOutput: event.payload.finalOutput,
          updatedAt: event.timestamp,
          revision: run.revision + 1,
        };
      } else if (event.type === "run.failed") {
        run = {
          ...run,
          status: "failed",
          currentStage: null,
          errorCode: event.payload.code,
          errorMessage: event.payload.message,
          updatedAt: event.timestamp,
          revision: run.revision + 1,
        };
      } else if (event.type === "run.cancelled") {
        run = {
          ...run,
          status: "cancelled",
          currentStage: null,
          updatedAt: event.timestamp,
          revision: run.revision + 1,
        };
      } else if (event.type === "approval.required") {
        run = {
          ...run,
          status: "waiting_approval",
          updatedAt: event.timestamp,
          revision: run.revision + 1,
        };
      } else if (event.type === "approval.resolved") {
        run = {
          ...run,
          status: "running",
          updatedAt: event.timestamp,
          revision: run.revision + 1,
        };
      }
    }
    return { run: runRecordSchema.parse(run), actions, timeline };
  }

  #finishRun(
    runId: string,
    status: "completed" | "failed" | "cancelled",
    eventType: "run.completed" | "run.failed" | "run.cancelled",
    payload: unknown,
    metadata: EventMetadata,
    finalOutput: string | null,
    errorCode: string | null,
    errorMessage: string | null,
  ): RunEvent {
    return this.#emit(
      this.#transaction(() => {
        const result = this.#database
          .prepare(
            `UPDATE runs SET status = ?, current_stage = NULL, updated_at = ?, final_output = ?,
           error_code = ?, error_message = ?, revision = revision + 1
           WHERE run_id = ? AND status NOT IN ('completed', 'failed', 'cancelled', 'interrupted')`,
          )
          .run(status, metadata.timestamp, finalOutput, errorCode, errorMessage, runId);
        if (result.changes !== 1) {
          throw new Error(`Cannot finish terminal or missing run ${runId}`);
        }
        return this.#appendEventInTransaction({
          ...metadata,
          runId,
          type: eventType,
          payload,
        });
      }),
    );
  }

  #appendEventInTransaction(event: PendingRunEvent): RunEvent {
    const sequenceRow = this.#database
      .prepare("SELECT next_sequence FROM runs WHERE run_id = ?")
      .get(event.runId) as SequenceRow | undefined;
    if (sequenceRow === undefined) {
      throw new Error(`Run not found for event ${event.eventId}: ${event.runId}`);
    }
    const parsed = runEventSchema.parse({ ...event, sequence: sequenceRow.next_sequence });
    this.#database
      .prepare(
        `INSERT INTO events (
          run_id, sequence, event_id, timestamp, trace_id, parent_event_id, type, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        parsed.runId,
        parsed.sequence,
        parsed.eventId,
        parsed.timestamp,
        parsed.traceId,
        parsed.parentEventId,
        parsed.type,
        JSON.stringify(parsed.payload),
      );
    this.#database
      .prepare("UPDATE runs SET next_sequence = next_sequence + 1 WHERE run_id = ?")
      .run(event.runId);
    return parsed;
  }

  #emit(event: RunEvent): RunEvent {
    try {
      this.#onEvent?.(event);
    } catch {
      // The committed event store is authoritative; a streaming observer cannot roll it back.
    }
    return event;
  }

  #emitMany(events: readonly RunEvent[]): readonly RunEvent[] {
    for (const event of events) {
      this.#emit(event);
    }
    return events;
  }

  #transaction<T>(operation: () => T): T {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }
}

function actionStateForEvent(type: RunEventType): ActionState | undefined {
  const states: Partial<Record<RunEventType, ActionState>> = {
    "action.planned": "planned",
    "action.authorized": "authorized",
    "action.dispatched": "dispatched",
    "action.observed": "observed",
    "action.verified": "verified",
    "action.unknown": "unknown",
  };
  return states[type];
}

function parseJsonEventRow(row: JsonEventRow): RunEvent {
  return runEventSchema.parse({
    eventId: row.event_id,
    runId: row.run_id,
    sequence: row.sequence,
    timestamp: row.timestamp,
    traceId: row.trace_id,
    parentEventId: row.parent_event_id,
    type: row.type,
    payload: JSON.parse(row.payload_json) as unknown,
  });
}

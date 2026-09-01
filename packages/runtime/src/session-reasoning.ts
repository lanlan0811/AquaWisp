import { normalizeReasoningRequest } from "@aquawisp/model";
import type { ModelDefinition, ModelProtocol } from "@aquawisp/models-catalog";

import { SqliteEventStore } from "./event-store.js";

export interface SessionReasoningState {
  readonly sessionId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly protocol: ModelProtocol;
  readonly requestedLevel: string;
  readonly canonicalLevel: string;
  readonly modelRevision: string;
}

export interface SetSessionReasoningEffortOptions {
  readonly runId: string;
  readonly sessionId: string;
  readonly model: string | ModelDefinition;
  readonly protocol: ModelProtocol;
  readonly requestedLevel?: string;
  readonly traceId: string;
  readonly now: () => Date;
  readonly nextEventId: () => string;
}

export interface SessionReasoningUpdate {
  readonly state: SessionReasoningState;
  readonly changed: boolean;
}

export class SessionReasoningRegistry {
  readonly #store: SqliteEventStore;
  readonly #states = new Map<string, SessionReasoningState>();

  constructor(store: SqliteEventStore) {
    this.#store = store;
  }

  get(sessionId: string): SessionReasoningState | undefined {
    const cached = this.#states.get(sessionId);
    if (cached !== undefined) {
      return cached;
    }
    const restored = restoreLatestState(this.#store, sessionId);
    if (restored !== undefined) {
      this.#states.set(sessionId, restored);
    }
    return restored;
  }

  set(options: SetSessionReasoningEffortOptions): SessionReasoningUpdate {
    const run = this.#store.getRun(options.runId);
    if (run.sessionId !== options.sessionId) {
      throw new Error(`Run ${options.runId} does not belong to session ${options.sessionId}`);
    }
    const normalized = normalizeReasoningRequest({
      model: options.model,
      protocol: options.protocol,
      ...(options.requestedLevel === undefined ? {} : { requestedLevel: options.requestedLevel }),
      request: {},
    });
    const state: SessionReasoningState = {
      sessionId: options.sessionId,
      providerId: normalized.model.providerId,
      modelId: normalized.model.id,
      protocol: normalized.protocol,
      requestedLevel: normalized.requestedLevel,
      canonicalLevel: normalized.canonicalLevel,
      modelRevision: normalized.revision,
    };
    const previous = this.get(options.sessionId);
    if (previous !== undefined && statesEqual(previous, state)) {
      return { state: previous, changed: false };
    }

    const parentEventId = this.#store.listEvents(options.runId).at(-1)?.eventId ?? null;
    this.#store.appendEvent({
      eventId: options.nextEventId(),
      runId: options.runId,
      type: "session.reasoning_effort.updated",
      timestamp: options.now().toISOString(),
      traceId: options.traceId,
      parentEventId,
      payload: {
        ...state,
        previous:
          previous === undefined
            ? null
            : {
                providerId: previous.providerId,
                modelId: previous.modelId,
                protocol: previous.protocol,
                canonicalLevel: previous.canonicalLevel,
                modelRevision: previous.modelRevision,
              },
      },
    });
    this.#states.set(options.sessionId, state);
    return { state, changed: true };
  }
}

function restoreLatestState(
  store: SqliteEventStore,
  sessionId: string,
): SessionReasoningState | undefined {
  const latest = store
    .listEventsForSession(sessionId)
    .filter((event) => event.type === "session.reasoning_effort.updated")
    .at(-1);
  if (latest?.type !== "session.reasoning_effort.updated") {
    return undefined;
  }
  const {
    sessionId: restoredSessionId,
    providerId,
    modelId,
    protocol,
    requestedLevel,
    canonicalLevel,
    modelRevision,
  } = latest.payload;
  return {
    sessionId: restoredSessionId,
    providerId,
    modelId,
    protocol,
    requestedLevel,
    canonicalLevel,
    modelRevision,
  };
}

function statesEqual(
  previous: SessionReasoningState | undefined,
  next: SessionReasoningState,
): boolean {
  return (
    previous?.providerId === next.providerId &&
    previous.modelId === next.modelId &&
    previous.protocol === next.protocol &&
    previous.canonicalLevel === next.canonicalLevel &&
    previous.modelRevision === next.modelRevision
  );
}

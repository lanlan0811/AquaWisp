import type {
  ActionRecord,
  AuthorizationDecision,
  Observation,
  RunEvent,
  Verification,
} from "@aquawisp/contracts";

import type { EventMetadata } from "./event-store.js";
import { SqliteEventStore } from "./event-store.js";

export class ActionLedger {
  readonly #store: SqliteEventStore;

  constructor(store: SqliteEventStore) {
    this.#store = store;
  }

  plan(action: ActionRecord, metadata: EventMetadata): RunEvent {
    return this.#store.planAction(action, metadata);
  }

  authorize(
    action: ActionRecord,
    decision: AuthorizationDecision,
    metadata: EventMetadata,
  ): RunEvent {
    if (decision.outcome !== "allowed") {
      throw new Error(`Action ${action.id} cannot enter authorized state: ${decision.outcome}`);
    }
    return this.#store.transitionAction(action.id, "planned", "authorized", {
      ...metadata,
      runId: action.runId,
      type: "action.authorized",
      payload: { actionId: action.id, decision },
    });
  }

  deny(action: ActionRecord, decision: AuthorizationDecision, metadata: EventMetadata): RunEvent {
    if (decision.outcome !== "denied") {
      throw new Error(`Action ${action.id} cannot record denial outcome: ${decision.outcome}`);
    }
    return this.#store.appendEvent({
      ...metadata,
      runId: action.runId,
      type: "action.denied",
      payload: { actionId: action.id, decision },
    });
  }

  dispatch(action: ActionRecord, metadata: EventMetadata): RunEvent {
    return this.#store.transitionAction(action.id, "authorized", "dispatched", {
      ...metadata,
      runId: action.runId,
      type: "action.dispatched",
      payload: { actionId: action.id, dispatchedAt: metadata.timestamp },
    });
  }

  observe(action: ActionRecord, observation: Observation, metadata: EventMetadata): RunEvent {
    return this.#store.transitionAction(action.id, "dispatched", "observed", {
      ...metadata,
      runId: action.runId,
      type: "action.observed",
      payload: { actionId: action.id, observation },
    });
  }

  verify(action: ActionRecord, verification: Verification, metadata: EventMetadata): RunEvent {
    if (!verification.success) {
      throw new Error(`Action ${action.id} cannot be verified with unsuccessful evidence`);
    }
    return this.#store.transitionAction(action.id, "observed", "verified", {
      ...metadata,
      runId: action.runId,
      type: "action.verified",
      payload: { actionId: action.id, verification },
    });
  }

  markUnknown(action: ActionRecord, reason: string, metadata: EventMetadata): RunEvent {
    return this.#store.transitionAction(action.id, "dispatched", "unknown", {
      ...metadata,
      runId: action.runId,
      type: "action.unknown",
      payload: { actionId: action.id, reason },
    });
  }
}

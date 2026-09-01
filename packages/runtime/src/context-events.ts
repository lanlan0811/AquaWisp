import type { ContextCheckpointStore, ContextCompilation } from "@aquawisp/context";
import type { RunEvent } from "@aquawisp/contracts";

import { SqliteEventStore, type PendingRunEvent } from "./event-store.js";

export interface ContextEventRecordingOptions {
  readonly store: SqliteEventStore;
  readonly runId: string;
  readonly compilation: ContextCompilation;
  readonly checkpointStore: ContextCheckpointStore;
  readonly traceId: string;
  readonly nextEventId: () => string;
  readonly now: () => Date;
}

export async function recordContextCompilation(
  options: ContextEventRecordingOptions,
): Promise<readonly RunEvent[]> {
  const checkpointReference = await options.checkpointStore.save(options.compilation);
  const timeline = options.store.listEvents(options.runId);
  let parentEventId = timeline.at(-1)?.eventId ?? null;
  const events: PendingRunEvent[] = [];

  if (options.compilation.compaction !== null) {
    const eventId = options.nextEventId();
    events.push({
      eventId,
      runId: options.runId,
      type: "context.compacted",
      timestamp: options.now().toISOString(),
      traceId: options.traceId,
      parentEventId,
      payload: options.compilation.compaction,
    });
    parentEventId = eventId;
  }

  events.push({
    eventId: options.nextEventId(),
    runId: options.runId,
    type: "checkpoint.saved",
    timestamp: options.now().toISOString(),
    traceId: options.traceId,
    parentEventId,
    payload: { ...options.compilation.checkpoint, reference: checkpointReference },
  });

  return options.store.appendEvents(events);
}

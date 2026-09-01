import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionReasoningRegistry, SqliteEventStore } from "@aquawisp/runtime";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const timestamp = "2026-08-29T00:00:00.000Z";

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createStore(): Promise<SqliteEventStore> {
  const directory = await mkdtemp(join(tmpdir(), "AquaWisp M2 reasoning-"));
  temporaryDirectories.push(directory);
  const store = new SqliteEventStore({ databasePath: join(directory, "events.sqlite") });
  store.createRun(
    {
      id: "run-reasoning",
      sessionId: "session-reasoning",
      status: "created",
      currentStage: null,
      userInput: "configure reasoning",
      createdAt: timestamp,
      updatedAt: timestamp,
      finalOutput: null,
      errorCode: null,
      errorMessage: null,
      revision: 0,
    },
    {
      eventId: "event-created",
      timestamp,
      traceId: "trace-reasoning",
      parentEventId: null,
    },
  );
  return store;
}

describe("M2 session reasoning effort", () => {
  it("persists canonical effort and model revision, ignores equivalent aliases, and restores it", async () => {
    const store = await createStore();
    const registry = new SessionReasoningRegistry(store);
    let eventNumber = 0;
    const common = {
      runId: "run-reasoning",
      sessionId: "session-reasoning",
      model: "deepseek-v4-pro",
      protocol: "chat_completions" as const,
      traceId: "trace-reasoning",
      now: () => new Date(timestamp),
      nextEventId: () => `event-reasoning-${(eventNumber += 1).toString()}`,
    };

    const first = registry.set({ ...common, requestedLevel: "medium" });
    const equivalent = registry.set({ ...common, requestedLevel: "high" });
    const changed = registry.set({ ...common, requestedLevel: "xhigh" });
    const restored = new SessionReasoningRegistry(store).get("session-reasoning");
    const events = store
      .listEventsForSession("session-reasoning")
      .filter((event) => event.type === "session.reasoning_effort.updated");
    store.close();

    expect(first).toMatchObject({
      changed: true,
      state: { canonicalLevel: "high", requestedLevel: "medium" },
    });
    expect(equivalent).toEqual({ state: first.state, changed: false });
    expect(changed).toMatchObject({
      changed: true,
      state: { canonicalLevel: "max", requestedLevel: "xhigh" },
    });
    expect(changed.state.modelRevision).not.toBe(first.state.modelRevision);
    expect(restored).toEqual(changed.state);
    expect(events).toHaveLength(2);
    expect(events[0]?.payload).toMatchObject({ previous: null });
    expect(events[1]?.payload).toMatchObject({
      previous: { canonicalLevel: "high", modelRevision: first.state.modelRevision },
    });
    expect(events[1]?.parentEventId).toBe(events[0]?.eventId);
  });

  it("rejects updates that try to write a different session through the run", async () => {
    const store = await createStore();
    const registry = new SessionReasoningRegistry(store);

    expect(() =>
      registry.set({
        runId: "run-reasoning",
        sessionId: "other-session",
        model: "deepseek-v4-pro",
        protocol: "chat_completions",
        traceId: "trace-reasoning",
        requestedLevel: "high",
        now: () => new Date(timestamp),
        nextEventId: () => "event-rejected",
      }),
    ).toThrow("does not belong to session");
    store.close();
  });
});

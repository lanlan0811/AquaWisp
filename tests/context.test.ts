import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CharacterRatioTokenEstimator,
  ContextBudgetExceededError,
  ContextManager,
  FileContextCheckpointStore,
  type ContextBudgetConfig,
  type ContextItem,
  type ContextManagerOptions,
} from "@aquawisp/context";
import { recordContextCompilation, SqliteEventStore } from "@aquawisp/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

const temporaryDirectories: string[] = [];
const timestamp = "2026-08-29T00:00:00.000Z";

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

function item(
  id: string,
  kind: ContextItem["kind"],
  content: string,
  provenanceEventIds: readonly string[] = [`event-${id}`],
): ContextItem {
  return { id, kind, content, createdAt: timestamp, provenanceEventIds };
}

function budget(overrides: Partial<ContextBudgetConfig> = {}): ContextBudgetConfig {
  return {
    maxTokens: 80,
    compressionThresholdRatio: 0.5,
    recentWindowTokens: 20,
    maximumSummaryTokens: 12,
    toolInlineTokenLimit: 10,
    ...overrides,
  };
}

function managerOptions(overrides: Partial<ContextManagerOptions> = {}): ContextManagerOptions {
  return {
    budget: budget(),
    estimator: new CharacterRatioTokenEstimator(1),
    summarizer: { summarize: vi.fn(() => Promise.resolve("summary")) },
    externalizer: {
      externalize: vi.fn((source: ContextItem) =>
        Promise.resolve({
          itemId: source.id,
          reference: `artifact:${source.id}`,
          preview: "preview",
        }),
      ),
    },
    ids: { nextSummaryId: () => "summary-1" },
    now: () => new Date(timestamp),
    ...overrides,
  };
}

describe("M2 context manager", () => {
  it("keeps context unchanged below the threshold and creates a stable checkpoint", async () => {
    const items = [item("system-1", "system", "rules"), item("user-1", "user", "hello")];
    const manager = new ContextManager(managerOptions());

    const first = await manager.compile(items);
    const second = await manager.compile(items);

    expect(first.items).toBe(items);
    expect(first.compaction).toBeNull();
    expect(first.checkpoint).toEqual(second.checkpoint);
    expect(first.checkpoint.revision).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("summarizes old turns, preserves recent turns, and externalizes every large tool result", async () => {
    const sourceItems = [
      item("system-1", "system", "SYS"),
      item("user-old", "user", "123456789012345", ["event-user-old"]),
      item("tool-old", "tool", "abcdefghijklmnopqrst", ["event-tool-old"]),
      item("assistant-new", "assistant", "1234567890"),
      item("user-new", "user", "abcdefghij"),
    ];
    const sourceSnapshot = structuredClone(sourceItems);
    const summarize = vi.fn(() => Promise.resolve("summary"));
    const options = managerOptions({ summarizer: { summarize } });
    const manager = new ContextManager(options);

    const compilation = await manager.compile(sourceItems);

    expect(compilation.items.map(({ id }) => id)).toEqual([
      "system-1",
      "summary-1",
      "assistant-new",
      "user-new",
    ]);
    expect(compilation.items[1]?.provenanceEventIds).toEqual(["event-user-old", "event-tool-old"]);
    expect(compilation.compaction).toMatchObject({
      beforeTokens: 58,
      summaryItemId: "summary-1",
      retainedItemIds: ["system-1", "summary-1", "assistant-new", "user-new"],
      removedItemIds: ["user-old", "tool-old"],
      artifactReferences: [
        { itemId: "tool-old", reference: "artifact:tool-old", preview: "preview" },
      ],
    });
    expect(summarize).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: "tool-old",
          content: "preview\n\n[artifact: artifact:tool-old]",
        }),
      ]),
      12,
    );
    expect(sourceItems).toEqual(sourceSnapshot);
  });

  it("rejects summaries that exceed their dedicated budget", async () => {
    const manager = new ContextManager(
      managerOptions({
        summarizer: { summarize: () => Promise.resolve("summary-is-far-too-long") },
      }),
    );

    await expect(
      manager.compile([
        item("old", "user", "12345678901234567890"),
        item("recent", "user", "abcdefghijabcdefghijabcdefghij"),
      ]),
    ).rejects.toThrow("Context summarizer exceeded maximumSummaryTokens");
  });

  it("fails explicitly when preserved context cannot fit after compaction", async () => {
    const manager = new ContextManager(
      managerOptions({
        budget: budget({
          maxTokens: 20,
          compressionThresholdRatio: 0.5,
          recentWindowTokens: 15,
          maximumSummaryTokens: 5,
        }),
        summarizer: { summarize: () => Promise.resolve("12345") },
      }),
    );

    await expect(
      manager.compile([
        item("system", "system", "12345678"),
        item("old", "user", "1234567890"),
        item("recent", "user", "123456789012345"),
      ]),
    ).rejects.toBeInstanceOf(ContextBudgetExceededError);
  });

  it("rejects invalid budgets and invalid artifact references", async () => {
    expect(
      () =>
        new ContextManager(managerOptions({ budget: budget({ compressionThresholdRatio: 1.1 }) })),
    ).toThrow("compressionThresholdRatio");

    const manager = new ContextManager(
      managerOptions({
        externalizer: {
          externalize: () => Promise.resolve({ itemId: "wrong", reference: "", preview: "" }),
        },
      }),
    );
    await expect(
      manager.compile([
        item("old", "user", "12345678901234567890"),
        item("tool", "tool", "x".repeat(30)),
      ]),
    ).rejects.toThrow("Invalid artifact reference");
  });

  it("records compaction and checkpoint events as one parent-linked batch", async () => {
    const directory = await mkdtemp(join(tmpdir(), "AquaWisp M2 context-"));
    temporaryDirectories.push(directory);
    const store = new SqliteEventStore({ databasePath: join(directory, "events.sqlite") });
    const created = store.createRun(
      {
        id: "run-context",
        sessionId: "session-context",
        status: "created",
        currentStage: null,
        userInput: "compile context",
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
        traceId: "trace-context",
        parentEventId: null,
      },
    );
    const compilation = await new ContextManager(managerOptions()).compile([
      item("old", "user", "12345678901234567890"),
      item("recent", "assistant", "abcdefghijabcdefghijabcdefghij"),
    ]);
    let eventNumber = 0;

    const checkpointStore = new FileContextCheckpointStore({
      directory: join(directory, "checkpoints"),
    });
    const recorded = await recordContextCompilation({
      store,
      runId: "run-context",
      compilation,
      checkpointStore,
      traceId: "trace-context",
      nextEventId: () => `event-context-${(eventNumber += 1).toString()}`,
      now: () => new Date(timestamp),
    });
    const checkpoint = await checkpointStore.load(
      (recorded[1]?.payload as { reference: string }).reference,
    );
    store.close();

    expect(recorded.map(({ type }) => type)).toEqual(["context.compacted", "checkpoint.saved"]);
    expect(recorded[0]?.parentEventId).toBe(created.eventId);
    expect(recorded[1]?.parentEventId).toBe(recorded[0]?.eventId);
    expect(recorded[1]?.payload).toMatchObject(compilation.checkpoint);
    expect(checkpoint).toMatchObject({
      checkpoint: compilation.checkpoint,
      items: compilation.items,
    });
  });
});

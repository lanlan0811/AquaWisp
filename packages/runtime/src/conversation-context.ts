import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CharacterRatioTokenEstimator,
  ContextManager,
  FileContextCheckpointStore,
  type ContextItem,
  type ContextSummarizer,
  type TokenEstimator,
  type ToolArtifactReference,
  type ToolResultExternalizer,
} from "@aquawisp/context";
import type { RunEvent } from "@aquawisp/contracts";
import type { ModelDefinition, ModelProtocol } from "@aquawisp/models-catalog";
import { z } from "zod";

import { recordContextCompilation } from "./context-events.js";
import { SqliteEventStore } from "./event-store.js";
import type { RunContextPort, RunContextPreparationRequest } from "./ports.js";
import type { RuntimeContextConfig } from "./runtime-host-config.js";
import { SessionReasoningRegistry } from "./session-reasoning.js";

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const promptBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    resourceVersion: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    sources: z.array(z.string().min(1)),
    prompts: z.array(
      z
        .object({
          id: z.string().min(1),
          source: z.string().min(1),
          sha256: digestSchema,
          content: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict()
  .refine(
    ({ sources, prompts }) =>
      sources.length === prompts.length &&
      sources.every((source, index) => prompts[index]?.source === source) &&
      new Set(sources).size === sources.length &&
      new Set(prompts.map(({ id }) => id)).size === prompts.length,
    "Prompt bundle sources and prompt entries must be unique and ordered identically",
  );

export interface PersistentConversationContextOptions {
  readonly store: SqliteEventStore;
  readonly workingDirectory: string;
  readonly model: ModelDefinition;
  readonly protocol: ModelProtocol;
  readonly reasoningLevel: string;
  readonly config: RuntimeContextConfig;
  readonly promptBundlePath?: string;
}

export class PersistentConversationContext implements RunContextPort {
  readonly #store: SqliteEventStore;
  readonly #model: ModelDefinition;
  readonly #protocol: ModelProtocol;
  readonly #reasoningLevel: string;
  readonly #manager: ContextManager;
  readonly #checkpointStore: FileContextCheckpointStore;
  readonly #promptBundlePath: string;
  readonly #maximumPromptBundleBytes: number;

  constructor(options: PersistentConversationContextOptions) {
    this.#store = options.store;
    this.#model = options.model;
    this.#protocol = options.protocol;
    this.#reasoningLevel = options.reasoningLevel;
    const estimator = new CharacterRatioTokenEstimator(options.config.charactersPerToken);
    this.#manager = new ContextManager({
      budget: {
        maxTokens: options.config.maxTokens,
        compressionThresholdRatio: options.config.compressionThresholdRatio,
        recentWindowTokens: options.config.recentWindowTokens,
        maximumSummaryTokens: options.config.maximumSummaryTokens,
        toolInlineTokenLimit: options.config.toolInlineTokenLimit,
      },
      estimator,
      summarizer: new ExtractiveConversationSummarizer(estimator),
      externalizer: new FileToolResultExternalizer({
        directory: join(options.workingDirectory, options.config.artifactDirectoryName),
        previewCharacters: options.config.artifactPreviewCharacters,
      }),
      ids: { nextSummaryId: () => `summary-${randomUUID()}` },
      now: () => new Date(),
    });
    this.#checkpointStore = new FileContextCheckpointStore({
      directory: join(options.workingDirectory, options.config.checkpointDirectoryName),
    });
    this.#promptBundlePath =
      options.promptBundlePath ??
      fileURLToPath(new URL("../resources/prompts/bundle.json", import.meta.url));
    this.#maximumPromptBundleBytes = options.config.maximumPromptBundleBytes;
  }

  async prepare(request: RunContextPreparationRequest) {
    const eventsBeforePreparation = this.#store.listEvents(request.run.id).length;
    new SessionReasoningRegistry(this.#store).set({
      runId: request.run.id,
      sessionId: request.run.sessionId,
      model: this.#model,
      protocol: this.#protocol,
      requestedLevel: this.#reasoningLevel,
      traceId: request.traceId,
      now: request.now,
      nextEventId: request.nextEventId,
    });
    const bundle = await loadPromptBundle(this.#promptBundlePath, this.#maximumPromptBundleBytes);
    const compilation = await this.#manager.compile([
      {
        id: `system-${bundle.resourceVersion.slice("sha256:".length)}`,
        kind: "system",
        content: bundle.prompts.map(({ content }) => content).join("\n\n---\n\n"),
        createdAt: request.run.createdAt,
        provenanceEventIds: [],
      },
      ...contextItemsFromSession(this.#store, request.run.sessionId, request.run.id),
    ]);
    await recordContextCompilation({
      store: this.#store,
      runId: request.run.id,
      compilation,
      checkpointStore: this.#checkpointStore,
      traceId: request.traceId,
      nextEventId: request.nextEventId,
      now: request.now,
    });
    return {
      items: compilation.items,
      emittedEvents: this.#store.listEvents(request.run.id).slice(eventsBeforePreparation),
    };
  }
}

class ExtractiveConversationSummarizer implements ContextSummarizer {
  readonly #estimator: TokenEstimator;

  constructor(estimator: TokenEstimator) {
    this.#estimator = estimator;
  }

  summarize(items: readonly ContextItem[], maximumTokens: number): Promise<string> {
    const source = items.map((item) => `[${item.kind}] ${item.content}`).join("\n");
    const characters = Array.from(source);
    let lower = 1;
    let upper = characters.length;
    let accepted = characters[0] ?? "会话摘要";
    while (lower <= upper) {
      const middle = Math.floor((lower + upper) / 2);
      const candidate = characters.slice(0, middle).join("");
      if (this.#estimator.estimate(candidate) <= maximumTokens) {
        accepted = candidate;
        lower = middle + 1;
      } else {
        upper = middle - 1;
      }
    }
    return Promise.resolve(accepted);
  }
}

interface FileToolResultExternalizerOptions {
  readonly directory: string;
  readonly previewCharacters: number;
}

class FileToolResultExternalizer implements ToolResultExternalizer {
  readonly #directory: string;
  readonly #previewCharacters: number;

  constructor(options: FileToolResultExternalizerOptions) {
    this.#directory = options.directory;
    this.#previewCharacters = options.previewCharacters;
  }

  async externalize(item: ContextItem): Promise<ToolArtifactReference> {
    const digest = hash(item.content);
    const targetPath = join(this.#directory, `${digest}.txt`);
    const temporaryPath = join(this.#directory, `.${randomUUID()}.tmp`);
    await mkdir(this.#directory, { recursive: true });
    try {
      await writeFile(temporaryPath, item.content, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, targetPath).catch(async (error: unknown) => {
        if (!(await fileMatchesDigest(targetPath, digest))) throw error;
      });
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
    return {
      itemId: item.id,
      reference: `context-artifact:sha256:${digest}`,
      preview: Array.from(item.content).slice(0, this.#previewCharacters).join(""),
    };
  }
}

function contextItemsFromSession(
  store: SqliteEventStore,
  sessionId: string,
  currentRunId: string,
): ContextItem[] {
  const items: ContextItem[] = [];
  const sessionEvents = store.listEventsForSession(sessionId);
  const eventGroups = new Map<string, RunEvent[]>();
  for (const event of sessionEvents) {
    const group = eventGroups.get(event.runId) ?? [];
    group.push(event);
    eventGroups.set(event.runId, group);
  }
  const orderedRunIds = [
    ...Array.from(eventGroups.keys()).filter((runId) => runId !== currentRunId),
    ...(eventGroups.has(currentRunId) ? [currentRunId] : []),
  ];
  for (const runId of orderedRunIds) {
    const runEvents = eventGroups.get(runId) ?? [];
    const created = runEvents.find(({ type }) => type === "run.created");
    if (created?.type !== "run.created") continue;
    items.push({
      id: `user-${created.eventId}`,
      kind: "user",
      content: created.payload.userInput,
      createdAt: created.timestamp,
      provenanceEventIds: [created.eventId],
    });
    for (const event of runEvents) {
      if (event.type !== "action.observed") continue;
      items.push({
        id: `tool-${event.eventId}`,
        kind: "tool",
        content: JSON.stringify(event.payload.observation),
        createdAt: event.timestamp,
        provenanceEventIds: [event.eventId],
      });
    }
    const completed = runEvents.find(({ type }) => type === "run.completed");
    if (completed?.type === "run.completed") {
      items.push({
        id: `assistant-${completed.eventId}`,
        kind: "assistant",
        content: completed.payload.finalOutput,
        createdAt: completed.timestamp,
        provenanceEventIds: [completed.eventId],
      });
      continue;
    }
    const deltas = runEvents.filter(
      (event): event is Extract<RunEvent, { type: "model.delta" }> => event.type === "model.delta",
    );
    const partialContent = deltas.map(({ payload }) => payload.delta).join("");
    const lastDelta = deltas.at(-1);
    if (partialContent !== "" && lastDelta !== undefined) {
      items.push({
        id: `assistant-partial-${lastDelta.eventId}`,
        kind: "assistant",
        content: partialContent,
        createdAt: lastDelta.timestamp,
        provenanceEventIds: deltas.map(({ eventId }) => eventId),
      });
    }
  }
  return items;
}

async function loadPromptBundle(path: string, maximumBytes: number) {
  const bundleStats = await stat(path);
  if (!bundleStats.isFile() || bundleStats.size > maximumBytes) {
    throw new Error("Prompt bundle is not a regular file within the configured size limit");
  }
  const bundle = promptBundleSchema.parse(JSON.parse(await readFile(path, "utf8")) as unknown);
  for (const prompt of bundle.prompts) {
    if (hash(prompt.content) !== prompt.sha256) {
      throw new Error(`Prompt bundle content hash mismatch: ${prompt.source}`);
    }
  }
  const aggregate = bundle.prompts.map(({ source, sha256 }) => `${source}:${sha256}`).join("\n");
  if (`sha256:${hash(aggregate)}` !== bundle.resourceVersion) {
    throw new Error("Prompt bundle aggregate hash mismatch");
  }
  return bundle;
}

async function fileMatchesDigest(path: string, digest: string): Promise<boolean> {
  try {
    return hash(await readFile(path, "utf8")) === digest;
  } catch {
    return false;
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

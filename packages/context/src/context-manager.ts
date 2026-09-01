import { createHash } from "node:crypto";

import type {
  ContextBudgetConfig,
  ContextCheckpoint,
  ContextCompilation,
  ContextIdGenerator,
  ContextItem,
  ContextSummarizer,
  TokenEstimator,
  ToolArtifactReference,
  ToolResultExternalizer,
} from "./types.js";

export interface ContextManagerOptions {
  readonly budget: ContextBudgetConfig;
  readonly estimator: TokenEstimator;
  readonly summarizer: ContextSummarizer;
  readonly externalizer: ToolResultExternalizer;
  readonly ids: ContextIdGenerator;
  readonly now: () => Date;
}

export class ContextBudgetExceededError extends Error {
  readonly tokenCount: number;
  readonly maximumTokens: number;

  constructor(tokenCount: number, maximumTokens: number) {
    super(
      `Compacted context requires ${tokenCount.toString()} tokens, exceeding ${maximumTokens.toString()}`,
    );
    this.name = "ContextBudgetExceededError";
    this.tokenCount = tokenCount;
    this.maximumTokens = maximumTokens;
  }
}

export class ContextManager {
  readonly #budget: ContextBudgetConfig;
  readonly #estimator: TokenEstimator;
  readonly #summarizer: ContextSummarizer;
  readonly #externalizer: ToolResultExternalizer;
  readonly #ids: ContextIdGenerator;
  readonly #now: () => Date;

  constructor(options: ContextManagerOptions) {
    validateBudget(options.budget);
    this.#budget = options.budget;
    this.#estimator = options.estimator;
    this.#summarizer = options.summarizer;
    this.#externalizer = options.externalizer;
    this.#ids = options.ids;
    this.#now = options.now;
  }

  async compile(items: readonly ContextItem[]): Promise<ContextCompilation> {
    validateItems(items);
    const beforeTokens = this.#countTokens(items);
    const threshold = Math.floor(this.#budget.maxTokens * this.#budget.compressionThresholdRatio);
    if (beforeTokens <= threshold) {
      return { items, checkpoint: this.#checkpoint(items, beforeTokens), compaction: null };
    }

    const artifactReferences: ToolArtifactReference[] = [];
    const materializedItems: ContextItem[] = [];
    for (const item of items) {
      if (
        item.kind === "tool" &&
        this.#estimator.estimate(item.content) > this.#budget.toolInlineTokenLimit
      ) {
        const artifact = await this.#externalizer.externalize(item);
        validateArtifact(item, artifact);
        artifactReferences.push(artifact);
        materializedItems.push({
          ...item,
          content: `${artifact.preview}\n\n[artifact: ${artifact.reference}]`,
        });
      } else {
        materializedItems.push(item);
      }
    }

    const systemItems = materializedItems.filter(({ kind }) => kind === "system");
    const conversationalItems = materializedItems.filter(({ kind }) => kind !== "system");
    const recentItems = selectRecentWindow(
      conversationalItems,
      this.#budget.recentWindowTokens,
      this.#estimator,
    );
    const recentIds = new Set(recentItems.map(({ id }) => id));
    const oldItems = conversationalItems.filter(({ id }) => !recentIds.has(id));
    let summaryItem: ContextItem | undefined;
    if (oldItems.length > 0) {
      const summary = await this.#summarizer.summarize(oldItems, this.#budget.maximumSummaryTokens);
      if (this.#estimator.estimate(summary) > this.#budget.maximumSummaryTokens) {
        throw new Error("Context summarizer exceeded maximumSummaryTokens");
      }
      summaryItem = {
        id: this.#ids.nextSummaryId(),
        kind: "summary",
        content: summary,
        createdAt: this.#now().toISOString(),
        provenanceEventIds: oldItems.flatMap(({ provenanceEventIds }) => provenanceEventIds),
      };
    }

    const compactedItems = [
      ...systemItems,
      ...(summaryItem === undefined ? [] : [summaryItem]),
      ...recentItems,
    ];
    const afterTokens = this.#countTokens(compactedItems);
    if (afterTokens > this.#budget.maxTokens) {
      throw new ContextBudgetExceededError(afterTokens, this.#budget.maxTokens);
    }
    const checkpoint = this.#checkpoint(compactedItems, afterTokens);
    return {
      items: compactedItems,
      checkpoint,
      compaction: {
        beforeTokens,
        afterTokens,
        summaryItemId: summaryItem?.id ?? null,
        retainedItemIds: compactedItems.map(({ id }) => id),
        removedItemIds: oldItems.map(({ id }) => id),
        artifactReferences,
        checkpointRevision: checkpoint.revision,
      },
    };
  }

  #countTokens(items: readonly ContextItem[]): number {
    return items.reduce((total, item) => total + this.#estimator.estimate(item.content), 0);
  }

  #checkpoint(items: readonly ContextItem[], tokenCount: number): ContextCheckpoint {
    const revisionSource = items
      .map(
        ({ id, content, provenanceEventIds }) =>
          `${id}:${hash(content)}:${provenanceEventIds.join(",")}`,
      )
      .join("\n");
    return {
      revision: `sha256:${hash(revisionSource)}`,
      itemIds: items.map(({ id }) => id),
      tokenCount,
    };
  }
}

export class CharacterRatioTokenEstimator implements TokenEstimator {
  readonly #charactersPerToken: number;
  readonly #segmenter: Intl.Segmenter;

  constructor(charactersPerToken: number) {
    if (!Number.isFinite(charactersPerToken) || charactersPerToken <= 0) {
      throw new Error("charactersPerToken must be positive");
    }
    this.#charactersPerToken = charactersPerToken;
    this.#segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
  }

  estimate(text: string): number {
    let graphemeCount = 0;
    for (const { segment } of this.#segmenter.segment(text)) {
      graphemeCount += segment.length > 0 ? 1 : 0;
    }
    return Math.ceil(graphemeCount / this.#charactersPerToken);
  }
}

function selectRecentWindow(
  items: readonly ContextItem[],
  tokenBudget: number,
  estimator: TokenEstimator,
): readonly ContextItem[] {
  const selected: ContextItem[] = [];
  let tokens = 0;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item === undefined) {
      continue;
    }
    const itemTokens = estimator.estimate(item.content);
    if (selected.length > 0 && tokens + itemTokens > tokenBudget) {
      break;
    }
    selected.unshift(item);
    tokens += itemTokens;
  }
  return selected;
}

function validateBudget(budget: ContextBudgetConfig): void {
  const positiveIntegers = [
    budget.maxTokens,
    budget.recentWindowTokens,
    budget.maximumSummaryTokens,
    budget.toolInlineTokenLimit,
  ];
  if (positiveIntegers.some((value) => !Number.isInteger(value) || value <= 0)) {
    throw new Error("Context token budgets must be positive integers");
  }
  if (budget.compressionThresholdRatio <= 0 || budget.compressionThresholdRatio > 1) {
    throw new Error("compressionThresholdRatio must be in the range (0, 1]");
  }
}

function validateItems(items: readonly ContextItem[]): void {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.id === "" || item.content === "" || ids.has(item.id)) {
      throw new Error("Context items require unique non-empty ids and content");
    }
    ids.add(item.id);
  }
}

function validateArtifact(item: ContextItem, artifact: ToolArtifactReference): void {
  if (
    artifact.itemId !== item.id ||
    artifact.reference.trim() === "" ||
    artifact.preview.trim() === ""
  ) {
    throw new Error(`Invalid artifact reference returned for context item ${item.id}`);
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

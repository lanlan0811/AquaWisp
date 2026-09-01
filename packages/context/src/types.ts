export type ContextItemKind = "system" | "user" | "assistant" | "tool" | "summary";

export interface ContextItem {
  readonly id: string;
  readonly kind: ContextItemKind;
  readonly content: string;
  readonly createdAt: string;
  readonly provenanceEventIds: readonly string[];
}

export interface ContextBudgetConfig {
  readonly maxTokens: number;
  readonly compressionThresholdRatio: number;
  readonly recentWindowTokens: number;
  readonly maximumSummaryTokens: number;
  readonly toolInlineTokenLimit: number;
}

export interface TokenEstimator {
  estimate(text: string): number;
}

export interface ContextSummarizer {
  summarize(items: readonly ContextItem[], maximumTokens: number): Promise<string>;
}

export interface ToolArtifactReference {
  readonly itemId: string;
  readonly reference: string;
  readonly preview: string;
}

export interface ToolResultExternalizer {
  externalize(item: ContextItem): Promise<ToolArtifactReference>;
}

export interface ContextCheckpoint {
  readonly revision: string;
  readonly itemIds: readonly string[];
  readonly tokenCount: number;
}

export interface PersistedContextCheckpoint {
  readonly schemaVersion: 1;
  readonly checkpoint: ContextCheckpoint;
  readonly items: readonly ContextItem[];
}

export interface ContextCompactionRecord {
  readonly beforeTokens: number;
  readonly afterTokens: number;
  readonly summaryItemId: string | null;
  readonly retainedItemIds: readonly string[];
  readonly removedItemIds: readonly string[];
  readonly artifactReferences: readonly ToolArtifactReference[];
  readonly checkpointRevision: string;
}

export interface ContextCompilation {
  readonly items: readonly ContextItem[];
  readonly checkpoint: ContextCheckpoint;
  readonly compaction: ContextCompactionRecord | null;
}

export interface ContextIdGenerator {
  nextSummaryId(): string;
}

export interface ContextCheckpointStore {
  save(compilation: ContextCompilation): Promise<string>;
  load(reference: string): Promise<PersistedContextCheckpoint>;
}

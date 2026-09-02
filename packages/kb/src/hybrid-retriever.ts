import { knowledgeBaseConfig } from "./config.js";
import {
  type KnowledgeBase,
  type KnowledgeChunk,
  type KnowledgeDocument,
  type KnowledgeSearchResult,
} from "./knowledge-base.js";
import { reciprocalRankFusion, type RrfSource } from "./rrf.js";
import type { EmbeddingProvider, VectorIndex } from "./vector.js";

export type KnowledgeSearchMode = "full_text" | "semantic" | "hybrid";
const supportedSearchModes: ReadonlySet<string> = new Set<KnowledgeSearchMode>([
  "full_text",
  "semantic",
  "hybrid",
]);

export interface HybridSearchRequest {
  readonly query: string;
  readonly mode?: KnowledgeSearchMode;
  readonly limit?: number;
}

export interface KnowledgeHighlight {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly snippet: string;
}

export interface HybridSearchResult {
  readonly chunkId: string;
  readonly content: string;
  readonly score: number;
  readonly matchedBy: readonly ("full_text" | "semantic")[];
  readonly source: {
    readonly documentId: string;
    readonly uri: string;
    readonly title: string;
    readonly ordinal: number;
    readonly sourceType: "file" | "web" | "manual";
    readonly tags: readonly string[];
    readonly updatedAt: string;
  };
  readonly highlights: readonly KnowledgeHighlight[];
}

export interface HybridKnowledgeIndexOptions {
  readonly knowledgeBase: KnowledgeBase;
  readonly vectorIndex: VectorIndex;
  readonly embeddingProvider: EmbeddingProvider;
}

export class HybridKnowledgeIndex {
  readonly #knowledgeBase: KnowledgeBase;
  readonly #vectorIndex: VectorIndex;
  readonly #embeddingProvider: EmbeddingProvider;

  constructor(options: HybridKnowledgeIndexOptions) {
    this.#knowledgeBase = options.knowledgeBase;
    this.#vectorIndex = options.vectorIndex;
    this.#embeddingProvider = options.embeddingProvider;
  }

  async add(document: KnowledgeDocument): Promise<readonly KnowledgeChunk[]> {
    const prepared = this.#knowledgeBase.prepareChunks(document);
    const embeddings = await mapConcurrent(
      prepared,
      knowledgeBaseConfig.indexing.embeddingConcurrency,
      async ({ content }) => this.#validatedEmbedding(await this.#embeddingProvider.embed(content)),
    );
    const priorChunkIds = new Set(this.#knowledgeBase.chunks(document.id).map(({ id }) => id));
    const stored = this.#knowledgeBase.add(document);
    const currentChunkIds = new Set(stored.map(({ id }) => id));
    for (const id of priorChunkIds) {
      if (!currentChunkIds.has(id)) this.#vectorIndex.remove(id);
    }
    for (const [index, chunk] of stored.entries()) {
      const embedding = embeddings[index];
      if (embedding === undefined) throw new Error("Embedding result count does not match chunks");
      this.#vectorIndex.upsert(chunk.id, embedding);
    }
    return stored;
  }

  async search(request: HybridSearchRequest): Promise<readonly HybridSearchResult[]> {
    const query = request.query.trim();
    if (query === "") throw new Error("Knowledge search query cannot be empty");
    const mode = request.mode ?? "hybrid";
    if (!supportedSearchModes.has(mode)) {
      throw new Error("Knowledge search mode is unsupported");
    }
    const limit = request.limit ?? knowledgeBaseConfig.search.defaultLimit;
    if (!Number.isInteger(limit) || limit <= 0 || limit > knowledgeBaseConfig.search.maximumLimit) {
      throw new Error("Knowledge search limit is outside the configured range");
    }
    const candidateLimit = limit * knowledgeBaseConfig.search.candidateMultiplier;
    const fullText = mode === "semantic" ? [] : this.#knowledgeBase.search(query, candidateLimit);
    const semantic =
      mode === "full_text" ? [] : await this.#semanticCandidates(query, candidateLimit);
    const fullTextIds = new Set(fullText.map(({ chunkId }) => chunkId));
    const semanticIds = new Set(semantic.map(({ chunkId }) => chunkId));
    const sources: RrfSource<KnowledgeSearchResult>[] = [];
    if (fullText.length > 0) {
      sources.push({
        weight: knowledgeBaseConfig.search.ftsWeight,
        candidates: fullText.map((value) => ({ id: value.chunkId, value })),
      });
    }
    if (semantic.length > 0) {
      sources.push({
        weight: knowledgeBaseConfig.search.vectorWeight,
        candidates: semantic.map((value) => ({ id: value.chunkId, value })),
      });
    }
    return reciprocalRankFusion(sources, {
      rankConstant: knowledgeBaseConfig.search.rankConstant,
      limit,
    }).map(({ id, value, score }) => ({
      chunkId: id,
      content: value.content,
      score,
      matchedBy: [
        ...(fullTextIds.has(id) ? (["full_text"] as const) : []),
        ...(semanticIds.has(id) ? (["semantic"] as const) : []),
      ],
      source: {
        documentId: value.documentId,
        uri: value.uri,
        title: value.title,
        ordinal: value.ordinal,
        sourceType: value.sourceType,
        tags: value.tags,
        updatedAt: value.updatedAt,
      },
      highlights: createHighlights(query, value.content),
    }));
  }

  async #semanticCandidates(
    query: string,
    limit: number,
  ): Promise<readonly KnowledgeSearchResult[]> {
    const vector = this.#validatedEmbedding(await this.#embeddingProvider.embed(query));
    return this.#vectorIndex
      .search(vector, limit)
      .filter(({ score }) => score >= knowledgeBaseConfig.search.minimumVectorScore)
      .map<KnowledgeSearchResult | undefined>(({ id, score }) => {
        const chunk = this.#knowledgeBase.chunk(id);
        return chunk === undefined
          ? undefined
          : {
              chunkId: chunk.id,
              documentId: chunk.documentId,
              ordinal: chunk.ordinal,
              uri: chunk.uri,
              title: chunk.title,
              sourceType: chunk.sourceType,
              tags: chunk.tags,
              updatedAt: chunk.updatedAt,
              content: chunk.content,
              score,
            };
      })
      .filter((value): value is KnowledgeSearchResult => value !== undefined);
  }

  #validatedEmbedding(vector: readonly number[]): readonly number[] {
    if (
      vector.length !== this.#embeddingProvider.dimensions ||
      vector.some((value) => !Number.isFinite(value))
    ) {
      throw new Error("Embedding provider returned an invalid vector");
    }
    return vector;
  }
}

function createHighlights(query: string, content: string): readonly KnowledgeHighlight[] {
  const terms = queryTerms(query);
  const matches: { readonly start: number; readonly end: number }[] = [];
  const lowerContent = content.toLocaleLowerCase();
  for (const term of terms) {
    const start = lowerContent.indexOf(term.toLocaleLowerCase());
    const end = start + term.length;
    if (start >= 0 && !matches.some((match) => start < match.end && end > match.start)) {
      matches.push({ start, end });
    }
    if (matches.length >= knowledgeBaseConfig.search.maximumHighlights) break;
  }
  return matches
    .sort((left, right) => left.start - right.start)
    .map(({ start, end }) => {
      const radius = Math.floor(knowledgeBaseConfig.search.highlightCharacters / 2);
      const snippetStart = Math.max(0, start - radius);
      const snippetEnd = Math.min(content.length, end + radius);
      return {
        start,
        end,
        text: content.slice(start, end),
        snippet: content.slice(snippetStart, snippetEnd),
      };
    });
}

function queryTerms(query: string): readonly string[] {
  const tokens = query.match(/[\p{Script=Han}]+|[\p{L}\p{N}_-]+/gu) ?? [];
  const terms: string[] = [];
  for (const token of tokens) {
    terms.push(token);
    if (/^\p{Script=Han}+$/u.test(token) && token.length > 2) {
      for (let index = 0; index < token.length - 1; index += 1) {
        terms.push(token.slice(index, index + 2));
      }
    }
  }
  return [...new Set(terms)].sort((left, right) => right.length - left.length);
}

async function mapConcurrent<T, U>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<U>,
): Promise<readonly U[]> {
  const output = new Array<U>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      const value = values[index];
      if (value !== undefined) output[index] = await operation(value);
    }
  });
  await Promise.all(workers);
  return output;
}

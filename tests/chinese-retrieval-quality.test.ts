import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HybridKnowledgeIndex, KnowledgeBase, MemoryVectorIndex } from "@aquawisp/kb";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

const baselineSchema = z
  .object({
    schemaVersion: z.literal(1),
    metric: z.literal("recall_at_3"),
    minimumScore: z.number().min(0).max(1),
    corpus: z.array(
      z
        .object({ id: z.string().min(1), title: z.string().min(1), content: z.string().min(1) })
        .strict(),
    ),
    cases: z.array(
      z.object({ query: z.string().min(1), expectedDocumentId: z.string().min(1) }).strict(),
    ),
  })
  .strict();

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("M4 Chinese retrieval quality baseline", () => {
  it("meets the versioned Recall@3 threshold", async () => {
    const baseline = baselineSchema.parse(
      JSON.parse(
        await readFile(
          new URL("../evals/knowledge-retrieval-baseline.json", import.meta.url),
          "utf8",
        ),
      ) as unknown,
    );
    const directory = await mkdtemp(join(tmpdir(), "aquawisp-chinese-recall-"));
    directories.push(directory);
    const knowledgeBase = new KnowledgeBase({
      databasePath: join(directory, "knowledge.sqlite"),
      chunking: { maximumCharacters: 200, overlapCharacters: 20, minimumCharacters: 20 },
    });
    try {
      const hybrid = new HybridKnowledgeIndex({
        knowledgeBase,
        vectorIndex: new MemoryVectorIndex(2),
        embeddingProvider: { dimensions: 2, embed: () => Promise.resolve([1, 0]) },
      });
      for (const document of baseline.corpus) {
        await hybrid.add({
          ...document,
          uri: `manual://baseline/${document.id}`,
          sourceType: "manual",
          tags: ["baseline"],
          updatedAt: "2026-09-02T00:00:00.000Z",
        });
      }
      let hits = 0;
      for (const scenario of baseline.cases) {
        const results = await hybrid.search({ query: scenario.query, mode: "hybrid", limit: 3 });
        if (results.some(({ source }) => source.documentId === scenario.expectedDocumentId))
          hits += 1;
      }
      const recall = hits / baseline.cases.length;
      expect(recall).toBeGreaterThanOrEqual(baseline.minimumScore);
    } finally {
      knowledgeBase.close();
    }
  });
});

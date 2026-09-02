import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  HybridKnowledgeIndex,
  KnowledgeBase,
  MemoryVectorIndex,
  type EmbeddingProvider,
} from "@aquawisp/kb";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("M4 hybrid knowledge retrieval", () => {
  it("indexes chunks, fuses FTS and semantic ranks, and returns source highlights", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aquawisp-hybrid-"));
    directories.push(directory);
    const knowledgeBase = new KnowledgeBase({
      databasePath: join(directory, "kb.sqlite"),
      chunking: { maximumCharacters: 100, overlapCharacters: 10, minimumCharacters: 10 },
    });
    const index = new MemoryVectorIndex(2);
    const hybrid = new HybridKnowledgeIndex({
      knowledgeBase,
      vectorIndex: index,
      embeddingProvider: new FixtureEmbeddingProvider(),
    });

    await hybrid.add({
      id: "literal",
      uri: "file:///literal.md",
      title: "字面来源",
      sourceType: "file",
      tags: [],
      content: "苹果发布会的字面记录",
      updatedAt: "2026-09-02T00:00:00.000Z",
    });
    await hybrid.add({
      id: "concept",
      uri: "manual:///concept",
      title: "语义来源",
      sourceType: "manual",
      tags: [],
      content: "概念代号对应一家消费电子公司",
      updatedAt: "2026-09-02T00:01:00.000Z",
    });

    const results = await hybrid.search({ query: "苹果", mode: "hybrid", limit: 2 });
    expect(results.map(({ source }) => source.documentId)).toEqual(["concept", "literal"]);
    expect(results[0]).toMatchObject({
      matchedBy: ["semantic"],
      source: { uri: "manual:///concept", title: "语义来源", ordinal: 0 },
    });
    expect(results[1]).toMatchObject({
      matchedBy: ["full_text"],
      highlights: [{ text: "苹果", start: 0, end: 2 }],
    });
    knowledgeBase.close();
  });

  it("embeds before mutation and removes vectors for obsolete chunks on update", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aquawisp-hybrid-update-"));
    directories.push(directory);
    const knowledgeBase = new KnowledgeBase({
      databasePath: join(directory, "kb.sqlite"),
      chunking: { maximumCharacters: 12, overlapCharacters: 2, minimumCharacters: 5 },
    });
    const vectorIndex = new MemoryVectorIndex(2);
    const hybrid = new HybridKnowledgeIndex({
      knowledgeBase,
      vectorIndex,
      embeddingProvider: new FixtureEmbeddingProvider(),
    });
    const base = {
      id: "updated",
      uri: "file:///updated.md",
      title: "更新文档",
      sourceType: "file" as const,
      tags: [],
      updatedAt: "2026-09-02T00:00:00.000Z",
    };
    const first = await hybrid.add({
      ...base,
      content: "第一段知识内容。第二段知识内容。第三段知识内容。",
    });
    expect(first.length).toBeGreaterThan(1);

    const second = await hybrid.add({ ...base, content: "短内容" });
    expect(second).toHaveLength(1);
    expect(knowledgeBase.chunks(base.id)).toHaveLength(1);
    expect(vectorIndex.search([0, 1], 20).map(({ id }) => id)).toEqual([second[0]?.id]);
    knowledgeBase.close();
  });

  it("does not replace stored chunks when embedding preparation fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aquawisp-hybrid-failure-"));
    directories.push(directory);
    const knowledgeBase = new KnowledgeBase({
      databasePath: join(directory, "kb.sqlite"),
      chunking: { maximumCharacters: 100, overlapCharacters: 10, minimumCharacters: 10 },
    });
    knowledgeBase.add({
      id: "stable",
      uri: "manual:///stable",
      title: "稳定",
      sourceType: "manual",
      tags: [],
      content: "保留的旧内容",
      updatedAt: "2026-09-02T00:00:00.000Z",
    });
    const hybrid = new HybridKnowledgeIndex({
      knowledgeBase,
      vectorIndex: new MemoryVectorIndex(2),
      embeddingProvider: {
        dimensions: 2,
        embed: () => Promise.reject(new Error("fixture embedding unavailable")),
      },
    });

    await expect(
      hybrid.add({
        id: "stable",
        uri: "manual:///stable",
        title: "稳定",
        sourceType: "manual",
        tags: [],
        content: "不应写入的新内容",
        updatedAt: "2026-09-02T00:01:00.000Z",
      }),
    ).rejects.toThrow("fixture embedding unavailable");
    expect(knowledgeBase.chunks("stable")[0]?.content).toBe("保留的旧内容");
    knowledgeBase.close();
  });
});

class FixtureEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 2;

  embed(text: string): Promise<readonly number[]> {
    return Promise.resolve(text.includes("概念") || text === "苹果" ? [1, 0] : [-1, 0]);
  }
}

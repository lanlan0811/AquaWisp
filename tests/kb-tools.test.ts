import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HybridKnowledgeIndex, KnowledgeBase, MemoryVectorIndex } from "@aquawisp/kb";
import { createHybridKnowledgeTools, createKnowledgeTools } from "@aquawisp/tools";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("M4 knowledge tools", () => {
  it("exposes add, search, list, and status through the tool facade", async () => {
    const directory = await mkdtemp(join(tmpdir(), "AquaWisp M4 tools-"));
    directories.push(directory);
    const base = new KnowledgeBase({
      databasePath: join(directory, "kb.sqlite"),
      chunking: { maximumCharacters: 100, overlapCharacters: 10, minimumCharacters: 10 },
    });
    const tools = createKnowledgeTools(base);
    tools.add({
      id: "source-1",
      uri: "manual://source-1",
      title: "来源",
      sourceType: "manual",
      tags: [],
      content: "知识库工具检索测试",
      updatedAt: "2026-09-02T00:00:00.000Z",
    });
    expect(tools.status()).toEqual({ documentCount: 1, chunkCount: 1 });
    expect(tools.list(10)[0]?.id).toBe("source-1");
    expect(tools.search("检索", 10)[0]?.documentId).toBe("source-1");
    base.close();
  });

  it("exposes the default asynchronous hybrid tool facade", async () => {
    const directory = await mkdtemp(join(tmpdir(), "AquaWisp M4 hybrid tools-"));
    directories.push(directory);
    const base = new KnowledgeBase({
      databasePath: join(directory, "kb.sqlite"),
      chunking: { maximumCharacters: 100, overlapCharacters: 10, minimumCharacters: 10 },
    });
    const hybrid = new HybridKnowledgeIndex({
      knowledgeBase: base,
      vectorIndex: new MemoryVectorIndex(2),
      embeddingProvider: {
        dimensions: 2,
        embed: () => Promise.resolve([1, 0]),
      },
    });
    const tools = createHybridKnowledgeTools(base, hybrid);
    await tools.add({
      id: "hybrid-source",
      uri: "manual://hybrid-source",
      title: "混合来源",
      sourceType: "manual",
      tags: [],
      content: "混合检索工具链路",
      updatedAt: "2026-09-02T00:00:00.000Z",
    });
    const results = await tools.search({ query: "混合检索" });
    expect(results).toHaveLength(1);
    expect(results[0]?.matchedBy).toEqual(["full_text", "semantic"]);
    expect(results[0]?.source.documentId).toBe("hybrid-source");
    expect(tools.status()).toEqual({ documentCount: 1, chunkCount: 1 });
    base.close();
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { KnowledgeBase } from "@aquawisp/kb";
import { createKnowledgeTools } from "@aquawisp/tools";
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
});

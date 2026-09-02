import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { KnowledgeBase } from "@aquawisp/kb";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
afterEach(async () =>
  Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  ),
);

describe("M4 knowledge base FTS", () => {
  it("indexes Chinese content with source metadata and replaces prior document chunks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "AquaWisp M4 kb-"));
    directories.push(directory);
    const kb = new KnowledgeBase({
      databasePath: join(directory, "kb.sqlite"),
      chunking: { maximumCharacters: 20, overlapCharacters: 2, minimumCharacters: 5 },
    });
    kb.add({
      id: "document-1",
      uri: "file://notes.md",
      title: "笔记",
      sourceType: "file",
      tags: ["中文"],
      content: "沧渡知识库支持中文全文检索和来源引用。",
      updatedAt: "2026-09-02T00:00:00.000Z",
    });
    const results = kb.search("中文检索", 10);
    expect(results[0]).toMatchObject({ documentId: "document-1", title: "笔记" });
    expect(kb.status()).toMatchObject({ documentCount: 1 });
    expect(kb.list(10)).toEqual([
      expect.objectContaining({ id: "document-1", uri: "file://notes.md", tags: ["中文"] }),
    ]);
    expect(kb.search('" OR *', 10)).toEqual([]);
    expect(kb.remove("document-1")).toBe(true);
    expect(kb.remove("document-1")).toBe(false);
    expect(kb.status()).toEqual({ documentCount: 0, chunkCount: 0 });
    expect(kb.search("中文检索", 10)).toEqual([]);
    kb.close();
  });
});

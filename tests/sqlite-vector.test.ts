import { SqliteVectorIndex } from "@aquawisp/kb";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("M4 sqlite-vec persistent index", () => {
  it("persists, ranks, updates, and removes vectors in one SQLite file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "沧渡 sqlite vector "));
    const databasePath = join(directory, "knowledge.sqlite");
    let first: SqliteVectorIndex | undefined;
    let reopened: SqliteVectorIndex | undefined;
    try {
      first = new SqliteVectorIndex({
        databasePath,
        namespace: "chunks",
        dimensions: 3,
      });
      expect(first.version()).toMatch(/^v0\.1\./u);
      first.upsert("source-a", [1, 0, 0]);
      first.upsert("source-b", [0.8, 0.2, 0]);
      first.upsert("source-c", [-1, 0, 0]);
      expect(first.search([1, 0, 0], 3).map(({ id }) => id)).toEqual([
        "source-a",
        "source-b",
        "source-c",
      ]);
      first.close();
      first = undefined;

      reopened = new SqliteVectorIndex({
        databasePath,
        namespace: "chunks",
        dimensions: 3,
      });
      expect(reopened.search([1, 0, 0], 1)[0]?.id).toBe("source-a");
      reopened.upsert("source-a", [-1, 0, 0]);
      expect(reopened.search([1, 0, 0], 1)[0]?.id).toBe("source-b");
      reopened.remove("source-b");
      expect(reopened.search([1, 0, 0], 2).map(({ id }) => id)).not.toContain("source-b");
      reopened.close();
      reopened = undefined;
    } finally {
      reopened?.close();
      first?.close();
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("rejects reopening a namespace with different dimensions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aquawisp-vector-dimensions-"));
    const databasePath = join(directory, "knowledge.sqlite");
    try {
      const index = new SqliteVectorIndex({
        databasePath,
        namespace: "documents",
        dimensions: 2,
      });
      index.close();
      expect(
        () =>
          new SqliteVectorIndex({
            databasePath,
            namespace: "documents",
            dimensions: 3,
          }),
      ).toThrow("dimension mismatch");
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

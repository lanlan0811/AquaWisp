import { MemoryVectorIndex, cosineSimilarity } from "@aquawisp/kb";
import { describe, expect, it } from "vitest";

describe("M4 vector retrieval", () => {
  it("ranks cosine matches deterministically and validates vector dimensions", () => {
    const index = new MemoryVectorIndex(2);
    index.upsert("aligned", [1, 0]);
    index.upsert("diagonal", [1, 1]);
    index.upsert("opposite", [-1, 0]);

    expect(index.search([1, 0], 3).map(({ id }) => id)).toEqual([
      "aligned",
      "diagonal",
      "opposite",
    ]);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(() => index.upsert("invalid", [1])).toThrow("dimensions");
    index.remove("aligned");
    expect(index.search([1, 0], 2)[0]?.id).toBe("diagonal");
  });
});

import { reciprocalRankFusion } from "@aquawisp/kb";
import { describe, expect, it } from "vitest";

describe("M4 reciprocal rank fusion", () => {
  it("merges ranked FTS and vector candidates deterministically", () => {
    const result = reciprocalRankFusion(
      [
        {
          weight: 1,
          candidates: [
            { id: "a", value: "FTS A" },
            { id: "b", value: "FTS B" },
          ],
        },
        {
          weight: 1,
          candidates: [
            { id: "b", value: "Vector B" },
            { id: "c", value: "Vector C" },
          ],
        },
      ],
      { rankConstant: 60, limit: 3 },
    );

    expect(result.map(({ id }) => id)).toEqual(["b", "a", "c"]);
    expect(result[0]?.value).toBe("FTS B");
  });
});

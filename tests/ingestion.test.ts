import { extractText } from "@aquawisp/kb";
import { describe, expect, it } from "vitest";

describe("M4 ingestion extraction", () => {
  it("normalizes Markdown and strips unsafe HTML markup", () => {
    expect(extractText("markdown", "# 标题\n[来源](https://example.test)\n**正文**").text).toBe(
      "标题\n来源\n正文",
    );
    expect(
      extractText("html", "<h1>标题</h1><script>ignore()</script><p>中文 &amp; 内容</p>").text,
    ).toBe("标题\n中文 & 内容");
  });
});

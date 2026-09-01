import { createDesktopMarkup, desktopStyles } from "@aquawisp/desktop";
import { describe, expect, it } from "vitest";

describe("M5 design-system desktop renderer", () => {
  it("renders Chinese mode copy, a running stop control, and SVG-only icons", () => {
    const markup = createDesktopMarkup({
      mode: "full_access",
      workspaceName: "知识工作区",
      modelName: "GLM-5.3",
      running: true,
      runtimeStatus: "connected",
      browserVisible: true,
    });

    expect(markup).toContain("完全访问");
    expect(markup).toContain('aria-label="停止"');
    expect(markup).toContain("<svg");
    expect(markup).not.toMatch(/[😀-🙏]/u);
    expect(markup).toContain('<webview src="about:blank"></webview>');
  });

  it("keeps the specified sidebar, input, and send color tokens", () => {
    expect(desktopStyles).toContain("width:220px");
    expect(desktopStyles).toContain("border-radius:12px");
    expect(desktopStyles).toContain("--send:#34b3a0");
    expect(desktopStyles).toContain("width:280px");
  });
});

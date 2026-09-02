import { Script } from "node:vm";

import {
  createDesktopDocument,
  createDesktopMarkup,
  desktopRendererScript,
  desktopStyles,
} from "@aquawisp/desktop";
import { describe, expect, it } from "vitest";

describe("M5 design-system desktop renderer", () => {
  const state = {
    mode: "full_access" as const,
    workspaceName: "知识工作区",
    modelName: "GLM-5.3",
    running: true,
    runtimeStatus: "connected" as const,
    browserVisible: true,
    providerId: "bigmodel",
    modelId: "glm-5.3",
    protocol: "chat_completions" as const,
    reasoningLevel: "max",
    secretName: "provider-bigmodel-api-key",
  };

  it("renders Chinese mode copy, a running stop control, and SVG-only icons", () => {
    const markup = createDesktopMarkup(state);

    expect(markup).toContain("完全访问");
    expect(markup).toContain('aria-label="停止"');
    expect(markup).toContain("<svg");
    expect(markup).not.toMatch(/[😀-🙏]/u);
    expect(markup).toContain('<webview src="about:blank"></webview>');
    expect(markup).toContain('data-view-panel="settings"');
    expect(markup).toContain('name="reasoningLevel"');
    expect(markup).toContain('type="password"');
    expect(markup).not.toContain("fixture-secret");
    expect(desktopRendererScript).toContain("api.settings.set");
    expect(desktopRendererScript).toContain("api.secrets.has");
    expect(desktopRendererScript).toContain("api.conversation.start");
    expect(desktopRendererScript).toContain("api.conversation.cancel");
    expect(desktopRendererScript).toContain("api.conversation.onEvent");
    expect(desktopRendererScript).toContain(
      "activeAssistant.textContent += runEvent.payload.delta",
    );
    expect(desktopRendererScript).not.toContain("activeAssistant.innerHTML");
  });

  it("builds a syntactically valid nonce-restricted renderer document", () => {
    const document = createDesktopDocument(state, "YWJjZGVmZ2hpamtsbW5vcA==");
    expect(document).toContain("script-src 'nonce-YWJjZGVmZ2hpamtsbW5vcA=='");
    expect(document).toContain('<script nonce="YWJjZGVmZ2hpamtsbW5vcA==">');
    expect(document).not.toContain("script-src 'unsafe-inline'");
    expect(() => new Script(desktopRendererScript)).not.toThrow();
    expect(() => createDesktopDocument(state, "unsafe nonce")).toThrow("base64");
  });

  it("keeps the specified sidebar, input, and send color tokens", () => {
    expect(desktopStyles).toContain("width:220px");
    expect(desktopStyles).toContain("border-radius:12px");
    expect(desktopStyles).toContain("--send:#34b3a0");
    expect(desktopStyles).toContain("width:280px");
  });
});

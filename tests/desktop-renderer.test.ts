import { Script } from "node:vm";

import {
  createDesktopDocument,
  createDesktopMarkup,
  desktopRendererScript,
  desktopStyles,
  sourceStyles,
} from "@aquawisp/desktop";
import { desktopConversationStartRequestSchema } from "@aquawisp/contracts";
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

  it("requires an explicit validated session mode for every Run", () => {
    expect(
      desktopConversationStartRequestSchema.parse({
        sessionId: "session-mode",
        userInput: "检索知识库",
        mode: "full_access",
        modelId: "glm-5.3",
        reasoningLevel: "max",
      }),
    ).toMatchObject({ mode: "full_access" });
    expect(() =>
      desktopConversationStartRequestSchema.parse({
        sessionId: "session-mode",
        userInput: "检索知识库",
        modelId: "glm-5.3",
        reasoningLevel: "max",
      }),
    ).toThrow();
  });

  it("renders Chinese mode copy, a running stop control, and SVG-only icons", () => {
    const markup = createDesktopMarkup(state);

    expect(markup).toContain("完全访问");
    expect(markup).toContain('aria-label="停止"');
    expect(markup).toContain("<svg");
    expect(markup).not.toMatch(/[😀-🙏]/u);
    expect(markup).toContain('<webview src="about:blank"></webview>');
    expect(markup).toContain('data-view-panel="settings"');
    expect(markup).toContain("data-knowledge-add");
    expect(markup).toContain("data-knowledge-list");
    expect(markup).toContain("data-knowledge-remove-dialog");
    expect(markup).toContain("data-approval-dialog");
    expect(markup).toContain("data-approval-remember");
    expect(markup).toContain('data-right-tab="sources"');
    expect(markup).toContain("data-source-list");
    expect(markup).toContain("data-source-detail-content");
    expect(markup).toContain('data-session-mode="plan"');
    expect(markup).toContain('data-session-mode="work"');
    expect(markup).toContain('data-session-mode="full_access"');
    expect(markup).toContain("data-session-model");
    expect(markup).toContain("data-session-reasoning");
    expect(markup).toContain("data-full-access-dialog");
    expect(markup).toContain("完全访问仅能在会话中确认后临时启用");
    const defaultModeSelect = /<select name="mode">(?<options>.*?)<\/select>/u.exec(markup);
    expect(defaultModeSelect?.groups?.options).not.toContain('value="full_access"');
    expect(markup).toContain("让沧渡检索知识库后，命中内容会显示在这里");
    expect(markup).toContain("本会话内，相同操作、目标和影响范围总是允许");
    expect(markup).toContain('name="reasoningLevel"');
    expect(markup).toContain('type="password"');
    expect(markup).not.toContain("fixture-secret");
    expect(desktopRendererScript).toContain("api.settings.set");
    expect(desktopRendererScript).toContain("api.secrets.has");
    expect(desktopRendererScript).toContain("api.conversation.start");
    expect(desktopRendererScript).toContain("modelId: sessionModelSelect.value");
    expect(desktopRendererScript).toContain("reasoningLevel: sessionReasoningSelect.value");
    expect(desktopRendererScript).toContain("rebuildSessionModels(settings)");
    expect(desktopRendererScript).toContain("button.disabled = nextRunning");
    expect(desktopRendererScript).toContain('fullAccessDialog.returnValue === "enable"');
    expect(desktopRendererScript).toContain("api.conversation.cancel");
    expect(desktopRendererScript).toContain("api.conversation.onEvent");
    expect(desktopRendererScript).toContain("api.knowledge.list");
    expect(desktopRendererScript).toContain("api.knowledge.addFiles");
    expect(desktopRendererScript).toContain("api.knowledge.remove");
    expect(desktopRendererScript).toContain("api.approvals.resolve");
    expect(desktopRendererScript).toContain('runEvent.type === "approval.required"');
    expect(desktopRendererScript).toContain('runEvent.type === "action.planned"');
    expect(desktopRendererScript).toContain('runEvent.type === "action.observed"');
    expect(desktopRendererScript).toContain('action?.toolName === "kb.search"');
    expect(desktopRendererScript).toContain("sourceList.replaceChildren");
    expect(desktopRendererScript).not.toContain("sourceList.innerHTML");
    expect(desktopRendererScript).toContain("sourceDetailContent.textContent = source.content");
    expect(desktopRendererScript).toContain('approvalDialog?.addEventListener("cancel"');
    expect(desktopRendererScript).toContain("knowledgeList.replaceChildren");
    expect(desktopRendererScript).not.toContain("knowledgeList.innerHTML");
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
    expect(sourceStyles).toContain("width:280px");
  });
});

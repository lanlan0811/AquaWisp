import {
  BrowserCommandEngine,
  browserPolicy,
  type BrowserAutomationHost,
  type BrowserAutomationTab,
  type BrowserRequest,
  type BrowserSnapshot,
  type BrowserTabSummary,
} from "@aquawisp/browser";
import { describe, expect, it } from "vitest";

class FakeTab implements BrowserAutomationTab {
  readonly id = "tab-1";
  url = "about:blank";
  readonly calls: { method: string; parameters: Readonly<Record<string, unknown>> | undefined }[] =
    [];
  evaluationValues: unknown[] = [];
  screenshotData = "cG5n";

  currentUrl(): string {
    return this.url;
  }

  title(): string {
    return "测试页";
  }

  send(method: string, parameters?: Readonly<Record<string, unknown>>): Promise<unknown> {
    this.calls.push({ method, parameters });
    if (method === "Page.captureScreenshot") return Promise.resolve({ data: this.screenshotData });
    if (method === "Runtime.evaluate") {
      return Promise.resolve({ result: { value: this.evaluationValues.shift() } });
    }
    if (method === "Page.navigate") this.url = String(parameters?.url);
    return Promise.resolve({});
  }
}

class FakeHost implements BrowserAutomationHost {
  readonly tab = new FakeTab();
  artifact: { path: string; base64: string; mimeType: string } | undefined;

  getTab(tabId: string): BrowserAutomationTab | undefined {
    return tabId === this.tab.id ? this.tab : undefined;
  }

  listTabs(): readonly BrowserTabSummary[] {
    return [{ id: this.tab.id, url: this.tab.url }];
  }

  activeTabId(): string | undefined {
    return this.tab.id;
  }

  createTab(url: string): Promise<BrowserTabSummary> {
    return Promise.resolve({ id: "tab-2", url });
  }

  activateTab(tabId: string): Promise<BrowserTabSummary> {
    return Promise.resolve({ id: tabId, url: this.tab.url });
  }

  closeTab(): Promise<{ readonly closed: boolean }> {
    return Promise.resolve({ closed: true });
  }

  writeArtifact(
    path: string,
    base64: string,
    mimeType: string,
  ): Promise<{ path: string; bytes: number }> {
    this.artifact = { path, base64, mimeType };
    return Promise.resolve({ path, bytes: 3 });
  }

  handleDialog(tabId: string, accept: boolean, promptText: string | undefined): Promise<unknown> {
    return Promise.resolve({ tabId, accept, promptText });
  }

  downloadPath(tabId: string): Promise<unknown> {
    return Promise.resolve({ tabId, path: "downloads/file.pdf" });
  }

  recordingStart(tabId: string, path: string): Promise<unknown> {
    return Promise.resolve({ tabId, path, recording: true });
  }

  recordingStop(tabId: string): Promise<unknown> {
    return Promise.resolve({ tabId, recording: false });
  }
}

const signal = new AbortController().signal;

function request(command: BrowserRequest["command"]): BrowserRequest {
  return { requestId: `request-${command.kind}`, backendGeneration: 1, tabId: "tab-1", command };
}

describe("M6 CDP browser command engine", () => {
  it("navigates only to allowed URLs and invalidates page refs", async () => {
    const host = new FakeHost();
    const engine = new BrowserCommandEngine(host);
    await expect(
      engine.execute(request({ kind: "navigate", url: "https://example.test/form" }), signal),
    ).resolves.toMatchObject({ url: "https://example.test/form" });
    expect(host.tab.calls.at(-1)).toMatchObject({
      method: "Page.navigate",
      parameters: { url: "https://example.test/form" },
    });
    await expect(
      engine.execute(request({ kind: "navigate", url: "file:///private.txt" }), signal),
    ).rejects.toThrow("not allowed");
  });

  it("creates a bounded snapshot map and drives form actions by ref", async () => {
    const host = new FakeHost();
    const engine = new BrowserCommandEngine(host);
    const snapshot: BrowserSnapshot = {
      url: "https://example.test/form",
      title: "表单",
      nodes: [
        {
          ref: "aqw-1-1",
          tag: "input",
          role: "textbox",
          name: "姓名",
          text: "",
          selector: '[data-aquawisp-ref="aqw-1-1"]',
          xpath: "/html[1]/body[1]/input[1]",
          framePath: [],
          rect: { x: 10, y: 20, width: 200, height: 32 },
        },
      ],
    };
    host.tab.evaluationValues.push(snapshot, { ok: true }, { ok: true });
    await expect(engine.execute(request({ kind: "snapshot" }), signal)).resolves.toEqual(snapshot);
    await expect(
      engine.execute(request({ kind: "fill", ref: "aqw-1-1", value: "沧渡" }), signal),
    ).resolves.toEqual({ filled: "aqw-1-1" });
    await expect(
      engine.execute(request({ kind: "click", ref: "aqw-1-1" }), signal),
    ).resolves.toEqual({ clicked: "aqw-1-1" });
    expect(host.tab.calls.filter(({ method }) => method === "Runtime.evaluate")).toHaveLength(3);
  });

  it("rejects stale refs and writes validated page and element screenshots", async () => {
    const host = new FakeHost();
    const engine = new BrowserCommandEngine(host);
    await expect(
      engine.execute(request({ kind: "click", ref: "missing" }), signal),
    ).rejects.toThrow("missing or stale");

    await expect(
      engine.execute(request({ kind: "screenshot", path: "artifacts/page.png" }), signal),
    ).resolves.toMatchObject({ path: "artifacts/page.png", mimeType: "image/png" });
    expect(host.artifact).toEqual({
      path: "artifacts/page.png",
      base64: "cG5n",
      mimeType: "image/png",
    });

    const snapshot: BrowserSnapshot = {
      url: "https://example.test",
      title: "页面",
      nodes: [
        {
          ref: "aqw-1-1",
          tag: "button",
          role: "button",
          name: "提交",
          text: "提交",
          selector: '[data-aquawisp-ref="aqw-1-1"]',
          xpath: "/html[1]/body[1]/button[1]",
          framePath: [],
          rect: { x: 2, y: 4, width: 80, height: 30 },
        },
      ],
    };
    host.tab.evaluationValues.push(snapshot, { x: 2, y: 4, width: 80, height: 30 });
    await engine.execute(request({ kind: "snapshot" }), signal);
    await engine.execute(
      request({ kind: "elementScreenshot", ref: "aqw-1-1", path: "artifacts/button.png" }),
      signal,
    );
    expect(host.tab.calls.at(-1)).toMatchObject({
      method: "Page.captureScreenshot",
      parameters: { clip: { x: 2, y: 4, width: 80, height: 30, scale: 1 } },
    });
  });

  it("covers waiting, keyboard, tab, dialog, download, and recording adapters", async () => {
    const host = new FakeHost();
    const fastPolicy = {
      ...browserPolicy,
      automation: { ...browserPolicy.automation, waitPollIntervalMs: 1 },
    };
    const engine = new BrowserCommandEngine(host, fastPolicy);
    host.tab.evaluationValues.push(false, true);
    await expect(
      engine.execute(request({ kind: "waitFor", text: "完成", timeoutMs: 50 }), signal),
    ).resolves.toEqual({ matched: true });
    await engine.execute(request({ kind: "type", value: "AquaWisp" }), signal);
    await engine.execute(request({ kind: "press", key: "Enter" }), signal);
    await expect(engine.execute(request({ kind: "newTab" }), signal)).resolves.toEqual({
      id: "tab-2",
      url: "about:blank",
    });
    await expect(
      engine.execute(request({ kind: "handleDialog", accept: true }), signal),
    ).resolves.toEqual({ tabId: "tab-1", accept: true, promptText: undefined });
    await expect(engine.execute(request({ kind: "downloadPath" }), signal)).resolves.toEqual({
      tabId: "tab-1",
      path: "downloads/file.pdf",
    });
    await expect(
      engine.execute(request({ kind: "recordingStart", path: "artifacts/session.webm" }), signal),
    ).resolves.toMatchObject({ recording: true });
    await expect(engine.execute(request({ kind: "recordingStop" }), signal)).resolves.toEqual({
      tabId: "tab-1",
      recording: false,
    });
  });
});

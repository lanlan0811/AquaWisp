import { BrowserTabRegistry, browserPolicy, type BrowserTabPort } from "@aquawisp/browser";
import {
  ElectronBrowserService,
  desktopConfig,
  type ElectronBrowserState,
  type ElectronBrowserTransport,
} from "@aquawisp/desktop";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

class FakeGuest implements BrowserTabPort {
  readonly id: string;
  #url: string;
  #attached = false;
  #destroyed: (() => void) | undefined;
  focused = false;
  closed = false;
  waitForBeforeUnload: boolean | undefined;

  constructor(id: string, url: string) {
    this.id = id;
    this.#url = url;
  }

  currentUrl(): string {
    return this.#url;
  }

  title(): string {
    return "浏览器测试页";
  }

  isDebuggerAttached(): boolean {
    return this.#attached;
  }

  attachDebugger(): void {
    this.#attached = true;
  }

  detachDebugger(): void {
    this.#attached = false;
  }

  denyWindowOpen(): void {
    return undefined;
  }

  onWillNavigate(handler: (url: string) => boolean): void {
    handler(this.#url);
  }

  onDestroyed(handler: () => void): void {
    this.#destroyed = handler;
  }

  focus(): void {
    this.focused = true;
  }

  close(options: { readonly waitForBeforeUnload: boolean }): void {
    this.closed = true;
    this.waitForBeforeUnload = options.waitForBeforeUnload;
    this.#destroyed?.();
  }

  send(method: string, parameters?: Readonly<Record<string, unknown>>): Promise<unknown> {
    if (method === "Page.navigate") this.#url = String(parameters?.url);
    if (method === "Page.captureScreenshot") return Promise.resolve({ data: "cG5n" });
    return Promise.resolve({});
  }
}

class FakeTransport implements ElectronBrowserTransport {
  readonly creations: { requestId: string; url: string }[] = [];
  readonly registrations: { requestId: string; tabId: string }[] = [];
  readonly activations: string[] = [];
  readonly states: ElectronBrowserState[] = [];

  createTab(request: { requestId: string; url: string }): void {
    this.creations.push(request);
  }

  tabRegistered(message: { requestId: string; tabId: string }): void {
    this.registrations.push(message);
  }

  activateTab(message: { tabId: string }): void {
    this.activations.push(message.tabId);
  }

  stateChanged(state: ElectronBrowserState): void {
    this.states.push(state);
  }
}

describe("M6 Electron browser service", () => {
  it("connects tab lifecycle, CDP commands, and workspace-confined artifacts", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "aquawisp-browser-service-"));
    const transport = new FakeTransport();
    const service = new ElectronBrowserService({
      workspaceRoot: workspace,
      backendGeneration: 7,
      config: desktopConfig.browser,
      registry: new BrowserTabRegistry(browserPolicy),
      transport,
    });
    const signal = new AbortController().signal;
    try {
      const creating = service.createTab("https://example.test/form", signal);
      expect(transport.creations).toHaveLength(1);
      const guest = new FakeGuest("tab-1", "https://example.test/form");
      service.registerGuest(guest);
      await expect(creating).resolves.toEqual({ id: "tab-1", url: "https://example.test/form" });
      expect(transport.registrations).toEqual([
        { requestId: transport.creations[0]?.requestId, tabId: "tab-1" },
      ]);
      expect(service.state()).toMatchObject({
        backendGeneration: 7,
        activeTabId: "tab-1",
        tabs: [{ id: "tab-1", url: "https://example.test/form" }],
      });

      await service.dispatch({
        requestId: "browser-navigate",
        backendGeneration: 7,
        tabId: "tab-1",
        command: { kind: "navigate", url: "https://example.test/result" },
      });
      expect(guest.currentUrl()).toBe("https://example.test/result");
      await expect(
        service.dispatch({
          requestId: "browser-screenshot",
          backendGeneration: 7,
          tabId: "tab-1",
          command: { kind: "screenshot", path: "artifacts/page.png" },
        }),
      ).resolves.toMatchObject({ bytes: 3, mimeType: "image/png" });
      await expect(readFile(join(workspace, "artifacts", "page.png"), "utf8")).resolves.toBe("png");
      await expect(
        service.writeArtifact("../escape.png", "cG5n", "image/png", signal),
      ).rejects.toThrow("escapes the workspace");

      await expect(service.closeTab("tab-1", signal)).resolves.toEqual({ closed: true });
      expect(guest.closed).toBe(true);
      expect(service.state().tabs).toEqual([]);
    } finally {
      service.dispose();
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("rejects stale generations and exposes cancellable waits", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "aquawisp-browser-cancel-"));
    const service = new ElectronBrowserService({
      workspaceRoot: workspace,
      backendGeneration: 2,
      config: desktopConfig.browser,
      registry: new BrowserTabRegistry(browserPolicy),
      transport: new FakeTransport(),
    });
    service.registerGuest(new FakeGuest("tab-1", "about:blank"));
    try {
      await expect(
        service.dispatch({
          requestId: "stale",
          backendGeneration: 1,
          tabId: "tab-1",
          command: { kind: "getState" },
        }),
      ).rejects.toThrow("generation mismatch");
      const waiting = service.dispatch({
        requestId: "waiting",
        backendGeneration: 2,
        tabId: "tab-1",
        command: { kind: "waitForURL", url: "never.example", timeoutMs: 10_000 },
      });
      expect(service.cancel({ requestId: "waiting" })).toBe(true);
      await expect(waiting).rejects.toThrow("cancelled");
    } finally {
      service.dispose();
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

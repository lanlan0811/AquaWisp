import {
  assertBrowserUrl,
  BrowserTabRegistry,
  browserPolicy,
  hardenWebviewPreferences,
  type BrowserTabPort,
} from "@aquawisp/browser";
import { describe, expect, it } from "vitest";

class FakeBrowserTab implements BrowserTabPort {
  readonly id: string;
  #url: string;
  #attached = false;
  #navigationHandler: ((url: string) => boolean) | undefined;
  #destroyedHandler: (() => void) | undefined;
  deniedWindowOpen = false;
  attachedVersion: string | undefined;

  constructor(id: string, url: string) {
    this.id = id;
    this.#url = url;
  }

  currentUrl(): string {
    return this.#url;
  }

  isDebuggerAttached(): boolean {
    return this.#attached;
  }

  attachDebugger(version: string): void {
    this.#attached = true;
    this.attachedVersion = version;
  }

  detachDebugger(): void {
    this.#attached = false;
  }

  denyWindowOpen(): void {
    this.deniedWindowOpen = true;
  }

  onWillNavigate(handler: (url: string) => boolean): void {
    this.#navigationHandler = handler;
  }

  onDestroyed(handler: () => void): void {
    this.#destroyedHandler = handler;
  }

  permitsNavigation(url: string): boolean {
    return this.#navigationHandler?.(url) ?? false;
  }

  destroy(): void {
    this.#attached = false;
    this.#destroyedHandler?.();
  }
}

describe("M6 visible browser host", () => {
  it("allows only the configured protocols and hardens every webview", () => {
    expect(assertBrowserUrl("https://example.test")).toBeInstanceOf(URL);
    expect(assertBrowserUrl("about:blank")).toBe("about:blank");
    expect(() => assertBrowserUrl("file:///private.txt")).toThrow("not allowed");

    const preferences = {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      preload: "untrusted-preload.js",
    };
    hardenWebviewPreferences(preferences);
    expect(preferences).toEqual({
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    });
  });

  it("registers one CDP session and removes it when the guest is destroyed", () => {
    const registry = new BrowserTabRegistry(browserPolicy);
    const tab = new FakeBrowserTab("tab-1", "about:blank");
    registry.register(tab);

    expect(tab.deniedWindowOpen).toBe(true);
    expect(tab.attachedVersion).toBe(browserPolicy.debuggerProtocolVersion);
    expect(tab.permitsNavigation("https://example.test/path")).toBe(true);
    expect(tab.permitsNavigation("javascript:alert(1)")).toBe(false);
    expect(registry.list()).toEqual([{ id: "tab-1", url: "about:blank" }]);
    expect(() => {
      registry.register(tab);
    }).toThrow("already registered");

    tab.destroy();
    expect(tab.isDebuggerAttached()).toBe(false);
    expect(registry.list()).toEqual([]);
  });
});

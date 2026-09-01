import { assertBrowserUrl, type BrowserPolicy } from "./policy.js";

export interface BrowserTabPort {
  readonly id: string;
  currentUrl(): string;
  isDebuggerAttached(): boolean;
  attachDebugger(version: string): void;
  detachDebugger(): void;
  denyWindowOpen(): void;
  onWillNavigate(handler: (url: string) => boolean): void;
  onDestroyed(handler: () => void): void;
}

export interface BrowserTabSummary {
  readonly id: string;
  readonly url: string;
}

export class BrowserTabRegistry {
  readonly #policy: BrowserPolicy;
  readonly #tabs = new Map<string, BrowserTabPort>();

  constructor(policy: BrowserPolicy) {
    this.#policy = policy;
  }

  register(tab: BrowserTabPort): void {
    if (this.#tabs.has(tab.id)) throw new Error(`Browser tab is already registered: ${tab.id}`);
    assertBrowserUrl(tab.currentUrl() || this.#policy.initialUrl, this.#policy);
    tab.denyWindowOpen();
    tab.onWillNavigate((url) => {
      try {
        assertBrowserUrl(url, this.#policy);
        return true;
      } catch {
        return false;
      }
    });
    if (!tab.isDebuggerAttached()) tab.attachDebugger(this.#policy.debuggerProtocolVersion);
    this.#tabs.set(tab.id, tab);
    tab.onDestroyed(() => {
      this.#remove(tab.id, false);
    });
  }

  unregister(tabId: string): boolean {
    return this.#remove(tabId, true);
  }

  #remove(tabId: string, detach: boolean): boolean {
    const tab = this.#tabs.get(tabId);
    if (tab === undefined) return false;
    this.#tabs.delete(tabId);
    if (detach && tab.isDebuggerAttached()) tab.detachDebugger();
    return true;
  }

  list(): readonly BrowserTabSummary[] {
    return [...this.#tabs.values()]
      .map((tab) => ({ id: tab.id, url: tab.currentUrl() }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  dispose(): void {
    for (const tabId of [...this.#tabs.keys()]) this.unregister(tabId);
  }
}

import { mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
  BrowserCommandEngine,
  BrowserRequestBridge,
  browserCancelRequestSchema,
  browserPolicy,
  type BrowserAutomationHost,
  type BrowserAutomationTab,
  type BrowserTabPort,
  type BrowserTabRegistry,
  type BrowserTabSummary,
} from "@aquawisp/browser";

import type { DesktopConfig } from "./desktop-config.js";

export interface ElectronBrowserGuest extends BrowserTabPort {
  title(): string;
  focus(): void;
  close(options: { readonly waitForBeforeUnload: boolean }): void;
  send(method: string, parameters?: Readonly<Record<string, unknown>>): Promise<unknown>;
}

export interface ElectronBrowserTransport {
  createTab(request: { readonly requestId: string; readonly url: string }): void;
  tabRegistered(message: { readonly requestId: string; readonly tabId: string }): void;
  activateTab(message: { readonly tabId: string }): void;
  stateChanged(state: ElectronBrowserState): void;
}

export interface ElectronBrowserState {
  readonly backendGeneration: number;
  readonly activeTabId: string | null;
  readonly tabs: readonly BrowserTabSummary[];
}

interface PendingTabCreation {
  readonly requestId: string;
  readonly url: string;
  readonly resolve: (summary: BrowserTabSummary) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

export interface ElectronBrowserServiceOptions {
  readonly workspaceRoot: string;
  readonly backendGeneration: number;
  readonly config: DesktopConfig["browser"];
  readonly registry: BrowserTabRegistry;
  readonly transport: ElectronBrowserTransport;
}

export class ElectronBrowserService implements BrowserAutomationHost {
  readonly #workspaceRoot: string;
  readonly #backendGeneration: number;
  readonly #config: DesktopConfig["browser"];
  readonly #registry: BrowserTabRegistry;
  readonly #transport: ElectronBrowserTransport;
  readonly #guests = new Map<string, ElectronBrowserGuest>();
  readonly #bridge: BrowserRequestBridge;
  #activeTab: string | undefined;
  #createCounter = 0;
  #pendingCreation: PendingTabCreation | undefined;

  constructor(options: ElectronBrowserServiceOptions) {
    this.#workspaceRoot = resolve(options.workspaceRoot);
    this.#backendGeneration = options.backendGeneration;
    this.#config = options.config;
    this.#registry = options.registry;
    this.#transport = options.transport;
    this.#bridge = new BrowserRequestBridge({
      executor: new BrowserCommandEngine(this),
      backendGeneration: options.backendGeneration,
      requestTimeoutMs: options.config.requestTimeoutMs,
    });
  }

  dispatch(input: unknown): Promise<unknown> {
    return this.#bridge.dispatch(input);
  }

  cancel(input: unknown): boolean {
    return this.#bridge.cancel(browserCancelRequestSchema.parse(input).requestId);
  }

  state(): ElectronBrowserState {
    return {
      backendGeneration: this.#backendGeneration,
      activeTabId: this.#activeTab ?? null,
      tabs: this.#registry.list(),
    };
  }

  registerGuest(guest: ElectronBrowserGuest): void {
    const tabId = guest.id;
    if (this.#guests.has(tabId))
      throw new Error(`Electron browser guest is already registered: ${tabId}`);
    this.#registry.register(guest);
    this.#guests.set(tabId, guest);
    this.#activeTab = tabId;
    const pending = this.#pendingCreation;
    if (pending !== undefined) {
      clearTimeout(pending.timer);
      this.#pendingCreation = undefined;
      this.#transport.tabRegistered({ requestId: pending.requestId, tabId });
      pending.resolve({ id: tabId, url: guest.currentUrl() || pending.url });
    }
    this.#transport.activateTab({ tabId });
    this.#emitState();
  }

  unregisterGuest(tabId: string): void {
    if (!this.#guests.delete(tabId)) return;
    if (this.#activeTab === tabId) this.#activeTab = this.#guests.keys().next().value;
    if (this.#activeTab !== undefined) this.#transport.activateTab({ tabId: this.#activeTab });
    this.#emitState();
  }

  navigationChanged(tabId: string): void {
    if (this.#guests.has(tabId)) this.#emitState();
  }

  getTab(tabId: string): BrowserAutomationTab | undefined {
    const guest = this.#guests.get(tabId);
    if (guest === undefined) return undefined;
    return {
      id: tabId,
      currentUrl: () => guest.currentUrl() || browserPolicy.initialUrl,
      title: () => guest.title(),
      send: async (method, parameters) => await guest.send(method, parameters),
    };
  }

  listTabs(): readonly BrowserTabSummary[] {
    return this.#registry.list();
  }

  activeTabId(): string | undefined {
    return this.#activeTab;
  }

  createTab(url: string, signal: AbortSignal): Promise<BrowserTabSummary> {
    signal.throwIfAborted();
    if (this.#guests.size >= this.#config.maximumTabs) {
      throw new Error(`Browser tab limit reached: ${String(this.#config.maximumTabs)}`);
    }
    if (this.#pendingCreation !== undefined)
      throw new Error("A browser tab is already being created");
    this.#createCounter += 1;
    const requestId = `browser-tab-${this.#createCounter.toString().padStart(6, "0")}`;
    return new Promise<BrowserTabSummary>((resolvePromise, rejectPromise) => {
      const onAbort = () => {
        const pending = this.#pendingCreation;
        if (pending?.requestId !== requestId) return;
        clearTimeout(pending.timer);
        this.#pendingCreation = undefined;
        rejectPromise(
          signal.reason instanceof Error
            ? signal.reason
            : new Error("Browser tab creation aborted"),
        );
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        if (this.#pendingCreation?.requestId === requestId) this.#pendingCreation = undefined;
        rejectPromise(new Error("Browser tab attachment timed out"));
      }, this.#config.tabAttachmentTimeoutMs);
      this.#pendingCreation = {
        requestId,
        url,
        resolve: (summary) => {
          signal.removeEventListener("abort", onAbort);
          resolvePromise(summary);
        },
        reject: rejectPromise,
        timer,
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.#transport.createTab({ requestId, url });
    });
  }

  activateTab(tabId: string, signal: AbortSignal): Promise<BrowserTabSummary> {
    signal.throwIfAborted();
    const guest = this.#guests.get(tabId);
    if (guest === undefined) throw new Error(`Browser tab was not found: ${tabId}`);
    this.#activeTab = tabId;
    guest.focus();
    this.#transport.activateTab({ tabId });
    this.#emitState();
    return Promise.resolve({ id: tabId, url: guest.currentUrl() || browserPolicy.initialUrl });
  }

  closeTab(tabId: string, signal: AbortSignal): Promise<{ readonly closed: boolean }> {
    signal.throwIfAborted();
    const guest = this.#guests.get(tabId);
    if (guest === undefined) return Promise.resolve({ closed: false });
    this.#guests.delete(tabId);
    this.#registry.unregister(tabId);
    guest.close({ waitForBeforeUnload: false });
    if (this.#activeTab === tabId) this.#activeTab = this.#guests.keys().next().value;
    if (this.#activeTab !== undefined) this.#transport.activateTab({ tabId: this.#activeTab });
    this.#emitState();
    return Promise.resolve({ closed: true });
  }

  async writeArtifact(
    path: string,
    base64: string,
    _mimeType: string,
    signal: AbortSignal,
  ): Promise<{ readonly path: string; readonly bytes: number }> {
    signal.throwIfAborted();
    await mkdir(this.#workspaceRoot, { recursive: true });
    const target = await resolveBrowserArtifactPath(this.#workspaceRoot, path);
    const content = Buffer.from(base64, "base64");
    await mkdir(dirname(target), { recursive: true });
    signal.throwIfAborted();
    await writeFile(target, content, { flag: "w" });
    return { path: target, bytes: content.byteLength };
  }

  async handleDialog(
    tabId: string,
    accept: boolean,
    promptText: string | undefined,
    signal: AbortSignal,
  ): Promise<unknown> {
    signal.throwIfAborted();
    const tab = this.getTab(tabId);
    if (tab === undefined) throw new Error(`Browser tab was not found: ${tabId}`);
    return await tab.send("Page.handleJavaScriptDialog", {
      accept,
      ...(promptText === undefined ? {} : { promptText }),
    });
  }

  async downloadPath(tabId: string, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    if (this.getTab(tabId) === undefined) throw new Error(`Browser tab was not found: ${tabId}`);
    const path = join(this.#workspaceRoot, this.#config.downloadDirectoryName);
    await mkdir(path, { recursive: true });
    return { tabId, path };
  }

  recordingStart(tabId: string, _path: string, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    if (this.getTab(tabId) === undefined) throw new Error(`Browser tab was not found: ${tabId}`);
    return Promise.reject(new Error(this.#config.recordingUnavailableMessage));
  }

  recordingStop(tabId: string, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    if (this.getTab(tabId) === undefined) throw new Error(`Browser tab was not found: ${tabId}`);
    return Promise.reject(new Error(this.#config.recordingUnavailableMessage));
  }

  dispose(): void {
    const pending = this.#pendingCreation;
    if (pending !== undefined) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Browser service disposed"));
      this.#pendingCreation = undefined;
    }
    this.#registry.dispose();
    this.#guests.clear();
  }

  #emitState(): void {
    this.#transport.stateChanged(this.state());
  }
}

export async function resolveBrowserArtifactPath(
  workspaceRoot: string,
  input: string,
): Promise<string> {
  const root = await realpath(resolve(workspaceRoot));
  const candidate = isAbsolute(input) ? resolve(input) : resolve(root, input);
  const target = await canonicalTarget(candidate);
  const relativePath = relative(root, target);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Browser artifact path escapes the workspace");
  }
  return target;
}

async function canonicalTarget(candidate: string): Promise<string> {
  try {
    return await realpath(candidate);
  } catch {
    const parent = dirname(candidate);
    if (parent === candidate) return candidate;
    return join(await canonicalTarget(parent), candidate.slice(parent.length + 1));
  }
}

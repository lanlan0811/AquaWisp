import { z } from "zod";

import { browserCommandCatalog, type BrowserRequest } from "./commands.js";
import { assertBrowserUrl, browserPolicy, type BrowserPolicy } from "./policy.js";
import type { BrowserCommandExecutor } from "./request-bridge.js";
import type { BrowserTabSummary } from "./tab-registry.js";

export interface BrowserAutomationTab {
  readonly id: string;
  currentUrl(): string;
  title(): string;
  send(method: string, parameters?: Readonly<Record<string, unknown>>): Promise<unknown>;
}

export interface BrowserAutomationHost {
  getTab(tabId: string): BrowserAutomationTab | undefined;
  listTabs(): readonly BrowserTabSummary[];
  activeTabId(): string | undefined;
  createTab(url: string, signal: AbortSignal): Promise<BrowserTabSummary>;
  activateTab(tabId: string, signal: AbortSignal): Promise<BrowserTabSummary>;
  closeTab(tabId: string, signal: AbortSignal): Promise<{ readonly closed: boolean }>;
  writeArtifact(
    path: string,
    base64: string,
    mimeType: string,
    signal: AbortSignal,
  ): Promise<{ readonly path: string; readonly bytes: number }>;
  handleDialog(
    tabId: string,
    accept: boolean,
    promptText: string | undefined,
    signal: AbortSignal,
  ): Promise<unknown>;
  downloadPath(tabId: string, signal: AbortSignal): Promise<unknown>;
  recordingStart(tabId: string, path: string, signal: AbortSignal): Promise<unknown>;
  recordingStop(tabId: string, signal: AbortSignal): Promise<unknown>;
}

const cdpEvaluationSchema = z.looseObject({
  result: z.looseObject({ value: z.unknown().optional() }),
  exceptionDetails: z.unknown().optional(),
});

const actionResultSchema = z.looseObject({ ok: z.boolean() });
const elementRectSchema = z
  .object({
    x: z.number().nonnegative(),
    y: z.number().nonnegative(),
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict();

interface BrowserReference {
  readonly ref: string;
  readonly selector: string;
  readonly framePath: readonly number[];
}

export interface BrowserSnapshotNode extends BrowserReference {
  readonly tag: string;
  readonly role: string;
  readonly name: string;
  readonly text: string;
  readonly xpath: string;
  readonly rect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

export interface BrowserSnapshot {
  readonly url: string;
  readonly title: string;
  readonly nodes: readonly BrowserSnapshotNode[];
}

export class BrowserCommandEngine implements BrowserCommandExecutor {
  readonly #host: BrowserAutomationHost;
  readonly #policy: BrowserPolicy;
  readonly #references = new Map<string, Map<string, BrowserReference>>();
  #snapshotEpoch = 0;

  constructor(host: BrowserAutomationHost, policy: BrowserPolicy = browserPolicy) {
    this.#host = host;
    this.#policy = policy;
  }

  async execute(request: BrowserRequest, signal: AbortSignal): Promise<unknown> {
    throwIfAborted(signal);
    const command = request.command;
    if (command.kind === "newTab") {
      const url = command.url ?? this.#policy.initialUrl;
      assertBrowserUrl(url, this.#policy);
      return await this.#host.createTab(url, signal);
    }
    if (command.kind === "activateTab") {
      return await this.#host.activateTab(command.tabId, signal);
    }
    if (command.kind === "listTabs") return this.#host.listTabs();
    if (command.kind === "close") {
      const tabId = command.tabId ?? request.tabId;
      this.#references.delete(tabId);
      return await this.#host.closeTab(tabId, signal);
    }
    if (command.kind === "handleDialog") {
      return await this.#host.handleDialog(
        request.tabId,
        command.accept,
        command.promptText,
        signal,
      );
    }
    if (command.kind === "downloadPath")
      return await this.#host.downloadPath(request.tabId, signal);
    if (command.kind === "recordingStart") {
      return await this.#host.recordingStart(request.tabId, command.path, signal);
    }
    if (command.kind === "recordingStop")
      return await this.#host.recordingStop(request.tabId, signal);

    const tab = this.#requireTab(request.tabId);
    if (command.kind === "navigate") {
      assertBrowserUrl(command.url, this.#policy);
      this.#references.delete(tab.id);
      const result = await tab.send("Page.navigate", { url: command.url });
      return { url: command.url, result };
    }
    if (command.kind === "back" || command.kind === "forward") {
      this.#references.delete(tab.id);
      const expression = command.kind === "back" ? "history.back()" : "history.forward()";
      await this.#evaluate(tab, expression, false);
      return this.#state(tab);
    }
    if (command.kind === "reload") {
      this.#references.delete(tab.id);
      await tab.send("Page.reload", { ignoreCache: false });
      return this.#state(tab);
    }
    if (command.kind === "waitForURL") {
      await this.#waitUntil(
        () => Promise.resolve(tab.currentUrl().includes(command.url)),
        command.timeoutMs,
        signal,
        `URL containing ${command.url}`,
      );
      return this.#state(tab);
    }
    if (command.kind === "waitFor") {
      const reference =
        command.ref === undefined ? undefined : this.#requireReference(tab, command.ref);
      await this.#waitUntil(
        async () => {
          if (reference !== undefined) {
            return actionResultSchema.parse(
              await this.#evaluate(
                tab,
                resolveExpression(reference, "return {ok:Boolean(element)};"),
                true,
              ),
            ).ok;
          }
          const found = await this.#evaluate(
            tab,
            `document.body?.innerText.includes(${JSON.stringify(command.text ?? "")}) === true`,
            true,
          );
          return found === true;
        },
        command.timeoutMs,
        signal,
        command.ref === undefined ? `text ${command.text ?? ""}` : `reference ${command.ref}`,
      );
      return { matched: true };
    }
    if (command.kind === "snapshot") return await this.#snapshot(tab);
    if (command.kind === "getState") return this.#state(tab);
    if (command.kind === "evaluate") return await this.#evaluate(tab, command.expression, true);
    if (command.kind === "screenshot") {
      return await this.#captureScreenshot(tab, command.path, undefined, signal);
    }
    if (command.kind === "elementScreenshot") {
      const reference = this.#requireReference(tab, command.ref);
      const rect = elementRectSchema.parse(
        await this.#evaluate(
          tab,
          resolveExpression(
            reference,
            "if (!element) return null; const rect=element.getBoundingClientRect(); return {x:rect.x+window.scrollX,y:rect.y+window.scrollY,width:rect.width,height:rect.height};",
          ),
          true,
        ),
      );
      return await this.#captureScreenshot(tab, command.path, rect, signal);
    }
    if (command.kind === "type") {
      await tab.send("Input.insertText", { text: command.value });
      return { typed: true };
    }
    if (command.kind === "press") {
      await tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: command.key });
      await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: command.key });
      return { pressed: command.key };
    }
    if (command.kind === "scroll") {
      await this.#evaluate(
        tab,
        `window.scrollBy(${String(command.deltaX)},${String(command.deltaY)}); true`,
        true,
      );
      return { scrolled: true };
    }

    const reference = this.#requireReference(tab, command.ref);
    if (command.kind === "click") {
      await this.#performReferenceAction(tab, reference, "element.click(); return {ok:true};");
      return { clicked: command.ref };
    }
    if (command.kind === "hover") {
      await this.#performReferenceAction(
        tab,
        reference,
        'element.dispatchEvent(new MouseEvent("mouseover",{bubbles:true})); return {ok:true};',
      );
      return { hovered: command.ref };
    }
    if (command.kind === "fill") {
      const value = JSON.stringify(command.value);
      await this.#performReferenceAction(
        tab,
        reference,
        `if (!("value" in element)) return {ok:false}; element.value=${value}; element.dispatchEvent(new Event("input",{bubbles:true})); element.dispatchEvent(new Event("change",{bubbles:true})); return {ok:true};`,
      );
      return { filled: command.ref };
    }
    if (command.kind === "select") {
      const values = JSON.stringify(command.values);
      await this.#performReferenceAction(
        tab,
        reference,
        `if (!(element instanceof HTMLSelectElement)) return {ok:false}; const values=new Set(${values}); for (const option of element.options) option.selected=values.has(option.value); element.dispatchEvent(new Event("input",{bubbles:true})); element.dispatchEvent(new Event("change",{bubbles:true})); return {ok:true};`,
      );
      return { selected: command.ref };
    }
    const checked = command.checked ? "true" : "false";
    await this.#performReferenceAction(
      tab,
      reference,
      `if (!("checked" in element)) return {ok:false}; element.checked=${checked}; element.dispatchEvent(new Event("input",{bubbles:true})); element.dispatchEvent(new Event("change",{bubbles:true})); return {ok:true};`,
    );
    return { checked: command.ref, value: command.checked };
  }

  #requireTab(tabId: string): BrowserAutomationTab {
    const tab = this.#host.getTab(tabId);
    if (tab === undefined) throw new Error(`Browser tab was not found: ${tabId}`);
    return tab;
  }

  #state(tab: BrowserAutomationTab): Readonly<Record<string, unknown>> {
    return {
      activeTabId: this.#host.activeTabId() ?? null,
      tabId: tab.id,
      title: tab.title(),
      url: tab.currentUrl(),
      tabs: this.#host.listTabs(),
    };
  }

  async #snapshot(tab: BrowserAutomationTab): Promise<BrowserSnapshot> {
    this.#snapshotEpoch += 1;
    const expression = snapshotExpression(this.#policy, this.#snapshotEpoch);
    const snapshotSchema = z
      .object({
        url: z.string().max(browserCommandCatalog.limits.urlCharacters),
        title: z.string().max(this.#policy.automation.maximumNodeTextCharacters),
        nodes: z
          .array(
            z
              .object({
                ref: z.string().min(1).max(browserCommandCatalog.limits.refCharacters),
                tag: z.string().max(64),
                role: z.string().max(128),
                name: z.string().max(this.#policy.automation.maximumNodeTextCharacters),
                text: z.string().max(this.#policy.automation.maximumNodeTextCharacters),
                selector: z.string().min(1).max(browserCommandCatalog.limits.selectorCharacters),
                xpath: z.string().max(browserCommandCatalog.limits.pathCharacters),
                framePath: z
                  .array(z.number().int().nonnegative())
                  .max(browserCommandCatalog.limits.frameDepth),
                rect: z
                  .object({
                    x: z.number(),
                    y: z.number(),
                    width: z.number().nonnegative(),
                    height: z.number().nonnegative(),
                  })
                  .strict(),
              })
              .strict(),
          )
          .max(this.#policy.automation.maximumSnapshotElements),
      })
      .strict();
    const snapshot = snapshotSchema.parse(await this.#evaluate(tab, expression, true));
    const references = new Map<string, BrowserReference>();
    for (const node of snapshot.nodes) {
      if (references.has(node.ref))
        throw new Error(`Browser snapshot contains duplicate ref: ${node.ref}`);
      references.set(node.ref, {
        ref: node.ref,
        selector: node.selector,
        framePath: node.framePath,
      });
    }
    this.#references.set(tab.id, references);
    return snapshot;
  }

  #requireReference(tab: BrowserAutomationTab, ref: string): BrowserReference {
    const reference = this.#references.get(tab.id)?.get(ref);
    if (reference === undefined) {
      throw new Error(`Browser reference is missing or stale; take a new snapshot: ${ref}`);
    }
    return reference;
  }

  async #performReferenceAction(
    tab: BrowserAutomationTab,
    reference: BrowserReference,
    body: string,
  ): Promise<void> {
    const result = actionResultSchema.parse(
      await this.#evaluate(
        tab,
        resolveExpression(reference, `if (!element) return {ok:false}; ${body}`),
        true,
      ),
    );
    if (!result.ok)
      throw new Error(`Browser reference cannot perform this action: ${reference.ref}`);
  }

  async #captureScreenshot(
    tab: BrowserAutomationTab,
    path: string,
    clip: z.infer<typeof elementRectSchema> | undefined,
    signal: AbortSignal,
  ): Promise<unknown> {
    const parameters: Record<string, unknown> = {
      format: this.#policy.automation.screenshotFormat,
      fromSurface: true,
      captureBeyondViewport: true,
    };
    if (clip !== undefined) parameters.clip = { ...clip, scale: 1 };
    const response = z
      .looseObject({
        data: z.string().max(this.#policy.automation.maximumArtifactBase64Characters),
      })
      .parse(await tab.send("Page.captureScreenshot", parameters));
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(response.data)) {
      throw new Error("Browser screenshot returned invalid base64 data");
    }
    const artifact = await this.#host.writeArtifact(path, response.data, "image/png", signal);
    return { ...artifact, mimeType: "image/png", tabId: tab.id };
  }

  async #evaluate(
    tab: BrowserAutomationTab,
    expression: string,
    returnByValue: boolean,
  ): Promise<unknown> {
    const response = cdpEvaluationSchema.parse(
      await tab.send("Runtime.evaluate", {
        expression,
        returnByValue,
        awaitPromise: true,
        userGesture: true,
      }),
    );
    if (response.exceptionDetails !== undefined) throw new Error("Browser page evaluation failed");
    return response.result.value;
  }

  async #waitUntil(
    predicate: () => Promise<boolean>,
    timeoutMs: number,
    signal: AbortSignal,
    description: string,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      throwIfAborted(signal);
      if (await predicate()) return;
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await delay(Math.min(this.#policy.automation.waitPollIntervalMs, remaining), signal);
    }
    throw new Error(`Browser wait timed out: ${description}`);
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error("Browser request aborted");
}

async function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal.reason instanceof Error ? signal.reason : new Error("Browser request aborted"));
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function resolveExpression(reference: BrowserReference, body: string): string {
  return `(() => { let documentRoot=document; for (const frameIndex of ${JSON.stringify(reference.framePath)}) { const frame=documentRoot.querySelectorAll("iframe,frame")[frameIndex]; if (!frame?.contentDocument) return {ok:false}; documentRoot=frame.contentDocument; } const element=documentRoot.querySelector(${JSON.stringify(reference.selector)}); ${body} })()`;
}

function snapshotExpression(policy: BrowserPolicy, epoch: number): string {
  const options = {
    selector: policy.automation.interactiveSelector,
    attribute: policy.automation.referenceAttribute,
    prefix: `${policy.automation.referencePrefix}-${String(epoch)}`,
    maximumElements: policy.automation.maximumSnapshotElements,
    maximumText: policy.automation.maximumNodeTextCharacters,
  };
  return `(() => { const options=${JSON.stringify(options)}; const nodes=[]; const clean=(value)=>String(value??"").replace(/\\s+/gu," ").trim().slice(0,options.maximumText); const xpath=(element)=>{const parts=[]; for(let current=element; current&&current.nodeType===1; current=current.parentElement){let index=1; for(let sibling=current.previousElementSibling;sibling;sibling=sibling.previousElementSibling) if(sibling.tagName===current.tagName) index+=1; parts.unshift(current.tagName.toLowerCase()+"["+String(index)+"]");} return "/"+parts.join("/");}; const role=(element)=>element.getAttribute("role")||({A:"link",BUTTON:"button",INPUT:"textbox",TEXTAREA:"textbox",SELECT:"combobox"}[element.tagName]||""); const walk=(documentRoot,framePath)=>{for(const old of documentRoot.querySelectorAll("["+options.attribute+"]")) old.removeAttribute(options.attribute); const candidates=documentRoot.querySelectorAll(options.selector); for(const element of candidates){if(nodes.length>=options.maximumElements) return; const rect=element.getBoundingClientRect(); const style=element.ownerDocument.defaultView?.getComputedStyle(element); if(rect.width<=0||rect.height<=0||style?.visibility==="hidden"||style?.display==="none") continue; const ref=options.prefix+"-"+String(nodes.length+1); element.setAttribute(options.attribute,ref); const name=clean(element.getAttribute("aria-label")||element.getAttribute("title")||element.getAttribute("alt")||element.getAttribute("placeholder")||element.textContent); const text=clean("value" in element?element.value:element.textContent); nodes.push({ref,tag:element.tagName.toLowerCase(),role:role(element),name,text,selector:"["+options.attribute+"='"+ref+"']",xpath:xpath(element),framePath,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}}); } const frames=documentRoot.querySelectorAll("iframe,frame"); for(let index=0;index<frames.length&&nodes.length<options.maximumElements;index+=1){try{const nested=frames[index].contentDocument;if(nested) walk(nested,[...framePath,index]);}catch{}}}; walk(document,[]); return {url:location.href,title:clean(document.title),nodes}; })()`;
}

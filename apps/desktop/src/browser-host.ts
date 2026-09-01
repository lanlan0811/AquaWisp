import {
  assertBrowserUrl,
  BrowserTabRegistry,
  browserPolicy,
  type BrowserTabPort,
} from "@aquawisp/browser";

export const browserTabs = new BrowserTabRegistry(browserPolicy);

export function validateWebviewSource(value: string): void {
  assertBrowserUrl(value || browserPolicy.initialUrl, browserPolicy);
}

export function registerBrowserTab(port: BrowserTabPort): void {
  browserTabs.register(port);
}

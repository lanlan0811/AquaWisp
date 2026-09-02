import {
  browserCommandCatalog,
  browserCommandSchema,
  browserRequestSchema,
} from "@aquawisp/browser";
import { describe, expect, it } from "vitest";

const examples: readonly unknown[] = [
  { kind: "navigate", url: "https://example.test" },
  { kind: "back" },
  { kind: "forward" },
  { kind: "reload" },
  { kind: "waitFor", text: "完成", timeoutMs: 1_000 },
  { kind: "waitForURL", url: "example.test/result", timeoutMs: 1_000 },
  { kind: "snapshot" },
  { kind: "screenshot", path: "artifacts/page.png" },
  { kind: "elementScreenshot", ref: "ref-1", path: "artifacts/element.png" },
  { kind: "evaluate", expression: "document.title" },
  { kind: "getState" },
  { kind: "click", ref: "ref-1" },
  { kind: "fill", ref: "ref-1", value: "沧渡" },
  { kind: "type", value: "AquaWisp" },
  { kind: "press", key: "Enter" },
  { kind: "hover", ref: "ref-1" },
  { kind: "scroll", deltaX: 0, deltaY: 600 },
  { kind: "select", ref: "ref-1", values: ["option-1"] },
  { kind: "check", ref: "ref-1", checked: true },
  { kind: "newTab", url: "https://example.test" },
  { kind: "activateTab", tabId: "tab-2" },
  { kind: "listTabs" },
  { kind: "close", tabId: "tab-2" },
  { kind: "handleDialog", accept: true, promptText: "确认" },
  { kind: "downloadPath" },
  { kind: "recordingStart", path: "artifacts/session.webm" },
  { kind: "recordingStop" },
];

describe("M6 browser command catalog", () => {
  it("keeps every planned command synchronized with a strict schema", () => {
    const parsed = examples.map((example) => browserCommandSchema.parse(example));
    expect(parsed.map(({ kind }) => kind)).toEqual(browserCommandCatalog.commands);
  });

  it("rejects invalid wait, scroll, and unknown command shapes", () => {
    expect(() => browserCommandSchema.parse({ kind: "waitFor", timeoutMs: 100 })).toThrow();
    expect(() =>
      browserCommandSchema.parse({ kind: "scroll", deltaX: 0, deltaY: 100_001 }),
    ).toThrow();
    expect(() => browserCommandSchema.parse({ kind: "unknown" })).toThrow();
  });

  it("requires a positive backend generation on every bridged request", () => {
    const request = {
      requestId: "request-1",
      backendGeneration: 2,
      tabId: "tab-1",
      command: { kind: "snapshot" },
    };
    expect(browserRequestSchema.parse(request)).toEqual(request);
    expect(() => browserRequestSchema.parse({ ...request, backendGeneration: 0 })).toThrow();
    expect(() =>
      browserRequestSchema.parse({
        requestId: request.requestId,
        tabId: request.tabId,
        command: request.command,
      }),
    ).toThrow();
  });
});

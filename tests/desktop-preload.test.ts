import { desktopConfig } from "@aquawisp/desktop";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("M5 sandbox preload", () => {
  it("generates a narrow API from the IPC channel registry", async () => {
    const preload = await readFile(
      resolve(repositoryRoot, "apps", "desktop", "src", "preload.cjs"),
      "utf8",
    );
    for (const channel of Object.values(desktopConfig.ipcChannels)) {
      expect(preload).toContain(channel);
    }
    expect(preload).toContain("contextBridge.exposeInMainWorld");
    expect(preload).toContain("conversation: Object.freeze");
    expect(preload).toContain("start: (request)");
    expect(preload).toContain("cancel: (request)");
    expect(preload).toContain("onEvent: (listener)");
    expect(preload).toContain("knowledge: Object.freeze");
    expect(preload).toContain("addFiles: ()");
    expect(preload).toContain("remove: (request)");
    expect(preload).toContain("approvals: Object.freeze");
    expect(preload).toContain("resolve: (request)");
    expect(preload).toContain("settings: Object.freeze");
    expect(preload).not.toContain("decrypt");
    expect(preload).not.toContain("secrets: Object.freeze({\n      get:");
  });
});

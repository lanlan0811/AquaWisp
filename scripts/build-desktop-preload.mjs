import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(repositoryRoot, "apps", "desktop", "src", "desktop-config.data.json");
const sourcePath = resolve(repositoryRoot, "apps", "desktop", "src", "preload.cjs");
const outputPath = resolve(repositoryRoot, "apps", "desktop", "dist", "preload.cjs");
const config = JSON.parse(await readFile(configPath, "utf8"));
const channels = config.ipcChannels;
if (
  typeof channels?.runtimePing !== "string" ||
  typeof channels.secretSet !== "string" ||
  typeof channels.secretHas !== "string" ||
  typeof channels.secretDelete !== "string" ||
  typeof channels.settingsGet !== "string" ||
  typeof channels.settingsSet !== "string" ||
  typeof channels.conversationStart !== "string" ||
  typeof channels.conversationCancel !== "string" ||
  typeof channels.conversationEvent !== "string" ||
  typeof channels.knowledgeList !== "string" ||
  typeof channels.knowledgeAddFiles !== "string" ||
  typeof channels.knowledgeRemove !== "string" ||
  typeof channels.approvalResolve !== "string" ||
  typeof channels.browserExecute !== "string" ||
  typeof channels.browserCancel !== "string" ||
  typeof channels.browserState !== "string" ||
  typeof channels.browserStateChanged !== "string" ||
  typeof channels.browserCreateTab !== "string" ||
  typeof channels.browserTabRegistered !== "string" ||
  typeof channels.browserActivateTab !== "string"
) {
  throw new Error("Desktop IPC channel registry is invalid");
}

const source = `"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const channels = Object.freeze({
  runtimePing: ${JSON.stringify(channels.runtimePing)},
  secretSet: ${JSON.stringify(channels.secretSet)},
  secretHas: ${JSON.stringify(channels.secretHas)},
  secretDelete: ${JSON.stringify(channels.secretDelete)},
  settingsGet: ${JSON.stringify(channels.settingsGet)},
  settingsSet: ${JSON.stringify(channels.settingsSet)},
  conversationStart: ${JSON.stringify(channels.conversationStart)},
  conversationCancel: ${JSON.stringify(channels.conversationCancel)},
  conversationEvent: ${JSON.stringify(channels.conversationEvent)},
  knowledgeList: ${JSON.stringify(channels.knowledgeList)},
  knowledgeAddFiles: ${JSON.stringify(channels.knowledgeAddFiles)},
  knowledgeRemove: ${JSON.stringify(channels.knowledgeRemove)},
  approvalResolve: ${JSON.stringify(channels.approvalResolve)},
  browserExecute: ${JSON.stringify(channels.browserExecute)},
  browserCancel: ${JSON.stringify(channels.browserCancel)},
  browserState: ${JSON.stringify(channels.browserState)},
  browserStateChanged: ${JSON.stringify(channels.browserStateChanged)},
  browserCreateTab: ${JSON.stringify(channels.browserCreateTab)},
  browserTabRegistered: ${JSON.stringify(channels.browserTabRegistered)},
  browserActivateTab: ${JSON.stringify(channels.browserActivateTab)},
});
contextBridge.exposeInMainWorld(
  "aquawisp",
  Object.freeze({
    runtimePing: () => ipcRenderer.invoke(channels.runtimePing),
    conversation: Object.freeze({
      start: (request) => ipcRenderer.invoke(channels.conversationStart, request),
      cancel: (request) => ipcRenderer.invoke(channels.conversationCancel, request),
      onEvent: (listener) => {
        const handler = (_event, message) => listener(message);
        ipcRenderer.on(channels.conversationEvent, handler);
        return () => ipcRenderer.removeListener(channels.conversationEvent, handler);
      },
    }),
    knowledge: Object.freeze({
      list: () => ipcRenderer.invoke(channels.knowledgeList),
      addFiles: () => ipcRenderer.invoke(channels.knowledgeAddFiles),
      remove: (request) => ipcRenderer.invoke(channels.knowledgeRemove, request),
    }),
    approvals: Object.freeze({
      resolve: (request) => ipcRenderer.invoke(channels.approvalResolve, request),
    }),
    browser: Object.freeze({
      execute: (request) => ipcRenderer.invoke(channels.browserExecute, request),
      cancel: (requestId) => ipcRenderer.invoke(channels.browserCancel, { requestId }),
      state: () => ipcRenderer.invoke(channels.browserState),
      onStateChanged: (listener) => listen(channels.browserStateChanged, listener),
      onCreateTab: (listener) => listen(channels.browserCreateTab, listener),
      onTabRegistered: (listener) => listen(channels.browserTabRegistered, listener),
      onActivateTab: (listener) => listen(channels.browserActivateTab, listener),
    }),
    settings: Object.freeze({
      get: () => ipcRenderer.invoke(channels.settingsGet),
      set: (settings) => ipcRenderer.invoke(channels.settingsSet, settings),
    }),
    secrets: Object.freeze({
      set: (name, value) => ipcRenderer.invoke(channels.secretSet, { name, value }),
      has: (name) => ipcRenderer.invoke(channels.secretHas, { name }),
      delete: (name) => ipcRenderer.invoke(channels.secretDelete, { name }),
    }),
  }),
);

function listen(channel, listener) {
  const handler = (_event, message) => listener(message);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}
`;

const mode = process.argv[2] ?? "--compile";
if (mode === "--write") {
  await mkdir(dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, source, "utf8");
} else if (mode !== "--check" && mode !== "--compile") {
  throw new Error(`Unknown desktop preload build mode: ${mode}`);
}

await access(sourcePath);
if ((await readFile(sourcePath, "utf8")) !== source) {
  throw new Error("Desktop preload is out of date; run npm run preload");
}

if (mode !== "--check") {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, source, "utf8");
  process.stdout.write(`Desktop preload compiled: ${outputPath}\n`);
} else {
  process.stdout.write("Desktop preload source verified.\n");
}

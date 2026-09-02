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
  typeof channels.settingsSet !== "string"
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
});
contextBridge.exposeInMainWorld(
  "aquawisp",
  Object.freeze({
    runtimePing: () => ipcRenderer.invoke(channels.runtimePing),
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

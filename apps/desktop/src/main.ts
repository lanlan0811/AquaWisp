import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, type BrowserWindow as BrowserWindowType } from "electron";

import { createRuntimeEnvironment, desktopConfig } from "./desktop-config.js";
import { createDesktopMarkup, desktopStyles } from "./renderer/ui.js";
import { RuntimeProcessClient } from "./runtime-client.js";

let runtime: RuntimeProcessClient | undefined;
let shutdownStarted = false;

function createWindow(runtimeConnected: boolean): BrowserWindowType {
  const window = new BrowserWindow({
    ...desktopConfig.window,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const document = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>沧渡 AquaWisp</title><style>${desktopStyles}</style></head><body>${createDesktopMarkup({ mode: "work", workspaceName: "本地工作区", modelName: "GLM-5.3", running: false, runtimeStatus: runtimeConnected ? "connected" : "disconnected" })}</body></html>`;
  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(document)}`);
  return window;
}

void app.whenReady().then(() => {
  void startRuntime().then(createWindow, () => createWindow(false));
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(runtime !== undefined);
    }
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", (event) => {
  if (runtime === undefined || shutdownStarted) return;
  event.preventDefault();
  shutdownStarted = true;
  void runtime.close().finally(() => {
    runtime = undefined;
    app.quit();
  });
});

async function startRuntime(): Promise<boolean> {
  const runtimeDirectory = join(
    app.getPath("userData"),
    desktopConfig.runtime.workingDirectoryName,
  );
  await mkdir(runtimeDirectory, { recursive: true });
  const hostPath = fileURLToPath(import.meta.resolve("@aquawisp/runtime/process-host"));
  runtime = new RuntimeProcessClient({
    executable: process.execPath,
    args: [hostPath],
    cwd: runtimeDirectory,
    environment: createRuntimeEnvironment(process.env, desktopConfig.runtime),
    requestTimeoutMs: desktopConfig.runtime.requestTimeoutMs,
    maxLineBytes: desktopConfig.runtime.maxLineBytes,
    maxStderrBytes: desktopConfig.runtime.maxStderrBytes,
  });
  runtime.start();
  try {
    const response = await runtime.request("runtime.ping");
    if (!response.ok || response.result.status !== "ready") {
      throw new Error("Runtime did not report ready status");
    }
    return true;
  } catch (error) {
    await runtime.close().catch(() => undefined);
    runtime = undefined;
    throw error;
  }
}

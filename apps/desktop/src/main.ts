import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  desktopRuntimeStatusResultSchema,
  desktopSecretDeleteResultSchema,
  desktopSecretMutationResultSchema,
  desktopSecretNameRequestSchema,
  desktopSecretPresenceResultSchema,
  desktopSecretSetRequestSchema,
} from "@aquawisp/contracts";
import { browserPolicy, hardenWebviewPreferences, type BrowserTabPort } from "@aquawisp/browser";
import {
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
  type BrowserWindow as BrowserWindowType,
  type IpcMainInvokeEvent,
} from "electron";

import { createRuntimeEnvironment, desktopConfig } from "./desktop-config.js";
import { browserTabs, registerBrowserTab, validateWebviewSource } from "./browser-host.js";
import { createDesktopMarkup, desktopStyles } from "./renderer/ui.js";
import { RuntimeProcessClient } from "./runtime-client.js";
import { SecretVault } from "./secret-vault.js";

let runtime: RuntimeProcessClient | undefined;
let shutdownStarted = false;
let authorizedWebContentsId: number | undefined;

function createWindow(runtimeConnected: boolean): BrowserWindowType {
  const window = new BrowserWindow({
    ...desktopConfig.window,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)),
    },
  });
  authorizedWebContentsId = window.webContents.id;
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-attach-webview", (event, preferences, params) => {
    try {
      validateWebviewSource(params.src ?? "");
      hardenWebviewPreferences(preferences);
    } catch {
      event.preventDefault();
    }
  });
  window.webContents.on("did-attach-webview", (_event, guest) => {
    const port: BrowserTabPort = {
      id: guest.id.toString(),
      currentUrl: () => guest.getURL() || browserPolicy.initialUrl,
      isDebuggerAttached: () => guest.debugger.isAttached(),
      attachDebugger: (version) => {
        guest.debugger.attach(version);
      },
      detachDebugger: () => {
        guest.debugger.detach();
      },
      denyWindowOpen: () => {
        guest.setWindowOpenHandler(() => ({ action: "deny" }));
      },
      onWillNavigate: (handler) => {
        guest.on("will-navigate", (navigationEvent, url) => {
          if (!handler(url)) navigationEvent.preventDefault();
        });
      },
      onDestroyed: (handler) => {
        guest.once("destroyed", handler);
      },
    };
    registerBrowserTab(port);
  });
  window.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  const document = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>沧渡 AquaWisp</title><style>${desktopStyles}</style></head><body>${createDesktopMarkup({ mode: "work", workspaceName: "本地工作区", modelName: "GLM-5.3", running: false, runtimeStatus: runtimeConnected ? "connected" : "disconnected", browserVisible: true })}</body></html>`;
  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(document)}`);
  return window;
}

void app.whenReady().then(() => {
  registerDesktopIpc(
    new SecretVault({
      filePath: join(app.getPath("userData"), desktopConfig.secrets.fileName),
      maxSecretCharacters: desktopConfig.secrets.maxSecretCharacters,
      maxCiphertextBytes: desktopConfig.secrets.maxCiphertextBytes,
      cipher: safeStorage,
    }),
  );
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
  browserTabs.dispose();
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

function registerDesktopIpc(secretVault: SecretVault): void {
  ipcMain.handle(desktopConfig.ipcChannels.runtimePing, async (event) => {
    assertAuthorizedRenderer(event);
    if (runtime === undefined) {
      return desktopRuntimeStatusResultSchema.parse({ connected: false });
    }
    try {
      const response = await runtime.request("runtime.ping");
      return desktopRuntimeStatusResultSchema.parse({
        connected: response.ok && response.result.status === "ready",
      });
    } catch {
      return desktopRuntimeStatusResultSchema.parse({ connected: false });
    }
  });
  ipcMain.handle(desktopConfig.ipcChannels.secretSet, async (event, input: unknown) => {
    assertAuthorizedRenderer(event);
    const request = desktopSecretSetRequestSchema.parse(input);
    await secretVault.set(request.name, request.value);
    return desktopSecretMutationResultSchema.parse({ stored: true });
  });
  ipcMain.handle(desktopConfig.ipcChannels.secretHas, async (event, input: unknown) => {
    assertAuthorizedRenderer(event);
    const request = desktopSecretNameRequestSchema.parse(input);
    return desktopSecretPresenceResultSchema.parse({
      present: await secretVault.has(request.name),
    });
  });
  ipcMain.handle(desktopConfig.ipcChannels.secretDelete, async (event, input: unknown) => {
    assertAuthorizedRenderer(event);
    const request = desktopSecretNameRequestSchema.parse(input);
    return desktopSecretDeleteResultSchema.parse({
      deleted: await secretVault.delete(request.name),
    });
  });
}

function assertAuthorizedRenderer(event: IpcMainInvokeEvent): void {
  if (authorizedWebContentsId === undefined || event.sender.id !== authorizedWebContentsId) {
    throw new Error("Desktop IPC request came from an unauthorized renderer");
  }
}

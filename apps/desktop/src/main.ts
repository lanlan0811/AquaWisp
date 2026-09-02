import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  desktopApprovalResolveRequestSchema,
  desktopApprovalResolveResultSchema,
  desktopConversationCancelRequestSchema,
  desktopConversationEventSchema,
  desktopConversationStartRequestSchema,
  desktopConversationStartResultSchema,
  desktopKnowledgeAddFilesResultSchema,
  desktopKnowledgeRemoveRequestSchema,
  desktopKnowledgeStateResultSchema,
  desktopRuntimeStatusResultSchema,
  desktopSecretDeleteResultSchema,
  desktopSecretMutationResultSchema,
  desktopSecretNameRequestSchema,
  desktopSecretPresenceResultSchema,
  desktopSecretSetRequestSchema,
  desktopSettingsSchema,
  jsonValueSchema,
  knowledgeIngestedFileSchema,
  type RuntimeHostRequest,
  type DesktopSettings,
} from "@aquawisp/contracts";
import { browserPolicy, hardenWebviewPreferences } from "@aquawisp/browser";
import { getBuiltInModel } from "@aquawisp/models-catalog";
import { runtimeHostConfig } from "@aquawisp/runtime";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  type BrowserWindow as BrowserWindowType,
  type IpcMainInvokeEvent,
} from "electron";

import { createRuntimeEnvironment, desktopConfig } from "./desktop-config.js";
import { browserTabs, validateWebviewSource } from "./browser-host.js";
import { ElectronBrowserService } from "./electron-browser-service.js";
import { createDesktopDocument } from "./renderer/ui.js";
import { RuntimeProcessClient } from "./runtime-client.js";
import { resolveDesktopRunSelection } from "./run-selection.js";
import { SecretVault } from "./secret-vault.js";
import { DesktopSettingsStore } from "./settings-store.js";

let runtime: RuntimeProcessClient | undefined;
let browserService: ElectronBrowserService | undefined;
let shutdownStarted = false;
let authorizedWebContentsId: number | undefined;
let browserGeneration = desktopConfig.browser.initialBackendGeneration - 1;

function createWindow(runtimeConnected: boolean, settings: DesktopSettings): BrowserWindowType {
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
  browserGeneration += 1;
  browserService?.dispose();
  browserService = new ElectronBrowserService({
    workspaceRoot: join(runtimeWorkingDirectory(), runtimeHostConfig.tools.workspaceDirectoryName),
    backendGeneration: browserGeneration,
    config: desktopConfig.browser,
    registry: browserTabs,
    transport: {
      createTab: (message) => {
        window.webContents.send(desktopConfig.ipcChannels.browserCreateTab, message);
      },
      tabRegistered: (message) => {
        window.webContents.send(desktopConfig.ipcChannels.browserTabRegistered, message);
      },
      activateTab: (message) => {
        window.webContents.send(desktopConfig.ipcChannels.browserActivateTab, message);
      },
      stateChanged: (state) => {
        window.webContents.send(desktopConfig.ipcChannels.browserStateChanged, state);
      },
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
    browserService?.registerGuest({
      id: String(guest.id),
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
      title: () => guest.getTitle(),
      focus: () => {
        guest.focus();
      },
      close: (options) => {
        guest.close(options);
      },
      send: async (method, parameters) =>
        (await guest.debugger.sendCommand(method, parameters)) as unknown,
    });
    guest.on("did-navigate", () => {
      browserService?.navigationChanged(String(guest.id));
    });
    guest.once("destroyed", () => {
      browserService?.unregisterGuest(String(guest.id));
    });
  });
  window.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  const scriptNonce = randomBytes(18).toString("base64");
  const document = createDesktopDocument(
    {
      mode: settings.mode,
      workspaceName: "本地工作区",
      modelName: getBuiltInModel(settings.modelId).name,
      running: false,
      runtimeStatus: runtimeConnected ? "connected" : "disconnected",
      browserVisible: true,
      providerId: settings.providerId,
      modelId: settings.modelId,
      protocol: settings.protocol,
      reasoningLevel: settings.reasoningLevel,
      secretName: settings.secretName,
    },
    scriptNonce,
  );
  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(document)}`);
  return window;
}

void app.whenReady().then(() => {
  const settingsStore = new DesktopSettingsStore({
    filePath: join(app.getPath("userData"), desktopConfig.settings.fileName),
    defaults: desktopSettingsSchema.parse({
      providerId: desktopConfig.settings.defaultProviderId,
      modelId: desktopConfig.settings.defaultModelId,
      protocol: desktopConfig.settings.defaultProtocol,
      reasoningLevel: desktopConfig.settings.defaultReasoningLevel,
      secretName: desktopConfig.settings.defaultSecretName,
      mode: desktopConfig.settings.defaultMode,
    }),
  });
  registerDesktopIpc(
    new SecretVault({
      filePath: join(app.getPath("userData"), desktopConfig.secrets.fileName),
      maxSecretCharacters: desktopConfig.secrets.maxSecretCharacters,
      maxCiphertextBytes: desktopConfig.secrets.maxCiphertextBytes,
      cipher: safeStorage,
    }),
    settingsStore,
  );
  void Promise.all([startRuntime().catch(() => false), settingsStore.get()]).then(
    ([connected, settings]) => createWindow(connected, settings),
  );
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void settingsStore.get().then((settings) => createWindow(runtime !== undefined, settings));
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
  browserService?.dispose();
  browserService = undefined;
  void runtime.close().finally(() => {
    runtime = undefined;
    app.quit();
  });
});

async function startRuntime(): Promise<boolean> {
  const runtimeDirectory = runtimeWorkingDirectory();
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
    onEvent: (message) => {
      const target = BrowserWindow.getAllWindows().find(
        ({ webContents }) => webContents.id === authorizedWebContentsId,
      );
      if (target !== undefined && !target.isDestroyed()) {
        target.webContents.send(
          desktopConfig.ipcChannels.conversationEvent,
          desktopConversationEventSchema.parse(message.event),
        );
      }
    },
    onHostRequest: handleRuntimeHostRequest,
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

function registerDesktopIpc(secretVault: SecretVault, settingsStore: DesktopSettingsStore): void {
  ipcMain.handle(desktopConfig.ipcChannels.browserExecute, async (event, input: unknown) => {
    assertAuthorizedRenderer(event);
    if (browserService === undefined) throw new Error("Browser service is not available");
    return await browserService.dispatch(input);
  });
  ipcMain.handle(desktopConfig.ipcChannels.browserCancel, (event, input: unknown) => {
    assertAuthorizedRenderer(event);
    if (browserService === undefined) throw new Error("Browser service is not available");
    return { cancelled: browserService.cancel(input) };
  });
  ipcMain.handle(desktopConfig.ipcChannels.browserState, (event) => {
    assertAuthorizedRenderer(event);
    if (browserService === undefined) throw new Error("Browser service is not available");
    return browserService.state();
  });
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
  ipcMain.handle(desktopConfig.ipcChannels.settingsGet, async (event) => {
    assertAuthorizedRenderer(event);
    return desktopSettingsSchema.parse(await settingsStore.get());
  });
  ipcMain.handle(desktopConfig.ipcChannels.settingsSet, async (event, input: unknown) => {
    assertAuthorizedRenderer(event);
    return desktopSettingsSchema.parse(await settingsStore.set(input));
  });
  ipcMain.handle(desktopConfig.ipcChannels.conversationStart, async (event, input: unknown) => {
    assertAuthorizedRenderer(event);
    if (runtime === undefined) throw new Error("Runtime is not connected");
    const request = desktopConversationStartRequestSchema.parse(input);
    const settings = await settingsStore.get();
    const selection = resolveDesktopRunSelection(settings, request);
    const apiKey = await secretVault.get(settings.secretName);
    if (apiKey === undefined) throw new Error("Selected provider API key is not configured");
    const response = await runtime.request(
      {
        method: "runtime.run.start",
        params: {
          ...request,
          ...selection,
          mode: request.mode,
          apiKey,
        },
      },
      desktopConfig.runtime.runRequestTimeoutMs,
    );
    if (!response.ok) throw new Error(response.error.message);
    return desktopConversationStartResultSchema.parse(response.result);
  });
  ipcMain.handle(desktopConfig.ipcChannels.conversationCancel, async (event, input: unknown) => {
    assertAuthorizedRenderer(event);
    if (runtime === undefined) throw new Error("Runtime is not connected");
    const request = desktopConversationCancelRequestSchema.parse(input);
    const response = await runtime.request({ method: "runtime.run.cancel", params: request });
    if (!response.ok) throw new Error(response.error.message);
    return response.result;
  });
  ipcMain.handle(desktopConfig.ipcChannels.knowledgeList, async (event) => {
    assertAuthorizedRenderer(event);
    return await requestKnowledgeState();
  });
  ipcMain.handle(desktopConfig.ipcChannels.knowledgeAddFiles, async (event) => {
    assertAuthorizedRenderer(event);
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (owner === null) throw new Error("添加文件需要一个可用的桌面窗口");
    const before = await requestKnowledgeState();
    const selection = await dialog.showOpenDialog(owner, {
      title: "添加知识库文件",
      buttonLabel: "添加到知识库",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "支持的文档",
          extensions: before.acceptedExtensions.map((extension) => extension.slice(1)),
        },
      ],
    });
    if (selection.canceled) {
      return desktopKnowledgeAddFilesResultSchema.parse({
        cancelled: true,
        imported: [],
        failures: [],
        state: before,
      });
    }
    if (selection.filePaths.length > desktopConfig.knowledge.maximumFilesPerImport) {
      throw new Error("选择的文件数量超过单次导入上限");
    }
    const imported = [];
    const failures: { fileName: string; message: string }[] = [];
    for (const filePath of selection.filePaths) {
      try {
        if (runtime === undefined) throw new Error("运行时未连接");
        const response = await runtime.request({
          method: "runtime.kb.add_file",
          params: { path: filePath },
        });
        if (!response.ok) {
          throw new Error("文件无法入库，请确认格式受支持、内容可读取且未超过资源限制");
        }
        imported.push(knowledgeIngestedFileSchema.parse(response.result));
      } catch (error) {
        const message = error instanceof Error ? error.message : "文件入库失败";
        failures.push({
          fileName: basename(filePath),
          message: message.slice(0, desktopConfig.knowledge.maximumFailureMessageCharacters),
        });
      }
    }
    return desktopKnowledgeAddFilesResultSchema.parse({
      cancelled: false,
      imported,
      failures,
      state: await requestKnowledgeState(),
    });
  });
  ipcMain.handle(desktopConfig.ipcChannels.knowledgeRemove, async (event, input: unknown) => {
    assertAuthorizedRenderer(event);
    if (runtime === undefined) throw new Error("运行时未连接");
    const request = desktopKnowledgeRemoveRequestSchema.parse(input);
    const response = await runtime.request({ method: "runtime.kb.remove", params: request });
    if (!response.ok) throw new Error("无法移除知识库来源");
    return desktopKnowledgeStateResultSchema.parse(response.result.state);
  });
  ipcMain.handle(desktopConfig.ipcChannels.approvalResolve, async (event, input: unknown) => {
    assertAuthorizedRenderer(event);
    if (runtime === undefined) throw new Error("运行时未连接");
    const request = desktopApprovalResolveRequestSchema.parse(input);
    const response = await runtime.request({
      method: "runtime.approval.resolve",
      params: request,
    });
    if (!response.ok) throw new Error("该审批已失效或不属于当前运行");
    return desktopApprovalResolveResultSchema.parse(response.result);
  });
}

function runtimeWorkingDirectory(): string {
  return join(app.getPath("userData"), desktopConfig.runtime.workingDirectoryName);
}

async function handleRuntimeHostRequest(request: RuntimeHostRequest) {
  const service = browserService;
  if (service === undefined) throw new Error("Browser service is not available");
  if (request.method === "browser.state") return jsonValueSchema.parse(service.state());
  if (request.method === "browser.cancel") {
    return jsonValueSchema.parse({ cancelled: service.cancel(request.params) });
  }
  return jsonValueSchema.parse(await service.dispatch(request.params));
}

async function requestKnowledgeState() {
  if (runtime === undefined) throw new Error("运行时未连接");
  const response = await runtime.request({ method: "runtime.kb.state", params: {} });
  if (!response.ok) throw new Error("无法读取知识库状态");
  return desktopKnowledgeStateResultSchema.parse(response.result);
}

function assertAuthorizedRenderer(event: IpcMainInvokeEvent): void {
  if (authorizedWebContentsId === undefined || event.sender.id !== authorizedWebContentsId) {
    throw new Error("Desktop IPC request came from an unauthorized renderer");
  }
}

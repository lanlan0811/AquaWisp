import { app, BrowserWindow, type BrowserWindow as BrowserWindowType } from "electron";

import { createDesktopMarkup, desktopStyles } from "./renderer/ui.js";

function createWindow(): BrowserWindowType {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#ffffff",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const document = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>沧渡 AquaWisp</title><style>${desktopStyles}</style></head><body>${createDesktopMarkup({ mode: "work", workspaceName: "本地工作区", modelName: "GLM-5.3", running: false })}</body></html>`;
  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(document)}`);
  return window;
}

void app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

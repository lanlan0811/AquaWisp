"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const channels = Object.freeze({
  runtimePing: "aquawisp:runtime:ping",
  secretSet: "aquawisp:secret:set",
  secretHas: "aquawisp:secret:has",
  secretDelete: "aquawisp:secret:delete",
});
contextBridge.exposeInMainWorld(
  "aquawisp",
  Object.freeze({
    runtimePing: () => ipcRenderer.invoke(channels.runtimePing),
    secrets: Object.freeze({
      set: (name, value) => ipcRenderer.invoke(channels.secretSet, { name, value }),
      has: (name) => ipcRenderer.invoke(channels.secretHas, { name }),
      delete: (name) => ipcRenderer.invoke(channels.secretDelete, { name }),
    }),
  }),
);

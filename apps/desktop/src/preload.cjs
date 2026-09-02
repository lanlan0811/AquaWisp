"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const channels = Object.freeze({
  runtimePing: "aquawisp:runtime:ping",
  secretSet: "aquawisp:secret:set",
  secretHas: "aquawisp:secret:has",
  secretDelete: "aquawisp:secret:delete",
  settingsGet: "aquawisp:settings:get",
  settingsSet: "aquawisp:settings:set",
  conversationStart: "aquawisp:conversation:start",
  conversationCancel: "aquawisp:conversation:cancel",
  conversationEvent: "aquawisp:conversation:event",
  knowledgeList: "aquawisp:knowledge:list",
  knowledgeAddFiles: "aquawisp:knowledge:add-files",
  knowledgeRemove: "aquawisp:knowledge:remove",
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

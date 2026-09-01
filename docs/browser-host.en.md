# Visible browser host

The AquaWisp M6 browser baseline uses an Electron `<webview>` for user-visible pages while Electron main owns the tab registry and CDP sessions. The renderer receives no Node.js, file-system, or Electron-main authority.

The current security baseline:

- the initial page is fixed to `about:blank`, and navigation allows `http:` and `https:` only;
- `will-attach-webview` reasserts `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`, and removes an external preload;
- both the primary window and guests deny `window.open`, while every guest navigation is protocol-checked again;
- each guest is registered once and attaches the configured CDP 1.3 session;
- guest destruction removes its tab, and application shutdown detaches surviving debugger sessions; and
- the initial URL, protocols, and CDP version come from `packages/browser/src/browser-policy.data.json`.

The right browser panel follows the AquaWisp design system with a 280px width, Chinese-first label, and SVG icon. The packaged-app check requires the primary renderer, webview renderer, and independent runtime to remain alive together.

## Current boundary

This change establishes the visible webview and safe tab/CDP lifecycle. The runtime side already has a request-deduplicating, cancellable command bridge. Remaining M6 work must connect the full command surface, ref snapshots, screenshots, downloads, dialogs, recording, and one-click knowledge ingestion to a main-process executor. Web content and CDP observations remain untrusted data.

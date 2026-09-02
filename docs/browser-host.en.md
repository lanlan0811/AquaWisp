# Visible browser host

The AquaWisp M6 browser baseline uses an Electron `<webview>` for user-visible pages while Electron main owns the tab registry and CDP sessions. The renderer receives no Node.js, file-system, or Electron-main authority.

The current security baseline:

- the initial page is fixed to `about:blank`, and navigation allows `http:` and `https:` only;
- `will-attach-webview` reasserts `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`, and removes an external preload;
- both the primary window and guests deny `window.open`, while every guest navigation is protocol-checked again;
- each guest is registered once and attaches the configured CDP 1.3 session;
- guest destruction removes its tab, and application shutdown detaches surviving debugger sessions; and
- every command request carries the active backend generation; the bridge validates its strict schema, rejects stale generations and conflicting request-ID replays, and enforces observable timeout and cancellation; and
- `BrowserCommandEngine` implements navigation, waits, state, bounded page evaluation, keyboard/form interaction, and page/element screenshots; snapshots carry `tag/role/name/text/ref/selector/xpath/rect/framePath`, and navigation immediately invalidates refs; and
- runtime and Electron main use a dedicated bidirectional host-RPC envelope: runtime emits `browser.execute/browser.cancel`, desktop returns either a successful value or structured error, and both sides enforce request IDs, timeouts, and line-size limits; and
- the initial URL, protocols, and CDP version come from `packages/browser/src/browser-policy.data.json`.

The right browser panel follows the AquaWisp design system with a 280px width, Chinese-first label, and SVG icon. The packaged-app check requires the primary renderer, webview renderer, and independent runtime to remain alive together.

## Current boundary

The visible webview, safe tab/CDP lifecycle, reliable command bridge, and Electron-independent command executor are in place. Screenshot persistence, tab lifecycle, downloads, dialogs, and recording are injected through a constrained host interface; the next step is to connect those adapters to Electron main and complete one-click knowledge ingestion. All web content and CDP observations remain untrusted and undergo structural and size validation.

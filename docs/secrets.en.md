# Secret storage and IPC boundary

AquaWisp keeps provider API keys in the Electron main process. `SecretVault` uses Electron `safeStorage`, backed by Windows DPAPI or macOS Keychain facilities, and writes an encrypted registry to the application's user-data directory. Plaintext is never written to the workspace, SQLite, logs, or the Git repository.

The sandbox preload gives the renderer a narrow API that can only:

- store a named secret;
- check whether a named secret exists;
- delete a named secret; and
- check whether the independent runtime is connected.

The renderer has no read or decrypt method. Electron main schema-validates every IPC payload and requires the sender to be the current primary window's `webContents`. IPC channels, ciphertext limits, secret limits, and the storage filename come from `apps/desktop/src/desktop-config.data.json`.

The preload source is generated deterministically from that same configuration. `npm run preload` updates it, `npm run preload:check` detects drift, and the desktop build copies it to `dist` only after the check passes. The window keeps `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false`, and denies new windows and page navigation.

When a model Run starts, Electron main decrypts only the single provider key referenced by the active settings and passes it in one schema-bound request over the private stdio channel. The renderer never sees plaintext. Runtime uses it only to construct an in-memory model client and never writes it to events, SQLite, responses, or logs. Runtime never receives the entire secret registry or keeps a permanent plaintext copy.

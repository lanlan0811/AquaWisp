# Desktop settings and secret boundary

The desktop app separates ordinary configuration from secrets.

`DesktopSettingsStore` persists only provider ID, model ID, OpenAI-compatible protocol, default reasoning level, secret reference name, and execution mode. Before writing, it validates provider/model ownership, protocol support, and reasoning level against the built-in model catalog; aliases are normalized to canonical levels. The file is atomically replaced through a same-directory temporary file and receives owner-only permissions on macOS. Defaults come from schema-validated `desktop-config.data.json`.

An API key still goes only to `SecretVault` and Electron `safeStorage`; it never appears in `settings.json`. The sandbox preload exposes only `secrets.set/has/delete`, with no `get` or `decrypt`. After saving a key, the settings view clears the password field and renders only presence status.

The settings view links provider, model, protocol, and reasoning-level choices from the model catalog. Execution mode uses the Chinese-first design-system labels for plan, work, and full access. A fresh per-window nonce authorizes the renderer script, while CSP rejects inline scripts without that nonce.

This settings revision covers built-in providers. Custom OpenAI-compatible provider URLs and model forms will use their own strict schema when connected to the conversation path; they must not be inserted as unvalidated fields.

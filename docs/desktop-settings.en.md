# Desktop settings and secret boundary

The desktop app separates ordinary configuration from secrets.

`DesktopSettingsStore` persists only provider ID, model ID, OpenAI-compatible protocol, default reasoning level, secret reference name, and default execution mode. Before writing, it validates provider/model ownership, protocol support, and reasoning level against the built-in model catalog; aliases are normalized to canonical levels. The file is atomically replaced through a same-directory temporary file and receives owner-only permissions on macOS. Defaults come from schema-validated `desktop-config.data.json`.

An API key still goes only to `SecretVault` and Electron `safeStorage`; it never appears in `settings.json`. The sandbox preload exposes only `secrets.set/has/delete`, with no `get` or `decrypt`. After saving a key, the settings view clears the password field and renders only presence status.

The settings view links provider, model, protocol, and reasoning-level choices from the model catalog. Only Plan and Work can be persisted as defaults. Full Access can be enabled temporarily only from the conversation input card after a high-risk confirmation; both the contract and storage boundary reject it as a saved default. A fresh per-window nonce authorizes the renderer script, while CSP rejects inline scripts without that nonce.

The conversation input card can temporarily switch models and reasoning levels within the configured provider/protocol without overwriting those defaults. Saving a new provider or protocol rebuilds the session choices from the validated catalog so stale models cannot remain selectable.

If an earlier build persisted `full_access`, loading safely downgrades that legacy value to the configured default. This preserves startup compatibility without silently retaining elevated access.

This settings revision covers built-in providers. Custom OpenAI-compatible provider URLs and model forms will use their own strict schema when connected to the conversation path; they must not be inserted as unvalidated fields.

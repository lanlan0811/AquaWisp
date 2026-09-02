# AquaWisp Architecture

This document records the public architecture of AquaWisp `0.1.0`. The implementation follows the milestone order in [ROADMAP.md](ROADMAP.md); sections describing later milestones are target architecture until their milestone is complete.

## Design goals

- Keep authoritative run state outside the desktop renderer.
- Make every side effect controllable, recoverable, verifiable, and auditable.
- Keep provider, tool, path, policy, and UI behavior configuration-driven.
- Treat Windows 10+ and macOS as equal targets.
- Preserve a local-first, single-workspace data boundary.

## Process model

```text
Electron desktop (apps/desktop)
  renderer: conversation, knowledge base, browser supervision, approvals, settings
  preload: narrow, versioned IPC surface
  main: windows, safeStorage, browser host, runtime supervision
                         │ local IPC / stdio
                         ▼
Independent runtime (packages/runtime)
  state machine, ledger, authorization, tools, skills, knowledge base,
  context management, event store, checkpoints
```

The renderer never accesses the file system, model providers, secrets, or child processes directly. The preload surface validates messages against `packages/contracts`. The runtime owns Run state, so a desktop crash cannot silently rewrite the execution history. Production file tools are rooted in a configured workspace subdirectory separate from event/knowledge databases and context artifacts, preventing a model action from treating authoritative runtime state as an ordinary file.

The implemented M5 process baseline starts `packages/runtime/dist/process-host.js` as a separate process with `shell: false`. Packaged Electron sets its configured Node-mode environment flag, passes only allowlisted environment variables, and exchanges newline-delimited V1 RPC envelopes. Every request is correlated, schema validated, size limited, timed out, and explicitly shut down. Run requests stream committed lifecycle events back to the authorized renderer and accept concurrent cancellation or exact-ID approval decisions backed by the Run's `AbortSignal`. Approval waits remain inside runtime; resolution is committed before dispatch, while exact session grants are process-local and fail closed on restart. Knowledge-management requests keep file extraction and SQLite access in runtime; Electron main only brokers the operating-system file picker, while renderer receives validated source summaries. The desktop package depends on the runtime package only so the packager includes and resolves this executable entry; main does not import runtime state-machine implementation into the Electron process.

## Agent lifecycle

Every turn is modeled as six explicit stages:

1. `prepare` loads workspace state, skills, knowledge-base summary, browser context, and unfinished actions.
2. `reason` asks the selected model for the next action or a final answer.
3. `authorize` evaluates mode, policy, risk, workspace boundaries, and session approvals.
4. `execute` dispatches only authorized actions.
5. `observe` records structured, untrusted tool results.
6. `verify` independently checks whether the expected effect occurred.

Side-effect actions advance through `planned → authorized → dispatched → observed → verified`. A dispatched action without a reliable result becomes `unknown`; recovery reconciles its actual state before any retry.

The production `prepare` stage reconstructs user, assistant, and tool-observation items from the session event timeline, loads the hash-verified prompt bundle, records normalized reasoning state, applies configured token-budget compaction, and saves a content-addressed checkpoint. The model port receives those structured items rather than a flattened untrusted string. It derives protocol-native tool declarations from the validated registry, assembles exactly one function call per reason cycle, and returns bounded, explicitly untrusted observations to the next cycle. Interrupted text streams use a bounded continuation request, while partially emitted tool calls fail closed instead of risking duplicate side effects.

The M1 implementation and event catalog are documented in [docs/runtime-v1.md](docs/runtime-v1.md).

## Packages and dependency direction

| Package          | Responsibility                                              | Intended dependencies                                        |
| ---------------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| `contracts`      | Versioned schemas and shared protocol types                 | schema library only                                          |
| `models-catalog` | Provider and model capability data                          | `contracts`                                                  |
| `model`          | Streaming protocol clients and reasoning normalization      | `contracts`, `models-catalog`                                |
| `context`        | Token budgets, compaction, checkpoints                      | `contracts`, `model` abstractions                            |
| `kb`             | SQLite FTS5/sqlite-vec storage, ingestion, hybrid retrieval | `contracts`                                                  |
| `tools`          | Sandboxed tools and verification adapters                   | `contracts`, `kb`                                            |
| `browser`        | Runtime-side browser command bridge                         | `contracts`                                                  |
| `skills`         | Progressive `SKILL.md` discovery and loading                | `contracts`, `tools` execution interface                     |
| `runtime`        | Orchestration and authoritative state                       | all runtime packages through public interfaces               |
| `desktop`        | Electron UI and host adapters                               | `contracts`; runtime executable as packaged process resource |

Cross-package imports use package public exports. Runtime code must not import renderer code. Renderer code must not import Node file-system, process-control, or network modules. The automated architecture check begins enforcing these boundaries in M0 and grows with each milestone.

## Persistence and secrets

Workspace-local state lives under `.aqua/`, which is ignored by Git. The event store and knowledge base use SQLite WAL mode. Model API keys are encrypted by Electron `safeStorage` using Windows DPAPI or macOS Keychain and stored only as ciphertext in the application user-data directory. The sandbox renderer can save, check, or delete a named secret but has no read/decrypt capability. See [docs/secrets.md](docs/secrets.md).

## Configuration

Bootstrap paths, workspace packages, prompt sources, policy tables, model capabilities, command surfaces, and UI registries are configuration data rather than scattered constants. New registries must be documented in [docs/config-registry.md](docs/config-registry.md) and validated at load time.

## UI boundary

The desktop UI follows the AquaWisp design system: Chinese-first copy, tokenized light/dark themes, system font fallbacks, SVG-only icons, reduced-motion support, and ledger states communicated by icon plus text rather than color alone. UI implementation begins at M5, after the runtime and knowledge-base contracts stabilize.

The M6 browser baseline adds a visible 280px webview panel. Electron main reasserts sandbox preferences during `will-attach-webview`, rejects non-HTTP(S) navigation and new windows, and owns one configured CDP session per registered guest. See [docs/browser-host.md](docs/browser-host.md).

## Verification layers

- Prompt resource hash and drift check
- Strict TypeScript project references
- ESLint and formatting checks
- Unit and integration tests through Vitest
- Architecture registry and boundary checks
- Cross-platform build-and-smoke jobs on Windows and macOS
- Later milestones add deterministic run replay, recorded provider streams, knowledge retrieval evals, and packaged-app checks

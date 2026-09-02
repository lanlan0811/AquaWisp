# Configuration Registry

AquaWisp avoids scattered behavior constants. Values that vary by package, platform, model, provider, policy, tool, skill, or UI component belong in validated configuration data and are referenced through a single loader.

## Current registries

| Registry                                          | Owner                      | Purpose                                                                                    | Validation                                                           |
| ------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `config/project.json`                             | repository tooling         | Workspace packages, prompt sources, architecture source roots, renderer forbidden imports  | JSON schema plus architecture and unit checks                        |
| `docs/prompts/*.md`                               | runtime prompts            | Chinese system instruction sources                                                         | deterministic compiler, per-file SHA-256, aggregate drift check      |
| `packages/runtime/resources/prompts/bundle.json`  | generated runtime resource | Versioned prompt contents consumed by the packaged runtime                                 | generated only by `npm run prompts`                                  |
| `packages/contracts/src/*.ts`                     | protocol contracts         | Versioned Run, action, approval, model-signal and event schemas                            | zod parsing at every persistence and adapter boundary                |
| `packages/models-catalog/src/catalog.data.json`   | model catalog              | Provider endpoints, model capabilities, protocols, reasoning levels and request patches    | zod cross-reference and protocol validation at module load           |
| `packages/tools/src/tool-catalog.data.json`       | tool runtime               | Canonical/model names, descriptions, input schemas, versions, risks, modes and policy data | zod/Ajv validation plus declaration and policy-order tests           |
| `packages/tools/src/mcp-registry.data.json`       | MCP client                 | Stdio server declarations, environment references, exact tool allowlists and size limits   | zod schema plus real stdio integration tests                         |
| `packages/browser/src/browser-policy.data.json`   | browser host               | Initial page, URL protocol allowlist and pinned CDP protocol version                       | zod schema plus webview/tab lifecycle regression tests               |
| `packages/browser/src/browser-commands.data.json` | browser runtime            | Complete M6 command names and per-field request limits                                     | catalog/schema parity plus invalid-shape regression tests            |
| `packages/kb/src/ingestion-formats.data.json`     | knowledge-base ingestion   | File extensions, MIME types, extraction formats and decompression/output resource limits   | zod uniqueness checks plus real-format and damaged-input tests       |
| `packages/kb/src/kb-config.data.json`             | knowledge-base runtime     | Chunking, embedding transport, hybrid ranking, candidate and highlight limits              | zod cross-field validation plus indexing/retrieval tests             |
| `evals/knowledge-retrieval-baseline.json`         | knowledge retrieval evals  | Versioned Chinese corpus, Recall@3 cases and acceptance threshold                          | zod schema plus hybrid retrieval quality test                        |
| `apps/desktop/src/desktop-config.data.json`       | Electron main/preload      | Window, runtime, settings defaults, environment, secret/import limits and IPC channels     | zod schema, preload drift check and packaged-process tests           |
| `packages/runtime/src/runtime-host.data.json`     | independent runtime host   | SQLite names, cycle/recovery, context and aggregate tool resource limits                   | zod schema plus runtime, tool, knowledge, recovery and context tests |
| `vitest.config.ts`                                | repository tooling         | Cross-platform test scheduling and timeout budget                                          | full verification on Windows and macOS CI                            |

`scripts/project-config.mjs` contains the sole bootstrap path to `config/project.json`; this path cannot be stored inside the registry it is used to locate. All downstream tooling resolves paths from the repository root and rejects escapes.

## Planned registries

| Milestone | Registry                                                                                                  |
| --------- | --------------------------------------------------------------------------------------------------------- |
| M2        | Provider/model capabilities, protocols, reasoning levels and request patches in `packages/models-catalog` |
| M3        | Tool declarations, workspace policies, risk levels and cross-platform terminal adapters                   |
| M5        | Themes, localized copy, SVG icon index and desktop navigation                                             |
| M6        | Browser commands, protocol allowlist, download and recording policy                                       |
| M7        | Built-in skill manifest and environment dependency adapters                                               |

## Adding a registry

1. Define ownership and a versioned schema.
2. Reject unknown or invalid values at the boundary; do not silently guess security-sensitive defaults.
3. Resolve filesystem paths against an explicit root and verify the resulting real path.
4. Add unit tests for valid, invalid, and platform-specific cases.
5. Document the data source and migration behavior here.

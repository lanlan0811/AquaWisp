# AquaWisp Roadmap

The roadmap targets the first complete desktop release, `0.1.0`. Milestones are implemented in order because each one establishes contracts used by the next.

| Milestone | Scope                                                                                             | Status   |
| --------- | ------------------------------------------------------------------------------------------------- | -------- |
| M0        | Monorepo foundation, strict verification, prompt compiler, CI, open-source docs                   | Complete |
| M1        | V1 contracts, six-stage runtime, action ledger, SQLite event store, deterministic replay          | Complete |
| M2        | OpenAI-compatible dual-protocol model client, model catalog, reasoning effort, context compaction | Planned  |
| M3        | File, terminal and web tools; policy evaluation; cross-platform command execution                 | Planned  |
| M4        | SQLite knowledge base, ingestion, Chinese FTS, vector search, RRF hybrid retrieval                | Complete |
| M5        | Electron shell, conversation and knowledge UI, approvals, modes, settings                         | Planned  |
| M6        | Visible embedded browser, CDP command engine, capture and knowledge ingestion                     | Planned  |
| M7        | Progressive skill loader and built-in docx, xlsx, pptx, pdf, browser-use skills                   | Planned  |
| M8        | stdio MCP client, 20–50 scenario eval set, interruption and recovery hardening                    | Planned  |
| M9        | Windows NSIS and macOS DMG packaging, documentation, `0.1.0` release                              | Planned  |

## Release acceptance

The `0.1.0` release is complete only when a clean Windows and macOS installation can configure a provider key, collect or add material, retrieve it with source attribution, approve an audited action, and create an office artifact. CI and smoke checks must pass on both platforms, and the changelog and user documentation must describe the shipped behavior rather than planned behavior.

Statuses are updated only after the milestone acceptance checks pass.

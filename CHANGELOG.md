# Changelog

All notable changes to AquaWisp are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- M0 npm-workspaces monorepo skeleton for the desktop app and runtime packages.
- Strict TypeScript, ESLint, Prettier, Vitest, architecture, and smoke verification commands.
- Chinese built-in Agent prompts with deterministic SHA-256 resource compilation and drift checking.
- Windows and macOS GitHub Actions verification matrix.
- Public architecture, roadmap, contribution, security, and bilingual project documentation.
- V1 zod contracts for Run lifecycle, streaming events, model decisions, actions, approvals, observations, and verification.
- Six-stage runtime engine with configurable ports, cycle limits, cancellation, and approval pauses.
- SQLite WAL event store with atomic action-ledger transitions and deterministic timeline reconstruction.
- Deterministic model, policy, executor, verifier, clock, and ID generator for offline end-to-end replay tests.
- Runtime smoke coverage for completed Runs, verified actions, `unknown` dispatch results, approval waits, cancellation, and database reopen recovery.
- Configuration-driven M2 model catalog for four providers and nine models, including protocol-specific reasoning patches, aliases, official source metadata, and explicit pending verification markers.
- Immutable reasoning request normalizer with protocol-specific nested set/unset patches, alias resolution, sampling-parameter constraints, and deterministic model revision hashes.
- Native-fetch OpenAI-compatible streaming client with incremental SSE parsing for Chat Completions and Responses, bounded HTTP errors, abort propagation, and explicit incomplete-stream detection.
- Context compiler with configurable token budgets, threshold compression, bounded summaries, full recent-window retention, and artifact references for oversized tool results.
- SHA-256 context checkpoints plus atomically persisted `context.compacted` and `checkpoint.saved` event chains for recovery and auditability.
- Session reasoning-effort registry that persists normalized levels and model revisions, suppresses alias-equivalent duplicate events, and restores state across runtime restart.
- Validated custom-provider connection declaration with an explicit OpenAI-compatible protocol, usable directly by the streaming client without a built-in model lookup.
- Explicit stream-recovery controller that preserves event ordering, never retries a cancelled request, and requires a caller-provided continuation plan after interruption.
- Environment-only live-model probe that exercises the production stream client without persisting API keys.
- Configuration-driven M3 tool registry and fixed-order policy evaluator for mode rules, explicit denials, boundary approvals, and auditable approval requests.
- Workspace filesystem tools with real-root validation, revision-bound writes, exact text edits, and same-directory atomic replacement.
- Cross-platform argv-based terminal executor with workspace-bound cwd, bounded output, and timeout termination.
- Protocol-allowlisted, size-bounded `web_fetch` client that labels remote content as untrusted.

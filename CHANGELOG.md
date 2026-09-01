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

# AquaWisp

A local-first knowledge-base harness agent for Chinese knowledge workers.

![AquaWisp knowledge loop](docs/assets/aquawisp-banner.en-US.svg)

AquaWisp connects research collection, knowledge organization, reliable retrieval, and office-document production in one traceable loop. Its independent runtime, six-stage agent state machine, action ledger, and risk-aware approvals make side effects controllable, recoverable, verifiable, and auditable.

> Status: AquaWisp is under active `0.1.0` development. The M0 repository foundation is in place, but there is no usable desktop release yet. Follow the [roadmap](ROADMAP.md) for progress.

[简体中文](README.md)

## Product direction

```text
Collect (embedded browser / web / local files)
  → Process (docx / xlsx / pptx / pdf)
  → Index (clean / chunk / full-text and vector indexes)
  → Retrieve and produce (source-grounded answers and new documents)
```

- Local-first: knowledge and runtime events live in the workspace without an external database service.
- Transparent safety: `plan`, `work`, and `full_access` modes use policy evaluation and a complete action ledger.
- Chinese-first: built-in Chinese system prompts and plain-language approval explanations.
- Cross-platform: Windows 10+ and macOS are first-class targets.
- Provider-friendly: OpenAI-compatible Chat Completions and Responses protocols without a single-vendor lock-in.
- Closed knowledge loop: collection, retrieval, and office output share the same runtime context.

## Architecture

The Electron desktop app owns the conversation, knowledge-base, approval, and visible browser UI. An independent runtime process owns authoritative state and runs the `prepare → reason → authorize → execute → observe → verify` loop. They communicate only through versioned contracts. See [ARCHITECTURE.md](ARCHITECTURE.md).

## Development

Prerequisites:

- Node.js 24 LTS
- npm 11 or newer
- PowerShell on Windows 10+, or zsh on macOS

```powershell
git clone https://github.com/lanlan0811/AquaWisp.git
cd AquaWisp
npm ci
npm run verify
npm run smoke
```

`npm run verify` checks the prompt bundle, strict TypeScript, lint rules, tests, architecture boundaries, and formatting. `npm run smoke` builds and imports every workspace entry point.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md). AquaWisp is licensed under the [MIT License](LICENSE).

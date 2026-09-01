# Contributing to AquaWisp

Thank you for helping build AquaWisp. The project values evidence-backed changes, explicit security boundaries, and equal Windows/macOS behavior.

## Before starting

1. Check [ROADMAP.md](ROADMAP.md) and keep work within the current milestone.
2. Open an issue for architectural changes, new external dependencies, protocol changes, or security-policy changes.
3. Confirm that code and assets have a license compatible with MIT. Reference implementations may be studied, but proprietary code and prompts must not be copied.

## Development setup

Use Node.js 24 LTS and npm 11 or newer.

```powershell
npm ci
npm run verify
npm run smoke
```

## Change requirements

- Use TypeScript strict mode and public package boundaries.
- Put runtime behavior in configuration or validated registries when it can vary by platform, provider, model, policy, tool, or UI component.
- Keep Windows 10+ and macOS behavior equivalent; use platform adapters rather than shell-string branching.
- Put built-in Agent prompts under `docs/prompts` and run `npm run prompts` after editing them.
- Keep renderer access behind preload IPC; never expose unrestricted Node APIs.
- Use SVG for icons and licensed visual assets. Do not use emoji as UI icons.
- Add or update tests for behavior changes, including failure and recovery paths.
- Update public documentation when the actual user-facing behavior changes.
- Do not commit `.env`, `.aqua/`, API keys, local design sources, research references, generated build output, or ignored workspace data.

## Commit and review checklist

- `npm run verify` passes.
- `npm run smoke` passes when package entry points or build configuration changed.
- Security and data-flow implications are described.
- Cross-platform behavior is tested or the remaining platform check is stated clearly.
- The changelog contains a concise entry for user-visible behavior.

By contributing, you agree that your contribution is licensed under the repository's MIT License.

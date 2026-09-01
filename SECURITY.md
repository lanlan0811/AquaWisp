# Security Policy

## Supported versions

AquaWisp has not yet published a stable release. Security fixes are applied to the current `master` development line. This policy will be updated when versioned releases are available.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting feature for `lanlan0811/AquaWisp`. If that channel is unavailable, contact the repository owner through a private channel listed on the owner's GitHub profile.

Include:

- the affected commit or version and operating system;
- a minimal reproduction that does not contain real secrets or personal data;
- the expected and actual security boundary;
- likely impact and any known workaround.

You should receive an acknowledgement within seven days. Please allow reasonable time for validation and a coordinated fix before public disclosure.

## Security boundaries

The project treats model output, webpages, tool output, imported documents, knowledge-base content, and MCP responses as untrusted. Important boundaries include:

- Electron renderer isolation and a narrow preload IPC surface;
- workspace real-path validation, including symlinks and Windows reparse points;
- policy evaluation before side effects and an auditable action ledger;
- reconciliation of `unknown` dispatched actions before retry;
- encrypted provider keys through Electron `safeStorage`;
- protocol and size limits for network collection;
- disabled telemetry by default.

Never include API keys, cookies, private documents, `.aqua/` databases, or unredacted event logs in a report.

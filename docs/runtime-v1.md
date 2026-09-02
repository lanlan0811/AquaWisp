# Runtime V1 Contracts and Replay

M1 establishes the smallest complete AquaWisp harness loop without requiring a real model or tool. It is deliberately adapter-driven so M2 and M3 can add providers and operating-system actions without moving control into the model.

## Lifecycle

`RunEngine` owns the loop and accepts injected model, policy, executor, verifier, clock, ID generator, and event-store ports. A Run starts at `created`, enters `running`, and may finish as `completed`, `failed`, or `cancelled`, or pause as `waiting_approval`.

For each action, the runtime enters:

```text
prepare → reason → authorize → execute → observe → verify
             ↑                                      │
             └──────────────────────────────────────┘
```

Final model output enters `verify` before the Run can complete. The configured `maxCycles` is a harness-level circuit breaker; the model cannot increase it.

## Action ledger

Actions begin at `planned` and move by compare-and-set transitions:

```text
planned → authorized → dispatched → observed → verified
                              └────→ unknown
```

The action row update and matching event append share one SQLite transaction. An executor exception after dispatch records `unknown`, fails the current M1 Run, and does not retry. Tool-specific reconciliation and resume from `unknown` are added with the M3 tool adapters.

## Events

Every event has an ID, Run ID, per-Run sequence, ISO timestamp, trace ID, parent event ID, discriminated type, and zod-validated payload. Current event families cover:

- Run creation, stage entry, completion, failure, and cancellation;
- model text deltas and structured decisions;
- per-session reasoning-effort changes, including normalized model revision and previous state;
- action planning, authorization, dispatch, observation, verification, and unknown state;
- structured approval requests.

The event callback receives only committed events. Observer failures cannot roll back the authoritative SQLite transaction.

## Session reasoning state

`SessionReasoningRegistry` resolves a selected effort through the model catalog before persisting `session.reasoning_effort.updated`. The event records the requested and canonical levels, protocol, provider/model identity, SHA-256 model revision, and the preceding state. Equivalent aliases do not create a duplicate event. A new registry instance restores the most recent state by querying all Runs in the session, so the choice survives runtime restart.

## Persistence and replay

`SqliteEventStore` uses Node.js 24's cross-platform `node:sqlite` runtime, `WAL` journaling, `FULL` synchronous writes, foreign keys, strict tables, and schema `user_version = 1`. It stores current Run/action projections alongside the append-only event timeline.

`rebuildRun(runId)` folds the timeline into a Run and action map. Tests close and reopen a database whose path contains spaces and Chinese characters, then require the rebuilt terminal state and event list to match the state observed before close.

## Deterministic harness

The M1 simulation adapters provide scripted model signals, monotonic timestamps, stable IDs, an allow-only test policy, an echo executor, and evidence-based verification. `npm run smoke` builds every package and runs a two-turn scenario:

1. the model proposes `simulation.echo`;
2. the action reaches `verified`;
3. the model streams two text deltas and a final decision;
4. final verification completes the Run;
5. the event timeline is rebuilt and compared with the stored terminal state.

These adapters are test infrastructure, not a security policy or production tool implementation.

## Desktop process boundary

M5 adds a strict V1 JSONL RPC envelope in `packages/contracts` plus a stdio process host. Electron main supervises that process, verifies `runtime.ping` before reporting a connected state, and sends `runtime.shutdown` before application exit. Request correlation, protocol version, response size, stderr size, timeout, and inherited environment names are bounded outside the model's control.

`runtime.run.start` selects a catalog-validated OpenAI-compatible model, prepares hash-verified system prompts and persisted session context, then streams committed `RunEvent` envelopes before returning the terminal Run. Provider-stream continuations emit `model.stream.recovery`. `runtime.run.cancel` is handled concurrently, aborts only the matching active Run, and lets `RunEngine` persist `run.cancelled`. Only one Run may be active in this v1 host. Ping remains available during execution; shutdown aborts and awaits an active Run before closing the event store. Approval resumption will extend this same discriminated contract.

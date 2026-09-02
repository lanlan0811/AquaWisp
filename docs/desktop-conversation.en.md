# Desktop streaming conversations

The conversation view starts and stops Runs through the narrow sandbox-preload surface. Renderer can submit only a `sessionId` and user text. Electron main obtains provider, model, protocol, reasoning level, and API key from validated settings and operating-system-encrypted storage.

Main converts the request into a versioned `runtime.run.start` JSONL message. The independent runtime validates provider/model ownership, protocol, and reasoning level against the model catalog, then calls the production OpenAI-compatible streaming client. Every committed `model.delta`, `run.completed`, `run.failed`, or `run.cancelled` event returns under the same request ID. Renderer appends model text with `textContent`; it never interprets model output as HTML.

While a Run is active, the send control changes to the design system's SVG stop icon. After `run.created`, the user can send a cancellation request containing the exact Run ID. Runtime aborts only that active Run, propagates its `AbortSignal` to the network stream, and then persists the terminal state in SQLite. Cancellation and the long-running start request are processed concurrently, so the model call cannot block the stop command.

Ordinary RPC calls retain a short timeout, while model Runs use the separate long timeout in `desktop-config.data.json`. The v1 runtime executes one Run at a time to keep event ownership unambiguous. The `prepare` stage now restores same-session history from the event store and compiles it under the configured budget. Knowledge source management and approval resumption now cross the independent runtime boundary; in-conversation retrieval cards and the production tool executor remain later M5/M3 work and must continue through the same event and policy contracts.

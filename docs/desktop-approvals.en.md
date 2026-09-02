# Desktop approvals and session grants

When the trusted runtime policy returns `requires_approval`, `RunEngine` commits the complete `approval.required` request before notifying desktop through the committed event stream. The Run remains active and paused in authorize. Silence, closing UI, and page content cannot create authorization.

The dialog renders only the contracted action type, target, risk reason, and impact, all through `textContent`. Renderer can submit only the approval ID, Run ID, an `approve`/`deny` choice, and the session-grant boolean. It cannot alter action parameters or risk fields. Runtime accepts only an exact currently pending Run/approval pair; stale, duplicate, and mismatched decisions fail closed.

Before dispatching an action, runtime:

1. atomically appends `approval.resolved` to the event timeline;
2. records `action.authorized` for approval before entering execute;
3. records `action.denied` and terminates with `user_denied_approval` on denial, without dispatch.

“Always allow the same operation, target, and impact in this session” applies only to the current `sessionId`. Its exact match key includes action type, target, risk reason, and impact. A grant enters memory only after `approval.resolved` persists successfully. Runtime restart clears it, and any session or scope-field change requires approval again. A denial can never become an allow grant, and there is no permanent-allow option.

The stop control remains active while approval is pending. Cancellation releases the waiter and commits `run.cancelled`. The production model adapter now derives Chat Completions or Responses function declarations from the tool registry. Boundary actions such as terminal execution or importing a knowledge source outside the workspace therefore enter this approval path. Approval never expands a tool's intrinsic capability boundary: workspace filesystem tools still cannot access a path outside their verified real root.

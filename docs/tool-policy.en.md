# Tool registry and policy evaluation

`packages/tools/src/tool-catalog.data.json` is the M3 source of truth for tools and safety policy. It declares canonical IDs, model-safe names, revisions, side effects, risk levels, plain-language descriptions, strict JSON input schemas, mode defaults, boundary-approval scopes, and decision codes. Runtime renders this one registry into native Chat Completions or Responses declarations instead of maintaining a second hard-coded list.

`ToolPolicyEvaluator` uses a fixed order: action contract and registry → explicit deny → project deny → workspace/secret/platform boundary classification → hard mode deny → boundary approval or mode default. A later rule can never override an explicit deny, and a boundary approval cannot bypass `plan` mode's hard deny for medium- or high-risk actions.

`plan` auto-allows only low-risk actions. `work` auto-allows low- and medium-risk actions within the workspace. External, secret, and platform boundaries return structured approval requests containing the action, target, human-readable risk and impact, timestamp, and auditable ID. Desktop resolution must exactly match the pending approval, and a remembered grant is scoped to the same session, operation, target, risk, and impact.

Filesystem tools access only the dedicated workspace subdirectory named by `runtime-host.data.json`, isolated from event/knowledge databases and context artifacts, and validate its verified real root. Reads return a SHA-256 revision; writes and edits must bind that revision and use same-directory atomic replacement. Symlinks or junctions that resolve outside the workspace fail, and approval does not expand this intrinsic capability boundary.

Terminal execution accepts an executable and argument array, starts with `shell: false`, and requires a cwd resolving inside the workspace. Since an arbitrary process crosses the platform boundary, production policy requires exact approval. Output and duration are bounded, and Run cancellation terminates an active child process.

`web.fetch` accepts only configured HTTP(S) protocols, revalidates the final URL, caps response bytes, and always marks content `untrusted: true`. Tool observations return to the next reason cycle only as explicitly untrusted data; they cannot alter registry, policy, or approval state.

`runtime-host.data.json` centralizes limits for model tool arguments, file contents, terminal output, web bodies, and aggregate observations. An oversized aggregate result becomes a structured `truncated` record with original byte count and a bounded preview. Oversized model arguments fail before an action is created, keeping every runtime-to-desktop JSONL event under the host envelope budget.

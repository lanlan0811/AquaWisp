# Desktop action timeline

Each tool action receives an expandable card in the conversation stream. Cards consume only versioned Run events sent by the independent runtime through controlled IPC; model text and web content cannot manufacture ledger state.

An SVG icon, summary, and text badge jointly communicate the six-state `planned → authorized → dispatched → observed → verified` ledger path. `unknown` uses an orange border and warning icon to identify reconciliation work. A denied authorization appears as a separate "Denied" UI outcome without pretending it is one of the six ledger states.

Expanded cards show action input, authorization decisions, approval request/resolution data, tool observations, verification results, and the accumulated timeline. All data is rendered with `textContent`. `desktop-config.data.json` bounds detail length and an explicit truncation marker is shown. Cards remain complete in `full_access`; relaxed authorization never disables audit visibility.

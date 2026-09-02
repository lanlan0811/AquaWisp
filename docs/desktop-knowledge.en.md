# Desktop knowledge management

The knowledge view manages local sources through the narrow sandbox-preload API. Renderer cannot inspect paths, open arbitrary files, or access SQLite directly. “Add files” first opens the operating-system picker in Electron main, then sends only the paths explicitly selected by the user to the independent runtime as versioned `runtime.kb.add_file` requests.

Runtime reads supported extensions and resource limits from `packages/kb/src/ingestion-formats.data.json`, keeping the picker, extractor, and capability display on one source of truth. Markdown, plain text, HTML, DOCX, PDF, XLSX, and PPTX are supported. Runtime extracts and chunks each file into a separate `kb.sqlite`; Run events remain in `events.sqlite`, so the two data sets can be backed up and recovered independently.

The view shows source and chunk totals, source titles, timestamps, file URIs, and per-source chunk counts. Paths, titles, and failure messages are rendered with `textContent`, never interpreted as HTML. Multi-file imports are bounded by configuration and report each success or failure independently, so one damaged file does not obscure other completed imports.

Removing a source requires an explicit confirmation dialog. It deletes only the local knowledge record and chunk index, never the original file. Renderer redraws from the authoritative state returned by runtime instead of predicting database state.

This interface currently covers source management and full-text chunk indexing. Provider-backed semantic embeddings, in-conversation source cards, and Agent action approvals remain later M5 integration work and will continue through runtime and event contracts.

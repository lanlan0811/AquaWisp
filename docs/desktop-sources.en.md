# Desktop source linking

The conversation's right-side Sources panel is driven by runtime ledger events. Renderer first records the contract-validated action ID and tool name from `action.planned`, then accepts knowledge hits only from a matching `kb.search` `action.observed` event in the same Run. It never infers citations from assistant prose or lets model/web text impersonate a trusted source.

Knowledge results carry chunk and document IDs, title, URI, source type, ordinal, tags, ingestion timestamp, content, and retrieval score. `knowledgeSearchResultSchema` validates this structure at the knowledge boundary before it enters the event stream as an untrusted observation. The panel shows type, title, chunk, and a preview with query matches highlighted by the design system's weak-brand token. Clicking a panel card or the citation attached to an assistant message opens read-only content and metadata details.

Titles, URIs, tags, content, and queries are rendered only through `textContent`, text nodes, and fixed SVG templates. Source data cannot inject HTML, scripts, styles, approvals, or runtime state. Starting a new session clears the local source view, while source data and audit events remain owned by the independent runtime.

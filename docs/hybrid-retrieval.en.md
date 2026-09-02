# Hybrid retrieval and embeddings

`HybridKnowledgeIndex` combines FTS5 candidates from `KnowledgeBase` with semantic candidates from `VectorIndex` using reciprocal-rank fusion. The default mode is `hybrid`; callers can explicitly request `full_text` or `semantic`. Every result includes chunk text, document ID, URI, title, chunk ordinal, matched channels, RRF score, and query-position highlights, allowing the conversation and knowledge views to render a traceable source directly.

Candidate multiplier, RRF constant, channel weights, minimum vector score, highlight size, and final limits are centralized in `packages/kb/src/kb-config.data.json` and validated by a strict schema.
The versioned Chinese retrieval corpus and threshold live in `evals/knowledge-retrieval-baseline.json`; ranking or tokenization changes must continue to meet its Recall@3 baseline.

## Incremental indexing

`add` prepares chunks with the knowledge base's exact chunking settings and completes every embedding before changing the stored document. Only then does it replace FTS5 chunks, remove obsolete vectors, and upsert current vectors. A temporary provider failure therefore leaves the previous searchable document intact. Storage failures during vector writes remain visible failures; a later full-rebuild path must repair that uncommon inconsistency rather than pretending hybrid retrieval succeeded.

`createHybridKnowledgeTools` exposes the asynchronous `kb_add`, `kb_search`, `kb_list`, and `kb_status` facade. The original FTS-only facade remains an explicit degradation path when the vector extension is unavailable.

## OpenAI-compatible embeddings

`OpenAICompatibleEmbeddingProvider` posts `model`, one text `input`, float encoding, and optional `dimensions` to the configured relative `embeddings` path. It validates model and dimension settings, input bounds, request timeout, response byte size, JSON shape, index zero, and returned vector dimensions. Remote endpoints require HTTPS; registry-listed loopback hosts may use HTTP. URLs cannot contain credentials, and a request path cannot escape or replace the configured base URL.

The API key is injected from operating-system encrypted desktop storage. It is never stored in the registry, logs, errors, or knowledge SQLite file. A key may be omitted for a local unauthenticated embedding service.

Embedding input is transmitted to the service selected by the user. The GUI must disclose this boundary when remote embeddings are enabled; local-first storage does not automatically anonymize remote embedding requests.

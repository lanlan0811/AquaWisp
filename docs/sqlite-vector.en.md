# Persistent SQLite vector index

`SqliteVectorIndex` in `packages/kb` uses the official `sqlite-vec` Node package with Node.js built-in `node:sqlite`. Chunk embeddings and knowledge metadata can therefore live in the same SQLite file without an external vector database.

Creating an index requires an explicit database path, portable namespace, and vector dimension. A namespace owns one vec0 virtual table and one text-ID mapping table. Its dimension is recorded in a shared registry table, and reopening the namespace with a different dimension fails immediately. Vectors are bound as compact `Float32Array` blobs; vec0 uses integer rowids while callers keep stable string IDs.

Security and compatibility constraints:

- extension loading is allowed only while opening the connection and is disabled immediately after `sqlite-vec` loads;
- the database enables WAL and foreign keys, while updates, removals, and ID mappings use `BEGIN IMMEDIATE` transactions;
- namespaces accept portable SQL-identifier characters only, preventing table-name injection;
- dimensions, finite values, and positive result limits are validated before SQL execution; and
- pinned npm packages provide Windows x64 and macOS x64/arm64 extension binaries, but packaging and clean-machine acceptance must still run on every target.

If a target cannot load the extension, the knowledge base can continue with FTS5. The caller must report vector retrieval as unavailable rather than pretending that hybrid retrieval ran.

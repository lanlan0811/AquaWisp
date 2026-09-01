import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { chunkText, segmentChineseForFts, type ChunkingConfig } from "./chunking.js";

export interface KnowledgeBaseOptions {
  readonly databasePath: string;
  readonly chunking: ChunkingConfig;
}
export interface KnowledgeDocument {
  readonly id: string;
  readonly uri: string;
  readonly title: string;
  readonly sourceType: "file" | "web" | "manual";
  readonly tags: readonly string[];
  readonly content: string;
  readonly updatedAt: string;
}
export interface KnowledgeSearchResult {
  readonly chunkId: string;
  readonly documentId: string;
  readonly uri: string;
  readonly title: string;
  readonly content: string;
  readonly score: number;
}
export interface KnowledgeBaseStatus {
  readonly documentCount: number;
  readonly chunkCount: number;
}

const schema = `
PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, uri TEXT NOT NULL, title TEXT NOT NULL, source_type TEXT NOT NULL, tags_json TEXT NOT NULL, content_hash TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS chunks (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, ordinal INTEGER NOT NULL, content TEXT NOT NULL, UNIQUE(document_id, ordinal)) STRICT;
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(chunk_id UNINDEXED, content, tokenize='unicode61');`;

export class KnowledgeBase {
  readonly #database: DatabaseSync;
  readonly #chunking: ChunkingConfig;
  constructor(options: KnowledgeBaseOptions) {
    this.#database = new DatabaseSync(options.databasePath);
    this.#chunking = options.chunking;
    this.#database.exec(schema);
  }
  close(): void {
    this.#database.close();
  }
  add(document: KnowledgeDocument): void {
    if (document.content.trim() === "")
      throw new Error("Knowledge document content cannot be empty");
    const chunks = chunkText(document.content, this.#chunking);
    const hash = createHash("sha256").update(document.content).digest("hex");
    this.#transaction(() => {
      this.#database
        .prepare(
          "DELETE FROM chunks_fts WHERE chunk_id IN (SELECT id FROM chunks WHERE document_id = ?)",
        )
        .run(document.id);
      this.#database.prepare("DELETE FROM documents WHERE id = ?").run(document.id);
      this.#database
        .prepare(
          "INSERT INTO documents (id, uri, title, source_type, tags_json, content_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          document.id,
          document.uri,
          document.title,
          document.sourceType,
          JSON.stringify(document.tags),
          hash,
          document.updatedAt,
        );
      const insertChunk = this.#database.prepare(
        "INSERT INTO chunks (id, document_id, ordinal, content) VALUES (?, ?, ?, ?)",
      );
      const insertFts = this.#database.prepare(
        "INSERT INTO chunks_fts (chunk_id, content) VALUES (?, ?)",
      );
      for (const chunk of chunks) {
        const id = `${document.id}:chunk:${chunk.ordinal.toString()}`;
        insertChunk.run(id, document.id, chunk.ordinal, chunk.content);
        insertFts.run(id, segmentChineseForFts(chunk.content));
      }
    });
  }
  search(query: string, limit: number): readonly KnowledgeSearchResult[] {
    if (query.trim() === "") throw new Error("Knowledge search query cannot be empty");
    if (!Number.isInteger(limit) || limit <= 0)
      throw new Error("Knowledge search limit must be a positive integer");
    const rows = this.#database
      .prepare(
        `SELECT chunks.id AS chunk_id, documents.id AS document_id, documents.uri, documents.title, chunks.content, bm25(chunks_fts) AS score FROM chunks_fts JOIN chunks ON chunks.id = chunks_fts.chunk_id JOIN documents ON documents.id = chunks.document_id WHERE chunks_fts MATCH ? ORDER BY score LIMIT ?`,
      )
      .all(segmentChineseForFts(query), limit) as unknown as Array<{
      chunk_id: string;
      document_id: string;
      uri: string;
      title: string;
      content: string;
      score: number;
    }>;
    return rows.map((row) => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      uri: row.uri,
      title: row.title,
      content: row.content,
      score: row.score,
    }));
  }
  status(): KnowledgeBaseStatus {
    const documents = this.#database.prepare("SELECT count(*) AS count FROM documents").get() as {
      count: number;
    };
    const chunks = this.#database.prepare("SELECT count(*) AS count FROM chunks").get() as {
      count: number;
    };
    return { documentCount: documents.count, chunkCount: chunks.count };
  }
  #transaction<T>(operation: () => T): T {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }
}

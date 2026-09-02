import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { buildFtsQuery, chunkText, segmentChineseForFts, type ChunkingConfig } from "./chunking.js";

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
  readonly ordinal: number;
  readonly uri: string;
  readonly title: string;
  readonly sourceType: "file" | "web" | "manual";
  readonly tags: readonly string[];
  readonly updatedAt: string;
  readonly content: string;
  readonly score: number;
}
export interface KnowledgeChunk {
  readonly id: string;
  readonly documentId: string;
  readonly ordinal: number;
  readonly uri: string;
  readonly title: string;
  readonly sourceType: "file" | "web" | "manual";
  readonly tags: readonly string[];
  readonly updatedAt: string;
  readonly content: string;
}
export interface PreparedKnowledgeChunk {
  readonly id: string;
  readonly documentId: string;
  readonly ordinal: number;
  readonly content: string;
}
export interface KnowledgeBaseStatus {
  readonly documentCount: number;
  readonly chunkCount: number;
}
export interface KnowledgeDocumentSummary {
  readonly id: string;
  readonly uri: string;
  readonly title: string;
  readonly sourceType: "file" | "web" | "manual";
  readonly tags: readonly string[];
  readonly updatedAt: string;
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
  prepareChunks(
    document: Pick<KnowledgeDocument, "id" | "content">,
  ): readonly PreparedKnowledgeChunk[] {
    if (document.id.trim() === "") throw new Error("Knowledge document ID cannot be empty");
    if (document.content.trim() === "")
      throw new Error("Knowledge document content cannot be empty");
    return chunkText(document.content, this.#chunking).map((chunk) => ({
      id: `${document.id}:chunk:${chunk.ordinal.toString()}`,
      documentId: document.id,
      ordinal: chunk.ordinal,
      content: chunk.content,
    }));
  }
  add(document: KnowledgeDocument): readonly KnowledgeChunk[] {
    const prepared = this.prepareChunks(document).map((chunk) => ({
      ...chunk,
      uri: document.uri,
      title: document.title,
      sourceType: document.sourceType,
      tags: document.tags,
      updatedAt: document.updatedAt,
    }));
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
      for (const chunk of prepared) {
        insertChunk.run(chunk.id, document.id, chunk.ordinal, chunk.content);
        insertFts.run(chunk.id, segmentChineseForFts(chunk.content));
      }
    });
    return prepared;
  }
  search(query: string, limit: number): readonly KnowledgeSearchResult[] {
    if (query.trim() === "") throw new Error("Knowledge search query cannot be empty");
    if (!Number.isInteger(limit) || limit <= 0)
      throw new Error("Knowledge search limit must be a positive integer");
    const rows = this.#database
      .prepare(
        `SELECT chunks.id AS chunk_id, chunks.ordinal, documents.id AS document_id, documents.uri,
                documents.title, documents.source_type, documents.tags_json, documents.updated_at,
                chunks.content, bm25(chunks_fts) AS score
         FROM chunks_fts JOIN chunks ON chunks.id = chunks_fts.chunk_id
         JOIN documents ON documents.id = chunks.document_id
         WHERE chunks_fts MATCH ? ORDER BY score LIMIT ?`,
      )
      .all(buildFtsQuery(query), limit) as unknown as {
      chunk_id: string;
      document_id: string;
      ordinal: number;
      uri: string;
      title: string;
      source_type: "file" | "web" | "manual";
      tags_json: string;
      updated_at: string;
      content: string;
      score: number;
    }[];
    return rows.map((row) => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      ordinal: row.ordinal,
      uri: row.uri,
      title: row.title,
      sourceType: row.source_type,
      tags: JSON.parse(row.tags_json) as string[],
      updatedAt: row.updated_at,
      content: row.content,
      score: row.score,
    }));
  }
  chunk(id: string): KnowledgeChunk | undefined {
    if (id.trim() === "") throw new Error("Knowledge chunk ID cannot be empty");
    const row = this.#database
      .prepare(
        `SELECT chunks.id, chunks.document_id, chunks.ordinal, documents.uri, documents.title,
                documents.source_type, documents.tags_json, documents.updated_at, chunks.content
         FROM chunks JOIN documents ON documents.id = chunks.document_id
         WHERE chunks.id = ?`,
      )
      .get(id) as ChunkRow | undefined;
    return row === undefined ? undefined : mapChunk(row);
  }
  chunks(documentId: string): readonly KnowledgeChunk[] {
    if (documentId.trim() === "") throw new Error("Knowledge document ID cannot be empty");
    const rows = this.#database
      .prepare(
        `SELECT chunks.id, chunks.document_id, chunks.ordinal, documents.uri, documents.title,
                documents.source_type, documents.tags_json, documents.updated_at, chunks.content
         FROM chunks JOIN documents ON documents.id = chunks.document_id
         WHERE chunks.document_id = ? ORDER BY chunks.ordinal ASC`,
      )
      .all(documentId) as unknown as ChunkRow[];
    return rows.map(mapChunk);
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
  list(limit: number): readonly KnowledgeDocumentSummary[] {
    if (!Number.isInteger(limit) || limit <= 0)
      throw new Error("Knowledge list limit must be a positive integer");
    const rows = this.#database
      .prepare(
        "SELECT id, uri, title, source_type, tags_json, updated_at FROM documents ORDER BY updated_at DESC, id ASC LIMIT ?",
      )
      .all(limit) as unknown as {
      id: string;
      uri: string;
      title: string;
      source_type: "file" | "web" | "manual";
      tags_json: string;
      updated_at: string;
    }[];
    return rows.map((row) => ({
      id: row.id,
      uri: row.uri,
      title: row.title,
      sourceType: row.source_type,
      tags: JSON.parse(row.tags_json) as string[],
      updatedAt: row.updated_at,
    }));
  }
  remove(documentId: string): boolean {
    if (documentId.trim() === "") throw new Error("Knowledge document ID cannot be empty");
    return this.#transaction(() => {
      const existing = this.#database
        .prepare("SELECT 1 AS present FROM documents WHERE id = ?")
        .get(documentId) as { present: number } | undefined;
      if (existing === undefined) return false;
      this.#database
        .prepare(
          "DELETE FROM chunks_fts WHERE chunk_id IN (SELECT id FROM chunks WHERE document_id = ?)",
        )
        .run(documentId);
      this.#database.prepare("DELETE FROM documents WHERE id = ?").run(documentId);
      return true;
    });
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

interface ChunkRow {
  readonly id: string;
  readonly document_id: string;
  readonly ordinal: number;
  readonly uri: string;
  readonly title: string;
  readonly source_type: "file" | "web" | "manual";
  readonly tags_json: string;
  readonly updated_at: string;
  readonly content: string;
}

function mapChunk(row: ChunkRow): KnowledgeChunk {
  return {
    id: row.id,
    documentId: row.document_id,
    ordinal: row.ordinal,
    uri: row.uri,
    title: row.title,
    sourceType: row.source_type,
    tags: JSON.parse(row.tags_json) as string[],
    updatedAt: row.updated_at,
    content: row.content,
  };
}

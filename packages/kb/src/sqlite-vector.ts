import { DatabaseSync } from "node:sqlite";

import * as sqliteVec from "sqlite-vec";

import type { VectorIndex, VectorMatch } from "./vector.js";

export interface SqliteVectorIndexOptions {
  readonly databasePath: string;
  readonly namespace: string;
  readonly dimensions: number;
}

interface VectorRow {
  readonly id: string;
  readonly distance: number;
}

export class SqliteVectorIndex implements VectorIndex {
  readonly #database: DatabaseSync;
  readonly #dimensions: number;
  readonly #idTable: string;
  readonly #vectorTable: string;

  constructor(options: SqliteVectorIndexOptions) {
    if (!Number.isInteger(options.dimensions) || options.dimensions <= 0) {
      throw new Error("Vector dimensions must be a positive integer");
    }
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(options.namespace)) {
      throw new Error("Vector namespace must be a portable SQL identifier");
    }
    this.#dimensions = options.dimensions;
    this.#idTable = `aquawisp_vec_${options.namespace}_ids`;
    this.#vectorTable = `aquawisp_vec_${options.namespace}`;
    this.#database = new DatabaseSync(options.databasePath, { allowExtension: true });
    sqliteVec.load(this.#database);
    this.#database.enableLoadExtension(false);
    this.#database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.#initialize(options.namespace);
  }

  close(): void {
    this.#database.close();
  }

  version(): string {
    const row = this.#database.prepare("SELECT vec_version() AS version").get() as {
      version: string;
    };
    return row.version;
  }

  upsert(id: string, vector: readonly number[]): void {
    if (id.trim() === "") throw new Error("Vector ID cannot be empty");
    const embedding = this.#embedding(vector);
    this.#transaction(() => {
      let row = this.#database
        .prepare(`SELECT rowid FROM "${this.#idTable}" WHERE id = ?`)
        .get(id) as { rowid: number | bigint } | undefined;
      if (row === undefined) {
        const result = this.#database
          .prepare(`INSERT INTO "${this.#idTable}" (id) VALUES (?)`)
          .run(id);
        row = { rowid: result.lastInsertRowid };
      }
      const vectorRowId = toBigInt(row.rowid);
      this.#database.prepare(`DELETE FROM "${this.#vectorTable}" WHERE rowid = ?`).run(vectorRowId);
      this.#database
        .prepare(`INSERT INTO "${this.#vectorTable}" (rowid, embedding) VALUES (?, ?)`)
        .run(vectorRowId, embedding);
    });
  }

  remove(id: string): void {
    this.#transaction(() => {
      const row = this.#database
        .prepare(`SELECT rowid FROM "${this.#idTable}" WHERE id = ?`)
        .get(id) as { rowid: number | bigint } | undefined;
      if (row === undefined) return;
      this.#database
        .prepare(`DELETE FROM "${this.#vectorTable}" WHERE rowid = ?`)
        .run(toBigInt(row.rowid));
      this.#database.prepare(`DELETE FROM "${this.#idTable}" WHERE rowid = ?`).run(row.rowid);
    });
  }

  search(vector: readonly number[], limit: number): readonly VectorMatch[] {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("Vector search limit must be a positive integer");
    }
    const rows = this.#database
      .prepare(
        `SELECT ids.id, matches.distance
         FROM (
           SELECT rowid, distance
           FROM "${this.#vectorTable}"
           WHERE embedding MATCH ?
           ORDER BY distance
           LIMIT ?
         ) AS matches
         JOIN "${this.#idTable}" AS ids ON ids.rowid = matches.rowid
         ORDER BY matches.distance ASC, ids.id ASC`,
      )
      .all(this.#embedding(vector), limit) as unknown as VectorRow[];
    return rows.map(({ id, distance }) => ({ id, score: 1 / (1 + distance) }));
  }

  #initialize(namespace: string): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS aquawisp_vector_namespaces (
        namespace TEXT PRIMARY KEY,
        dimensions INTEGER NOT NULL CHECK (dimensions > 0)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS "${this.#idTable}" (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE
      ) STRICT;
      CREATE VIRTUAL TABLE IF NOT EXISTS "${this.#vectorTable}"
        USING vec0(embedding float[${this.#dimensions.toString()}]);
    `);
    this.#database
      .prepare(
        "INSERT INTO aquawisp_vector_namespaces (namespace, dimensions) VALUES (?, ?) ON CONFLICT(namespace) DO NOTHING",
      )
      .run(namespace, this.#dimensions);
    const stored = this.#database
      .prepare("SELECT dimensions FROM aquawisp_vector_namespaces WHERE namespace = ?")
      .get(namespace) as { dimensions: number };
    if (stored.dimensions !== this.#dimensions) {
      this.#database.close();
      throw new Error(
        `Vector namespace dimension mismatch: expected ${stored.dimensions.toString()}, received ${this.#dimensions.toString()}`,
      );
    }
  }

  #embedding(vector: readonly number[]): Uint8Array {
    if (vector.length !== this.#dimensions || vector.some((value) => !Number.isFinite(value))) {
      throw new Error("Vector does not match index dimensions");
    }
    return new Uint8Array(new Float32Array(vector).buffer);
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

function toBigInt(value: number | bigint): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

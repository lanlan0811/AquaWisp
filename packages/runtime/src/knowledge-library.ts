import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  knowledgeIngestedFileSchema,
  knowledgeLibraryStateSchema,
  type KnowledgeIngestedFile,
  type KnowledgeLibraryState,
} from "@aquawisp/contracts";
import { extractFileText, ingestionConfig, KnowledgeBase, knowledgeBaseConfig } from "@aquawisp/kb";
import type {
  KnowledgeBaseStatus,
  KnowledgeDocumentSummary,
  KnowledgeSearchResult,
} from "@aquawisp/kb";

export interface RuntimeKnowledgeLibraryOptions {
  readonly workingDirectory: string;
  readonly databaseFileName: string;
  readonly listLimit: number;
}

export class RuntimeKnowledgeLibrary {
  readonly #knowledgeBase: KnowledgeBase;
  readonly #listLimit: number;

  constructor(options: RuntimeKnowledgeLibraryOptions) {
    if (!Number.isInteger(options.listLimit) || options.listLimit <= 0) {
      throw new Error("Knowledge library list limit must be a positive integer");
    }
    this.#listLimit = options.listLimit;
    this.#knowledgeBase = new KnowledgeBase({
      databasePath: join(options.workingDirectory, options.databaseFileName),
      chunking: knowledgeBaseConfig.chunking,
    });
  }

  state(): KnowledgeLibraryState {
    const documents = this.#knowledgeBase.list(this.#listLimit).map((document) => ({
      ...document,
      chunkCount: this.#knowledgeBase.chunks(document.id).length,
    }));
    return knowledgeLibraryStateSchema.parse({
      status: this.#knowledgeBase.status(),
      documents,
      acceptedExtensions: ingestionConfig.formats.flatMap(({ extensions }) => extensions),
    });
  }

  async addFile(filePath: string): Promise<KnowledgeIngestedFile> {
    const canonicalPath = await realpath(filePath);
    const fileStats = await stat(canonicalPath);
    if (!fileStats.isFile()) throw new Error("Knowledge source must be a file");
    const extracted = await extractFileText({ path: canonicalPath });
    if (extracted.text === "") throw new Error("Knowledge source did not contain extractable text");
    const uri = pathToFileURL(canonicalPath).href;
    const documentId = `file:${createHash("sha256").update(uri).digest("hex").slice(0, 48)}`;
    const title = basename(canonicalPath);
    const updatedAt = fileStats.mtime.toISOString();
    const chunks = this.#knowledgeBase.add({
      id: documentId,
      uri,
      title,
      sourceType: "file",
      tags: [],
      content: extracted.text,
      updatedAt,
    });
    return knowledgeIngestedFileSchema.parse({
      document: {
        id: documentId,
        uri,
        title,
        sourceType: "file",
        tags: [],
        updatedAt,
        chunkCount: chunks.length,
      },
      format: extracted.format,
    });
  }

  remove(documentId: string): boolean {
    return this.#knowledgeBase.remove(documentId);
  }

  search(query: string, limit: number): readonly KnowledgeSearchResult[] {
    return this.#knowledgeBase.search(query, limit);
  }

  list(limit: number): readonly KnowledgeDocumentSummary[] {
    return this.#knowledgeBase.list(limit);
  }

  status(): KnowledgeBaseStatus {
    return this.#knowledgeBase.status();
  }

  close(): void {
    this.#knowledgeBase.close();
  }
}

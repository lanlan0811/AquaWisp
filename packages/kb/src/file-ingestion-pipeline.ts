import { pathToFileURL } from "node:url";

import { type HybridKnowledgeIndex } from "./hybrid-retriever.js";
import { extractFileText, type SupportedTextFormat } from "./ingestion.js";
import type { KnowledgeChunk, KnowledgeDocument } from "./knowledge-base.js";

export interface IngestFileRequest {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly tags?: readonly string[];
  readonly mimeType?: string;
}

export interface IngestedFile {
  readonly document: KnowledgeDocument;
  readonly format: SupportedTextFormat;
  readonly chunks: readonly KnowledgeChunk[];
}

export class KnowledgeFileIngestionPipeline {
  readonly #hybridIndex: HybridKnowledgeIndex;

  constructor(hybridIndex: HybridKnowledgeIndex) {
    this.#hybridIndex = hybridIndex;
  }

  async ingest(request: IngestFileRequest): Promise<IngestedFile> {
    if (request.id.trim() === "") throw new Error("Ingested file ID cannot be empty");
    if (request.title.trim() === "") throw new Error("Ingested file title cannot be empty");
    if (Number.isNaN(Date.parse(request.updatedAt))) {
      throw new Error("Ingested file updatedAt must be an ISO-compatible timestamp");
    }
    const extracted = await extractFileText({
      path: request.path,
      ...(request.mimeType === undefined ? {} : { mimeType: request.mimeType }),
    });
    if (extracted.text === "") {
      throw new Error("Ingested file did not contain extractable text");
    }
    const document: KnowledgeDocument = {
      id: request.id,
      uri: pathToFileURL(request.path).href,
      title: request.title,
      sourceType: "file",
      tags: [...(request.tags ?? [])],
      content: extracted.text,
      updatedAt: request.updatedAt,
    };
    const chunks = await this.#hybridIndex.add(document);
    return { document, format: extracted.format, chunks };
  }
}

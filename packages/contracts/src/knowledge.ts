import { z } from "zod";

import { entityIdSchema, timestampSchema } from "./common.js";

export const knowledgeFormatSchema = z.enum([
  "markdown",
  "text",
  "html",
  "docx",
  "pdf",
  "xlsx",
  "pptx",
]);

export const knowledgeDocumentSummarySchema = z
  .object({
    id: entityIdSchema,
    uri: z.string().min(1).max(32_768).pipe(z.url()),
    title: z.string().min(1).max(1_024),
    sourceType: z.enum(["file", "web", "manual"]),
    tags: z.array(z.string().min(1).max(128)).max(128),
    updatedAt: timestampSchema,
    chunkCount: z.number().int().nonnegative(),
  })
  .strict();

export const knowledgeLibraryStateSchema = z
  .object({
    status: z
      .object({
        documentCount: z.number().int().nonnegative(),
        chunkCount: z.number().int().nonnegative(),
      })
      .strict(),
    documents: z.array(knowledgeDocumentSummarySchema).max(10_000),
    acceptedExtensions: z.array(z.string().regex(/^\.[a-z0-9]+$/u)).min(1),
  })
  .strict();

export const knowledgeIngestedFileSchema = z
  .object({
    document: knowledgeDocumentSummarySchema,
    format: knowledgeFormatSchema,
  })
  .strict();

export const knowledgeSearchResultSchema = z
  .object({
    chunkId: entityIdSchema,
    documentId: entityIdSchema,
    ordinal: z.number().int().nonnegative(),
    uri: z.string().min(1).max(32_768).pipe(z.url()),
    title: z.string().min(1).max(1_024),
    sourceType: z.enum(["file", "web", "manual"]),
    tags: z.array(z.string().min(1).max(128)).max(128),
    updatedAt: timestampSchema,
    content: z.string().min(1).max(1_048_576),
    score: z.number(),
  })
  .strict();

export type KnowledgeFormat = z.infer<typeof knowledgeFormatSchema>;
export type KnowledgeDocumentSummaryContract = z.infer<typeof knowledgeDocumentSummarySchema>;
export type KnowledgeLibraryState = z.infer<typeof knowledgeLibraryStateSchema>;
export type KnowledgeIngestedFile = z.infer<typeof knowledgeIngestedFileSchema>;
export type KnowledgeSearchResultContract = z.infer<typeof knowledgeSearchResultSchema>;

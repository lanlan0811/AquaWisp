import { z } from "zod";

import source from "./kb-config.data.json" with { type: "json" };

export const knowledgeBaseConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    chunking: z
      .object({
        maximumCharacters: z.number().int().positive(),
        overlapCharacters: z.number().int().nonnegative(),
        minimumCharacters: z.number().int().positive(),
      })
      .strict()
      .refine(({ maximumCharacters, overlapCharacters }) => overlapCharacters < maximumCharacters, {
        message: "Chunk overlap must be smaller than the maximum chunk size",
      }),
    indexing: z
      .object({
        embeddingConcurrency: z.number().int().positive(),
        embeddingRequestPath: z.string().min(1),
        embeddingTimeoutMs: z.number().int().positive(),
        maximumEmbeddingInputCharacters: z.number().int().positive(),
        maximumEmbeddingResponseBytes: z.number().int().positive(),
        allowedInsecureEmbeddingHosts: z.array(z.string().min(1)),
      })
      .strict(),
    search: z
      .object({
        defaultLimit: z.number().int().positive(),
        maximumLimit: z.number().int().positive(),
        candidateMultiplier: z.number().int().positive(),
        rankConstant: z.number().int().positive(),
        ftsWeight: z.number().positive(),
        vectorWeight: z.number().positive(),
        minimumVectorScore: z.number().min(-1).max(1),
        highlightCharacters: z.number().int().positive(),
        maximumHighlights: z.number().int().positive(),
      })
      .strict()
      .refine(({ defaultLimit, maximumLimit }) => defaultLimit <= maximumLimit, {
        message: "Default search limit cannot exceed maximum search limit",
      }),
  })
  .strict();

export const knowledgeBaseConfig = knowledgeBaseConfigSchema.parse(source);
export type KnowledgeBaseConfig = z.infer<typeof knowledgeBaseConfigSchema>;

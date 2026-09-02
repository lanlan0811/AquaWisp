import { z } from "zod";

import source from "./runtime-host.data.json" with { type: "json" };

const safeFileNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u);

const runtimeHostConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    databaseFileName: safeFileNameSchema,
    maximumCycles: z.number().int().positive(),
    streamRecovery: z.object({ maximumAttempts: z.number().int().nonnegative().max(3) }).strict(),
    knowledge: z
      .object({
        databaseFileName: safeFileNameSchema,
        listLimit: z.number().int().positive().max(10_000),
      })
      .strict(),
    context: z
      .object({
        checkpointDirectoryName: safeFileNameSchema,
        artifactDirectoryName: safeFileNameSchema,
        charactersPerToken: z.number().positive(),
        maxTokens: z.number().int().positive(),
        compressionThresholdRatio: z.number().positive().max(1),
        recentWindowTokens: z.number().int().positive(),
        maximumSummaryTokens: z.number().int().positive(),
        toolInlineTokenLimit: z.number().int().positive(),
        artifactPreviewCharacters: z.number().int().positive(),
        maximumPromptBundleBytes: z.number().int().positive().max(10_485_760),
      })
      .strict()
      .refine(
        ({ maxTokens, recentWindowTokens, maximumSummaryTokens }) =>
          recentWindowTokens + maximumSummaryTokens <= maxTokens,
        "Context recent and summary budgets must fit inside maxTokens",
      ),
  })
  .strict()
  .refine(({ databaseFileName, knowledge }) => databaseFileName !== knowledge.databaseFileName, {
    message: "Runtime event and knowledge databases must use different files",
  });

export const runtimeHostConfig = runtimeHostConfigSchema.parse(source);
export type RuntimeHostConfig = z.infer<typeof runtimeHostConfigSchema>;
export type RuntimeContextConfig = RuntimeHostConfig["context"];

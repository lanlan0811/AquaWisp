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
    tools: z
      .object({
        workspaceDirectoryName: safeFileNameSchema,
        maximumToolArgumentsBytes: z.number().int().positive().max(524_288),
        maximumObservationBytes: z.number().int().positive().max(524_288),
        filesystemMaximumFileBytes: z.number().int().positive().max(16_777_216),
        searchMaximumResults: z.number().int().positive().max(10_000),
        searchMaximumFileBytes: z.number().int().positive().max(1_073_741_824),
        searchMaximumMatchCharacters: z.number().int().positive().max(65_536),
        terminalMaximumOutputBytes: z.number().int().positive().max(16_777_216),
        terminalDefaultTimeoutMilliseconds: z.number().int().positive().max(600_000),
        webAllowedProtocols: z.array(z.enum(["http:", "https:"])).min(1),
        webMaximumResponseBytes: z.number().int().positive().max(16_777_216),
        knowledgeSearchDefaultLimit: z.number().int().positive(),
        knowledgeSearchMaximumLimit: z.number().int().positive().max(50),
        knowledgeListDefaultLimit: z.number().int().positive(),
        knowledgeListMaximumLimit: z.number().int().positive().max(500),
        explicitlyDeniedToolIds: z.array(z.string().min(1)),
        projectDeniedToolIds: z.array(z.string().min(1)),
      })
      .strict()
      .refine(
        ({ knowledgeSearchDefaultLimit, knowledgeSearchMaximumLimit }) =>
          knowledgeSearchDefaultLimit <= knowledgeSearchMaximumLimit,
        "Default knowledge search limit must not exceed its maximum",
      )
      .refine(
        ({ knowledgeListDefaultLimit, knowledgeListMaximumLimit }) =>
          knowledgeListDefaultLimit <= knowledgeListMaximumLimit,
        "Default knowledge list limit must not exceed its maximum",
      ),
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
  })
  .refine(
    ({ databaseFileName, knowledge, tools, context }) =>
      new Set([
        databaseFileName,
        knowledge.databaseFileName,
        tools.workspaceDirectoryName,
        context.checkpointDirectoryName,
        context.artifactDirectoryName,
      ]).size === 5,
    {
      message: "Runtime databases, tool workspace, checkpoints, and artifacts must be isolated",
    },
  );

export const runtimeHostConfig = runtimeHostConfigSchema.parse(source);
export type RuntimeHostConfig = z.infer<typeof runtimeHostConfigSchema>;
export type RuntimeContextConfig = RuntimeHostConfig["context"];
export type RuntimeToolConfig = RuntimeHostConfig["tools"];

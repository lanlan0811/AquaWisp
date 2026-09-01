import { z } from "zod";

import { entityIdSchema, timestampSchema } from "./common.js";

export const runStageSchema = z.enum([
  "prepare",
  "reason",
  "authorize",
  "execute",
  "observe",
  "verify",
]);

export const runStatusSchema = z.enum([
  "created",
  "running",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export const terminalRunStatusSchema = z.enum(["completed", "failed", "cancelled", "interrupted"]);

export const runRecordSchema = z
  .object({
    id: entityIdSchema,
    sessionId: entityIdSchema,
    status: runStatusSchema,
    currentStage: runStageSchema.nullable(),
    userInput: z.string().min(1),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    finalOutput: z.string().nullable(),
    errorCode: z.string().min(1).nullable(),
    errorMessage: z.string().min(1).nullable(),
    revision: z.number().int().nonnegative(),
  })
  .strict();

export type RunStage = z.infer<typeof runStageSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type RunRecord = z.infer<typeof runRecordSchema>;

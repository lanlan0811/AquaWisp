import { z } from "zod";

import { entityIdSchema, jsonObjectSchema, jsonValueSchema, timestampSchema } from "./common.js";

export const actionStateSchema = z.enum([
  "planned",
  "authorized",
  "dispatched",
  "observed",
  "verified",
  "unknown",
]);

export const actionRecordSchema = z
  .object({
    id: entityIdSchema,
    runId: entityIdSchema,
    stepId: entityIdSchema,
    toolName: z.string().min(1).max(128),
    toolRevision: z.string().min(1).max(64),
    input: jsonObjectSchema,
    sideEffect: z.boolean(),
    idempotencyKey: z.string().min(1).max(256),
    state: actionStateSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const observationSchema = z
  .object({
    ok: z.boolean(),
    output: jsonValueSchema,
    errorCode: z.string().min(1).optional(),
    errorMessage: z.string().min(1).optional(),
  })
  .strict();

export const verificationSchema = z
  .object({
    success: z.boolean(),
    summary: z.string().min(1),
    evidence: jsonObjectSchema,
  })
  .strict();

export type ActionState = z.infer<typeof actionStateSchema>;
export type ActionRecord = z.infer<typeof actionRecordSchema>;
export type Observation = z.infer<typeof observationSchema>;
export type Verification = z.infer<typeof verificationSchema>;

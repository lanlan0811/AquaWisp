import { z } from "zod";

import { jsonObjectSchema } from "./common.js";

export const actionProposalSchema = z
  .object({
    toolName: z.string().min(1).max(128),
    toolRevision: z.string().min(1).max(64),
    input: jsonObjectSchema,
    sideEffect: z.boolean(),
  })
  .strict();

export const modelDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("action"), action: actionProposalSchema }).strict(),
  z.object({ kind: z.literal("final"), content: z.string().min(1) }).strict(),
]);

export const modelSignalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text_delta"), delta: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal("stream_recovery"),
      recoveryAttempt: z.number().int().positive(),
      priorEventCount: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ kind: z.literal("decision"), decision: modelDecisionSchema }).strict(),
]);

export type ActionProposal = z.infer<typeof actionProposalSchema>;
export type ModelDecision = z.infer<typeof modelDecisionSchema>;
export type ModelSignal = z.infer<typeof modelSignalSchema>;

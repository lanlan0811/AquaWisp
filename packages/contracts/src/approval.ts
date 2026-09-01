import { z } from "zod";

import { entityIdSchema, timestampSchema } from "./common.js";

export const authorizationOutcomeSchema = z.enum(["allowed", "denied", "requires_approval"]);
export const approvalStatusSchema = z.enum(["pending", "approved", "denied", "expired"]);

export const authorizationDecisionSchema = z
  .object({
    outcome: authorizationOutcomeSchema,
    reasonCode: z.string().min(1).max(128),
    humanSummary: z.string().min(1),
    approvalId: entityIdSchema.optional(),
  })
  .strict()
  .superRefine((decision, context) => {
    if (decision.outcome === "requires_approval" && decision.approvalId === undefined) {
      context.addIssue({
        code: "custom",
        message: "approvalId is required when authorization requires approval",
        path: ["approvalId"],
      });
    }
  });

export const approvalRequestSchema = z
  .object({
    id: entityIdSchema,
    runId: entityIdSchema,
    actionId: entityIdSchema,
    status: approvalStatusSchema,
    actionType: z.string().min(1),
    target: z.string().min(1),
    riskReason: z.string().min(1),
    impact: z.string().min(1),
    requestedAt: timestampSchema,
    resolvedAt: timestampSchema.nullable(),
  })
  .strict();

export type AuthorizationDecision = z.infer<typeof authorizationDecisionSchema>;
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

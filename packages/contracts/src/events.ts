import { z } from "zod";

import { actionRecordSchema, observationSchema, verificationSchema } from "./action.js";
import { approvalRequestSchema, authorizationDecisionSchema } from "./approval.js";
import { entityIdSchema, jsonObjectSchema, timestampSchema } from "./common.js";
import { modelDecisionSchema } from "./model.js";
import { runRecordSchema, runStageSchema } from "./run.js";

const envelopeFields = {
  eventId: entityIdSchema,
  runId: entityIdSchema,
  sequence: z.number().int().nonnegative(),
  timestamp: timestampSchema,
  traceId: entityIdSchema,
  parentEventId: entityIdSchema.nullable(),
};

function eventSchema<const Type extends string, Payload extends z.ZodType>(
  type: Type,
  payload: Payload,
) {
  return z.object({ ...envelopeFields, type: z.literal(type), payload }).strict();
}

export const runEventSchema = z.discriminatedUnion("type", [
  eventSchema("run.created", runRecordSchema),
  eventSchema(
    "run.stage.entered",
    z.object({ stage: runStageSchema, cycle: z.number().int().positive() }).strict(),
  ),
  eventSchema("model.delta", z.object({ delta: z.string().min(1) }).strict()),
  eventSchema("model.decision", z.object({ decision: modelDecisionSchema }).strict()),
  eventSchema("action.planned", z.object({ action: actionRecordSchema }).strict()),
  eventSchema(
    "action.authorized",
    z.object({ actionId: entityIdSchema, decision: authorizationDecisionSchema }).strict(),
  ),
  eventSchema(
    "action.denied",
    z
      .object({ actionId: entityIdSchema, decision: authorizationDecisionSchema })
      .strict()
      .refine(({ decision }) => decision.outcome === "denied", {
        message: "action.denied requires a denied authorization decision",
        path: ["decision", "outcome"],
      }),
  ),
  eventSchema(
    "action.dispatched",
    z.object({ actionId: entityIdSchema, dispatchedAt: timestampSchema }).strict(),
  ),
  eventSchema(
    "action.observed",
    z.object({ actionId: entityIdSchema, observation: observationSchema }).strict(),
  ),
  eventSchema(
    "action.verified",
    z.object({ actionId: entityIdSchema, verification: verificationSchema }).strict(),
  ),
  eventSchema(
    "action.unknown",
    z.object({ actionId: entityIdSchema, reason: z.string().min(1) }).strict(),
  ),
  eventSchema("approval.required", z.object({ request: approvalRequestSchema }).strict()),
  eventSchema("run.completed", z.object({ finalOutput: z.string().min(1) }).strict()),
  eventSchema("run.cancelled", z.object({ reason: z.string().min(1) }).strict()),
  eventSchema(
    "run.failed",
    z
      .object({ code: z.string().min(1), message: z.string().min(1), details: jsonObjectSchema })
      .strict(),
  ),
]);

export type RunEvent = z.infer<typeof runEventSchema>;
export type RunEventType = RunEvent["type"];
export type RunEventPayload<Type extends RunEventType> = Extract<
  RunEvent,
  { type: Type }
>["payload"];

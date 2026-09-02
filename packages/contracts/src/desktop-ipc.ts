import { z } from "zod";

import { approvalUserDecisionSchema } from "./approval.js";
import { entityIdSchema } from "./common.js";
import { runEventSchema } from "./events.js";
import { knowledgeIngestedFileSchema, knowledgeLibraryStateSchema } from "./knowledge.js";
import { runRecordSchema } from "./run.js";

export const desktopSecretSetRequestSchema = z
  .object({
    name: entityIdSchema,
    value: z.string().min(1).max(1_048_576),
  })
  .strict();

export const desktopSecretNameRequestSchema = z.object({ name: entityIdSchema }).strict();

export const desktopSecretMutationResultSchema = z.object({ stored: z.boolean() }).strict();

export const desktopSecretPresenceResultSchema = z.object({ present: z.boolean() }).strict();

export const desktopSecretDeleteResultSchema = z.object({ deleted: z.boolean() }).strict();

export const desktopRuntimeStatusResultSchema = z.object({ connected: z.boolean() }).strict();

export const desktopSessionModeSchema = z.enum(["plan", "work", "full_access"]);
export const desktopDefaultModeSchema = z.enum(["plan", "work"]);

export const desktopConversationStartRequestSchema = z
  .object({
    sessionId: entityIdSchema,
    userInput: z.string().min(1).max(1_048_576),
    mode: desktopSessionModeSchema,
    modelId: entityIdSchema,
    reasoningLevel: entityIdSchema,
  })
  .strict();
export const desktopConversationCancelRequestSchema = z.object({ runId: entityIdSchema }).strict();
export const desktopConversationStartResultSchema = runRecordSchema;
export const desktopConversationEventSchema = runEventSchema;
export const desktopApprovalResolveRequestSchema = approvalUserDecisionSchema;
export const desktopApprovalResolveResultSchema = z.object({ accepted: z.literal(true) }).strict();

export const desktopKnowledgeAddFilesResultSchema = z
  .object({
    cancelled: z.boolean(),
    imported: z.array(knowledgeIngestedFileSchema),
    failures: z.array(
      z
        .object({
          fileName: z.string().min(1).max(1_024),
          message: z.string().min(1).max(4_096),
        })
        .strict(),
    ),
    state: knowledgeLibraryStateSchema,
  })
  .strict();
export const desktopKnowledgeRemoveRequestSchema = z
  .object({ documentId: entityIdSchema })
  .strict();
export const desktopKnowledgeStateResultSchema = knowledgeLibraryStateSchema;

export const desktopSettingsSchema = z
  .object({
    providerId: entityIdSchema,
    modelId: entityIdSchema,
    protocol: z.enum(["chat_completions", "responses"]),
    reasoningLevel: entityIdSchema,
    secretName: entityIdSchema,
    mode: desktopDefaultModeSchema,
  })
  .strict();

export type DesktopSecretSetRequest = z.infer<typeof desktopSecretSetRequestSchema>;
export type DesktopSecretNameRequest = z.infer<typeof desktopSecretNameRequestSchema>;
export type DesktopSettings = z.infer<typeof desktopSettingsSchema>;
export type DesktopSessionMode = z.infer<typeof desktopSessionModeSchema>;
export type DesktopKnowledgeAddFilesResult = z.infer<typeof desktopKnowledgeAddFilesResultSchema>;

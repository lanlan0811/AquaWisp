import { z } from "zod";

import { entityIdSchema } from "./common.js";

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

export type DesktopSecretSetRequest = z.infer<typeof desktopSecretSetRequestSchema>;
export type DesktopSecretNameRequest = z.infer<typeof desktopSecretNameRequestSchema>;

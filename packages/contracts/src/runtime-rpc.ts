import { z } from "zod";

import { entityIdSchema, jsonObjectSchema } from "./common.js";

const runtimeRpcEnvelope = {
  protocolVersion: z.literal(1),
  requestId: entityIdSchema,
};

export const runtimeRpcRequestSchema = z.discriminatedUnion("method", [
  z
    .object({
      ...runtimeRpcEnvelope,
      method: z.literal("runtime.ping"),
      params: z.object({}).strict(),
    })
    .strict(),
  z
    .object({
      ...runtimeRpcEnvelope,
      method: z.literal("runtime.shutdown"),
      params: z.object({}).strict(),
    })
    .strict(),
]);

export const runtimeRpcResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ...runtimeRpcEnvelope,
      ok: z.literal(true),
      result: jsonObjectSchema,
    })
    .strict(),
  z
    .object({
      ...runtimeRpcEnvelope,
      ok: z.literal(false),
      error: z.object({ code: z.string().min(1), message: z.string().min(1) }).strict(),
    })
    .strict(),
]);

export type RuntimeRpcRequest = z.infer<typeof runtimeRpcRequestSchema>;
export type RuntimeRpcResponse = z.infer<typeof runtimeRpcResponseSchema>;

import { z } from "zod";

import { entityIdSchema, jsonObjectSchema } from "./common.js";
import { approvalUserDecisionSchema } from "./approval.js";
import { runEventSchema } from "./events.js";

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
  z
    .object({
      ...runtimeRpcEnvelope,
      method: z.literal("runtime.run.start"),
      params: z
        .object({
          sessionId: entityIdSchema,
          userInput: z.string().min(1).max(1_048_576),
          providerId: entityIdSchema,
          modelId: entityIdSchema,
          protocol: z.enum(["chat_completions", "responses"]),
          reasoningLevel: entityIdSchema,
          apiKey: z.string().min(1).max(16_384),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...runtimeRpcEnvelope,
      method: z.literal("runtime.run.cancel"),
      params: z.object({ runId: entityIdSchema }).strict(),
    })
    .strict(),
  z
    .object({
      ...runtimeRpcEnvelope,
      method: z.literal("runtime.kb.state"),
      params: z.object({}).strict(),
    })
    .strict(),
  z
    .object({
      ...runtimeRpcEnvelope,
      method: z.literal("runtime.kb.add_file"),
      params: z.object({ path: z.string().min(1).max(32_768) }).strict(),
    })
    .strict(),
  z
    .object({
      ...runtimeRpcEnvelope,
      method: z.literal("runtime.kb.remove"),
      params: z.object({ documentId: entityIdSchema }).strict(),
    })
    .strict(),
  z
    .object({
      ...runtimeRpcEnvelope,
      method: z.literal("runtime.approval.resolve"),
      params: approvalUserDecisionSchema,
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

export const runtimeRpcEventSchema = z
  .object({
    protocolVersion: z.literal(1),
    requestId: entityIdSchema,
    kind: z.literal("event"),
    event: runEventSchema,
  })
  .strict();

export const runtimeRpcMessageSchema = z.union([runtimeRpcResponseSchema, runtimeRpcEventSchema]);

export type RuntimeRpcRequest = z.infer<typeof runtimeRpcRequestSchema>;
export type RuntimeRpcResponse = z.infer<typeof runtimeRpcResponseSchema>;
export type RuntimeRpcEvent = z.infer<typeof runtimeRpcEventSchema>;
export type RuntimeRpcCommand = RuntimeRpcRequest extends infer Request
  ? Request extends RuntimeRpcRequest
    ? Pick<Request, "method" | "params">
    : never
  : never;

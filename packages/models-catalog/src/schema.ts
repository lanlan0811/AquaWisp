import { jsonValueSchema } from "@aquawisp/contracts";
import { z } from "zod";

export const modelProtocolSchema = z.enum(["chat_completions", "responses"]);
export const specificationStatusSchema = z.enum(["official", "pending_live_verification"]);

export const requestPatchSchema = z
  .object({
    set: z.record(z.string().min(1), jsonValueSchema),
    unset: z.array(z.string().min(1)),
  })
  .strict();

const protocolPatchesSchema = z
  .object({
    chat_completions: requestPatchSchema.optional(),
    responses: requestPatchSchema.optional(),
  })
  .strict();

const reasoningLevelSchema = z
  .object({
    id: z.string().min(1),
    rank: z.number().int().nonnegative(),
    protocolPatches: protocolPatchesSchema,
  })
  .strict();

const reasoningSchema = z
  .object({
    defaultLevel: z.string().min(1),
    levels: z.array(reasoningLevelSchema).min(1),
    aliases: z.record(z.string().min(1), z.string().min(1)),
  })
  .strict()
  .superRefine((reasoning, context) => {
    const levelIds = new Set(reasoning.levels.map(({ id }) => id));
    if (!levelIds.has(reasoning.defaultLevel)) {
      context.addIssue({ code: "custom", message: "defaultLevel must name a declared level" });
    }
    if (levelIds.size !== reasoning.levels.length) {
      context.addIssue({ code: "custom", message: "reasoning level ids must be unique" });
    }
    const ranks = new Set(reasoning.levels.map(({ rank }) => rank));
    if (ranks.size !== reasoning.levels.length) {
      context.addIssue({ code: "custom", message: "reasoning level ranks must be unique" });
    }
    for (const target of Object.values(reasoning.aliases)) {
      if (!levelIds.has(target)) {
        context.addIssue({ code: "custom", message: `alias target is not declared: ${target}` });
      }
    }
  });

export const providerDefinitionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    defaultProtocol: modelProtocolSchema,
    baseUrls: z
      .object({
        chat_completions: z.url().optional(),
        responses: z.url().optional(),
      })
      .strict(),
    sourceUrls: z.array(z.url()).min(1),
  })
  .strict();

export const modelDefinitionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    providerId: z.string().min(1),
    contextWindow: z.number().int().positive(),
    maxOutputTokens: z.number().int().positive(),
    maxOutputTokensStatus: specificationStatusSchema,
    supportedProtocols: z.array(modelProtocolSchema).min(1),
    supportsTools: z.boolean(),
    supportsStructuredOutput: z.boolean(),
    inputModalities: z.array(z.enum(["text", "image", "video"])).min(1),
    reasoning: reasoningSchema,
    streamRecovery: z
      .object({ assistantMessagePatches: protocolPatchesSchema })
      .strict()
      .optional(),
    sourceUrls: z.array(z.url()).min(1),
  })
  .strict()
  .superRefine((model, context) => {
    for (const level of model.reasoning.levels) {
      for (const protocol of Object.keys(level.protocolPatches)) {
        if (!model.supportedProtocols.includes(modelProtocolSchema.parse(protocol))) {
          context.addIssue({
            code: "custom",
            message: `reasoning patch uses unsupported protocol ${protocol}`,
          });
        }
      }
    }
    for (const [protocol, patch] of Object.entries(
      model.streamRecovery?.assistantMessagePatches ?? {},
    )) {
      if (!model.supportedProtocols.includes(modelProtocolSchema.parse(protocol))) {
        context.addIssue({
          code: "custom",
          message: `stream recovery patch uses unsupported protocol ${protocol}`,
        });
      }
      if (
        patch !== undefined &&
        [...Object.keys(patch.set), ...patch.unset].some(
          (path) =>
            path === "role" ||
            path === "content" ||
            path.startsWith("role.") ||
            path.startsWith("content."),
        )
      ) {
        context.addIssue({
          code: "custom",
          message: "stream recovery patches cannot change assistant role or content",
        });
      }
    }
  });

export const customProviderConnectionSchema = z
  .object({
    providerId: z.string().min(1),
    providerName: z.string().min(1),
    baseUrl: z.url(),
    protocol: modelProtocolSchema,
    model: modelDefinitionSchema,
  })
  .strict()
  .superRefine((connection, context) => {
    if (connection.model.providerId !== connection.providerId) {
      context.addIssue({
        code: "custom",
        path: ["model", "providerId"],
        message: "custom model providerId must match its connection providerId",
      });
    }
    if (!connection.model.supportedProtocols.includes(connection.protocol)) {
      context.addIssue({
        code: "custom",
        path: ["model", "supportedProtocols"],
        message: "custom model must declare the selected protocol",
      });
    }
  });

export const modelCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    lastVerified: z.iso.date(),
    providers: z.array(providerDefinitionSchema).min(1),
    models: z.array(modelDefinitionSchema).min(1),
  })
  .strict()
  .superRefine((catalog, context) => {
    const providerIds = new Set(catalog.providers.map(({ id }) => id));
    const modelIds = new Set(catalog.models.map(({ id }) => id));
    if (providerIds.size !== catalog.providers.length) {
      context.addIssue({ code: "custom", message: "provider ids must be unique" });
    }
    if (modelIds.size !== catalog.models.length) {
      context.addIssue({ code: "custom", message: "model ids must be unique" });
    }
    for (const model of catalog.models) {
      const provider = catalog.providers.find(({ id }) => id === model.providerId);
      if (provider === undefined) {
        context.addIssue({ code: "custom", message: `unknown provider ${model.providerId}` });
        continue;
      }
      if (!model.supportedProtocols.includes(provider.defaultProtocol)) {
        context.addIssue({
          code: "custom",
          message: `${model.id} does not support provider default protocol ${provider.defaultProtocol}`,
        });
      }
      for (const protocol of model.supportedProtocols) {
        if (provider.baseUrls[protocol] === undefined) {
          context.addIssue({
            code: "custom",
            message: `${model.id} has no provider base URL for ${protocol}`,
          });
        }
      }
    }
  });

export type ModelProtocol = z.infer<typeof modelProtocolSchema>;
export type RequestPatch = z.infer<typeof requestPatchSchema>;
export type ProviderDefinition = z.infer<typeof providerDefinitionSchema>;
export type ModelDefinition = z.infer<typeof modelDefinitionSchema>;
export type ModelCatalog = z.infer<typeof modelCatalogSchema>;
export type CustomProviderConnection = z.infer<typeof customProviderConnectionSchema>;

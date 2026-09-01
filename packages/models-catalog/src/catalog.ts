import catalogSource from "./catalog.data.json" with { type: "json" };

import {
  customProviderConnectionSchema,
  modelCatalogSchema,
  type CustomProviderConnection,
  type ModelCatalog,
  type ModelDefinition,
  type ProviderDefinition,
} from "./schema.js";

export const builtInModelCatalog: ModelCatalog = modelCatalogSchema.parse(catalogSource);

export function getBuiltInModel(modelId: string): ModelDefinition {
  const model = builtInModelCatalog.models.find(({ id }) => id === modelId);
  if (model === undefined) {
    throw new Error(`Unknown built-in model: ${modelId}`);
  }
  return model;
}

export function getBuiltInProvider(providerId: string): ProviderDefinition {
  const provider = builtInModelCatalog.providers.find(({ id }) => id === providerId);
  if (provider === undefined) {
    throw new Error(`Unknown built-in provider: ${providerId}`);
  }
  return provider;
}

export function resolveReasoningLevel(model: ModelDefinition, requestedLevel?: string) {
  const candidate = requestedLevel ?? model.reasoning.defaultLevel;
  const canonical = model.reasoning.aliases[candidate] ?? candidate;
  const level = model.reasoning.levels.find(({ id }) => id === canonical);
  if (level === undefined) {
    throw new Error(`Model ${model.id} does not support reasoning level ${candidate}`);
  }
  return level;
}

export function validateCustomProviderConnection(input: unknown): CustomProviderConnection {
  return customProviderConnectionSchema.parse(input);
}

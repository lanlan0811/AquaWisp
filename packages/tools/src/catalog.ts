import { z } from "zod";

import { jsonObjectSchema, type JsonObject } from "@aquawisp/contracts";

import source from "./tool-catalog.data.json" with { type: "json" };

const riskLevelSchema = z.enum(["low", "medium", "high"]);
const executionModeSchema = z.enum(["plan", "work", "full_access"]);
const targetScopeSchema = z.enum(["workspace", "external", "secret", "platform"]);

export const toolCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    modes: z
      .array(
        z
          .object({
            id: executionModeSchema,
            autoAllowRiskLevels: z.array(riskLevelSchema),
            denyRiskLevels: z.array(riskLevelSchema),
          })
          .strict(),
      )
      .length(3),
    boundaryApprovalScopes: z.array(targetScopeSchema),
    decisionCodes: z
      .object({
        invalidAction: z.string().min(1),
        unknownTool: z.string().min(1),
        explicitDeny: z.string().min(1),
        projectDeny: z.string().min(1),
        boundaryApproval: z.string().min(1),
        modeDeny: z.string().min(1),
        riskApproval: z.string().min(1),
        modeAllow: z.string().min(1),
      })
      .strict(),
    tools: z
      .array(
        z
          .object({
            id: z.string().min(1),
            modelName: z.string().regex(/^[A-Za-z0-9_-]+$/u),
            revision: z.string().min(1),
            riskLevel: riskLevelSchema,
            sideEffect: z.boolean(),
            description: z.string().min(1),
            inputSchema: jsonObjectSchema,
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((catalog, context) => {
    if (new Set(catalog.modes.map(({ id }) => id)).size !== catalog.modes.length) {
      context.addIssue({ code: "custom", message: "mode ids must be unique" });
    }
    if (new Set(catalog.tools.map(({ id }) => id)).size !== catalog.tools.length) {
      context.addIssue({ code: "custom", message: "tool ids must be unique" });
    }
    if (new Set(catalog.tools.map(({ modelName }) => modelName)).size !== catalog.tools.length) {
      context.addIssue({ code: "custom", message: "tool model names must be unique" });
    }
  });

export const toolCatalog = toolCatalogSchema.parse(source);

export type ToolCatalog = z.infer<typeof toolCatalogSchema>;
export type ExecutionMode = z.infer<typeof executionModeSchema>;
export type RiskLevel = z.infer<typeof riskLevelSchema>;
export type TargetScope = z.infer<typeof targetScopeSchema>;

export function getToolDefinition(toolId: string) {
  return toolCatalog.tools.find(({ id }) => id === toolId);
}

export function getToolDefinitionByModelName(modelName: string) {
  return toolCatalog.tools.find(({ modelName: candidate }) => candidate === modelName);
}

export function getModelToolDefinitions(protocol: "chat_completions" | "responses"): JsonObject[] {
  return toolCatalog.tools.map((tool) =>
    jsonObjectSchema.parse(
      protocol === "chat_completions"
        ? {
            type: "function",
            function: {
              name: tool.modelName,
              description: tool.description,
              parameters: tool.inputSchema,
            },
          }
        : {
            type: "function",
            name: tool.modelName,
            description: tool.description,
            parameters: tool.inputSchema,
          },
    ),
  );
}

export function getModeDefinition(mode: ExecutionMode) {
  const definition = toolCatalog.modes.find(({ id }) => id === mode);
  if (definition === undefined) {
    throw new Error(`Tool catalog does not define execution mode ${mode}`);
  }
  return definition;
}

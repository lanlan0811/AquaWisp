import { Ajv, type ValidateFunction } from "ajv";

import { jsonObjectSchema, type JsonObject } from "@aquawisp/contracts";

import { getToolDefinition, toolCatalog } from "./catalog.js";

export interface BuiltInToolInputMap {
  readonly "filesystem.read": { readonly path: string };
  readonly "filesystem.glob": { readonly pattern: string };
  readonly "filesystem.grep": { readonly query: string };
  readonly "filesystem.write": {
    readonly path: string;
    readonly content: string;
    readonly expectedRevision: string | null;
  };
  readonly "filesystem.edit": {
    readonly path: string;
    readonly expectedRevision: string;
    readonly replacements: readonly { readonly search: string; readonly replace: string }[];
  };
  readonly "terminal.execute": {
    readonly executable: string;
    readonly arguments: readonly string[];
    readonly cwd: string;
    readonly timeoutMilliseconds?: number;
  };
  readonly "web.fetch": { readonly url: string };
  readonly "kb.add": { readonly path: string };
  readonly "kb.search": { readonly query: string; readonly limit?: number };
  readonly "kb.list": { readonly limit?: number };
  readonly "kb.status": Record<string, never>;
}

export type BuiltInToolId = keyof BuiltInToolInputMap;

const builtInToolIds = new Set<string>([
  "filesystem.read",
  "filesystem.glob",
  "filesystem.grep",
  "filesystem.write",
  "filesystem.edit",
  "terminal.execute",
  "web.fetch",
  "kb.add",
  "kb.search",
  "kb.list",
  "kb.status",
] satisfies readonly BuiltInToolId[]);

if (
  toolCatalog.tools.some(({ id }) => !builtInToolIds.has(id)) ||
  toolCatalog.tools.length !== builtInToolIds.size
) {
  throw new Error("Tool input adapters and the tool catalog are out of sync");
}

const ajv = new Ajv({ allErrors: true, strict: true });
const validators = new Map<string, ValidateFunction>(
  toolCatalog.tools.map((tool) => [tool.id, ajv.compile(tool.inputSchema)]),
);

export function isBuiltInToolId(value: string): value is BuiltInToolId {
  return builtInToolIds.has(value);
}

export function parseToolInput<ToolId extends BuiltInToolId>(
  toolId: ToolId,
  input: unknown,
): BuiltInToolInputMap[ToolId] {
  const definition = getToolDefinition(toolId);
  const validator = validators.get(toolId);
  if (definition === undefined || validator === undefined) {
    throw new Error(`Tool is not registered: ${toolId}`);
  }
  const candidate: JsonObject = jsonObjectSchema.parse(input);
  if (!validator(candidate)) {
    throw new Error(`Tool input is invalid for ${toolId}: ${ajv.errorsText(validator.errors)}`);
  }
  return candidate as BuiltInToolInputMap[ToolId];
}

import { createHash } from "node:crypto";

import type { JsonObject, JsonValue } from "@aquawisp/contracts";
import {
  getBuiltInModel,
  resolveReasoningLevel,
  type ModelDefinition,
  type ModelProtocol,
  type RequestPatch,
} from "@aquawisp/models-catalog";

export interface NormalizeReasoningRequestOptions {
  readonly model: string | ModelDefinition;
  readonly protocol: ModelProtocol;
  readonly requestedLevel?: string;
  readonly request: JsonObject;
}

export interface NormalizedReasoningRequest {
  readonly model: ModelDefinition;
  readonly protocol: ModelProtocol;
  readonly requestedLevel: string;
  readonly canonicalLevel: string;
  readonly request: JsonObject;
  readonly revision: string;
}

const blockedPathSegments = new Set(["__proto__", "constructor", "prototype"]);

export function normalizeReasoningRequest(
  options: NormalizeReasoningRequestOptions,
): NormalizedReasoningRequest {
  const model = typeof options.model === "string" ? getBuiltInModel(options.model) : options.model;
  if (!model.supportedProtocols.includes(options.protocol)) {
    throw new Error(`Model ${model.id} does not support protocol ${options.protocol}`);
  }

  const level = resolveReasoningLevel(model, options.requestedLevel);
  const patch = level.protocolPatches[options.protocol];
  if (patch === undefined) {
    throw new Error(
      `Model ${model.id} reasoning level ${level.id} has no patch for ${options.protocol}`,
    );
  }

  const request = applyRequestPatch(options.request, patch);

  const requestedLevel = options.requestedLevel ?? model.reasoning.defaultLevel;
  const revisionSource = stableSerialize({
    modelId: model.id,
    providerId: model.providerId,
    protocol: options.protocol,
    canonicalLevel: level.id,
    patch,
  });

  return {
    model,
    protocol: options.protocol,
    requestedLevel,
    canonicalLevel: level.id,
    request,
    revision: `sha256:${createHash("sha256").update(revisionSource).digest("hex")}`,
  };
}

export function applyRequestPatch(requestInput: JsonObject, patch: RequestPatch): JsonObject {
  const request = structuredClone(requestInput);
  for (const path of patch.unset) {
    unsetPath(request, parsePath(path));
  }
  for (const [path, value] of Object.entries(patch.set)) {
    setPath(request, parsePath(path), structuredClone(value));
  }

  return request;
}

function parsePath(path: string): readonly string[] {
  const segments = path.split(".");
  if (segments.some((segment) => segment.length === 0 || blockedPathSegments.has(segment))) {
    throw new Error(`Unsafe or invalid request patch path: ${path}`);
  }
  return segments;
}

function setPath(root: JsonObject, segments: readonly string[], value: JsonValue): void {
  const finalSegment = segments.at(-1);
  if (finalSegment === undefined) {
    throw new Error("Cannot set an empty request patch path");
  }
  let cursor: JsonObject = root;
  for (const segment of segments.slice(0, -1)) {
    const current = cursor[segment];
    if (current === undefined) {
      const next: JsonObject = {};
      cursor[segment] = next;
      cursor = next;
    } else if (isJsonObject(current)) {
      cursor = current;
    } else {
      throw new Error(`Cannot set nested request patch through non-object path ${segment}`);
    }
  }
  cursor[finalSegment] = value;
}

function unsetPath(root: JsonObject, segments: readonly string[]): void {
  const finalSegment = segments.at(-1);
  if (finalSegment === undefined) {
    throw new Error("Cannot unset an empty request patch path");
  }
  let cursor: JsonObject = root;
  for (const segment of segments.slice(0, -1)) {
    const current = cursor[segment];
    if (!isJsonObject(current)) {
      return;
    }
    cursor = current;
  }
  Reflect.deleteProperty(cursor, finalSegment);
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableSerialize(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (isJsonObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key] ?? null)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

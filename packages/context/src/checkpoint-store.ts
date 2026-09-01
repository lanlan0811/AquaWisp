import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type {
  ContextCheckpointStore,
  ContextCompilation,
  ContextItem,
  PersistedContextCheckpoint,
} from "./types.js";

const referencePrefix = "context-checkpoint:";
const revisionPattern = /^sha256:([a-f0-9]{64})$/u;

export interface FileContextCheckpointStoreOptions {
  readonly directory: string;
}

export class FileContextCheckpointStore implements ContextCheckpointStore {
  readonly #directory: string;

  constructor(options: FileContextCheckpointStoreOptions) {
    this.#directory = resolve(options.directory);
  }

  async save(compilation: ContextCompilation): Promise<string> {
    const reference = referenceForRevision(compilation.checkpoint.revision);
    const targetPath = this.#pathForReference(reference);
    const serialized = `${JSON.stringify({
      schemaVersion: 1,
      checkpoint: compilation.checkpoint,
      items: compilation.items,
    } satisfies PersistedContextCheckpoint)}\n`;
    await mkdir(this.#directory, { recursive: true });
    const temporaryPath = join(this.#directory, `.${randomUUID()}.tmp`);
    try {
      await writeFile(temporaryPath, serialized, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, targetPath);
    } finally {
      // rename removes the temporary file on success. Failed writes leave no usable checkpoint.
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
    return reference;
  }

  async load(reference: string): Promise<PersistedContextCheckpoint> {
    const checkpointPath = this.#pathForReference(reference);
    const parsed: unknown = JSON.parse(await readFile(checkpointPath, "utf8"));
    if (!isPersistedCheckpoint(parsed)) {
      throw new Error(`Invalid context checkpoint: ${reference}`);
    }
    if (referenceForRevision(parsed.checkpoint.revision) !== reference) {
      throw new Error(`Context checkpoint revision does not match reference: ${reference}`);
    }
    return parsed;
  }

  #pathForReference(reference: string): string {
    const digest = digestForReference(reference);
    return join(this.#directory, `${digest}.json`);
  }
}

function referenceForRevision(revision: string): string {
  if (!revisionPattern.test(revision)) {
    throw new Error(`Unsupported context checkpoint revision: ${revision}`);
  }
  return `${referencePrefix}${revision}`;
}

function digestForReference(reference: string): string {
  if (!reference.startsWith(referencePrefix)) {
    throw new Error(`Unsupported context checkpoint reference: ${reference}`);
  }
  const revision = reference.slice(referencePrefix.length);
  const match = revisionPattern.exec(revision);
  if (match?.[1] === undefined) {
    throw new Error(`Unsupported context checkpoint reference: ${reference}`);
  }
  return match[1];
}

function isPersistedCheckpoint(value: unknown): value is PersistedContextCheckpoint {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.checkpoint)) {
    return false;
  }
  const { checkpoint, items } = value;
  const tokenCount = checkpoint.tokenCount;
  return (
    typeof checkpoint.revision === "string" &&
    revisionPattern.test(checkpoint.revision) &&
    Array.isArray(checkpoint.itemIds) &&
    checkpoint.itemIds.every((itemId) => typeof itemId === "string") &&
    typeof tokenCount === "number" &&
    Number.isInteger(tokenCount) &&
    tokenCount >= 0 &&
    Array.isArray(items) &&
    items.every(isContextItem)
  );
}

function isContextItem(value: unknown): value is ContextItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.kind === "system" ||
      value.kind === "user" ||
      value.kind === "assistant" ||
      value.kind === "tool" ||
      value.kind === "summary") &&
    typeof value.content === "string" &&
    typeof value.createdAt === "string" &&
    Array.isArray(value.provenanceEventIds) &&
    value.provenanceEventIds.every((eventId) => typeof eventId === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

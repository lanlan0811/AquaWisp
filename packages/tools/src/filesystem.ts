import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

export interface WorkspaceFilesystemOptions {
  readonly workspaceRoot: string;
}

export interface ReadFileResult {
  readonly content: string;
  readonly revision: string;
}

export interface WriteFileOptions {
  readonly path: string;
  readonly content: string;
  readonly expectedRevision: string | null;
}

export interface TextReplacement {
  readonly search: string;
  readonly replace: string;
}

export class WorkspaceBoundaryError extends Error {
  constructor(path: string) {
    super(`Path escapes the workspace boundary: ${path}`);
    this.name = "WorkspaceBoundaryError";
  }
}

export class RevisionConflictError extends Error {
  constructor(path: string) {
    super(`File revision changed before write: ${path}`);
    this.name = "RevisionConflictError";
  }
}

export class WorkspaceFilesystem {
  readonly #root: string;

  private constructor(root: string) {
    this.#root = root;
  }

  static async create(options: WorkspaceFilesystemOptions): Promise<WorkspaceFilesystem> {
    return new WorkspaceFilesystem(await realpath(options.workspaceRoot));
  }

  async read(path: string): Promise<ReadFileResult> {
    const absolutePath = await this.#existingPath(path);
    const content = await readFile(absolutePath, "utf8");
    return { content, revision: revisionFor(content) };
  }

  async write(options: WriteFileOptions): Promise<ReadFileResult> {
    const absolutePath = await this.#writePath(options.path);
    const current = await readOptionalText(absolutePath);
    const currentRevision = current === undefined ? null : revisionFor(current);
    if (currentRevision !== options.expectedRevision) {
      throw new RevisionConflictError(options.path);
    }
    const parent = dirname(absolutePath);
    await this.#assertExistingPath(parent);
    const temporaryPath = resolve(parent, `.${randomUUID()}.aquawisp.tmp`);
    try {
      await writeFile(temporaryPath, options.content, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, absolutePath);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
    return { content: options.content, revision: revisionFor(options.content) };
  }

  async edit(
    path: string,
    expectedRevision: string,
    replacements: readonly TextReplacement[],
  ): Promise<ReadFileResult> {
    if (replacements.length === 0) {
      throw new Error("At least one text replacement is required");
    }
    const current = await this.read(path);
    if (current.revision !== expectedRevision) {
      throw new RevisionConflictError(path);
    }
    let content = current.content;
    for (const replacement of replacements) {
      if (replacement.search === "") {
        throw new Error("Text replacement search cannot be empty");
      }
      const firstIndex = content.indexOf(replacement.search);
      if (
        firstIndex < 0 ||
        content.slice(firstIndex + replacement.search.length).includes(replacement.search)
      ) {
        throw new Error("Text replacement must match exactly one location");
      }
      content = `${content.slice(0, firstIndex)}${replacement.replace}${content.slice(firstIndex + replacement.search.length)}`;
    }
    return this.write({ path, content, expectedRevision });
  }

  async #existingPath(path: string): Promise<string> {
    const candidate = this.#candidate(path);
    await this.#assertExistingPath(candidate);
    return candidate;
  }

  async #writePath(path: string): Promise<string> {
    const candidate = this.#candidate(path);
    const parent = dirname(candidate);
    await this.#assertExistingPath(parent);
    const target = await lstat(candidate).catch(() => undefined);
    if (target?.isSymbolicLink() === true) {
      throw new WorkspaceBoundaryError(path);
    }
    return candidate;
  }

  #candidate(path: string): string {
    const candidate = resolve(this.#root, path);
    if (!isInside(this.#root, candidate)) {
      throw new WorkspaceBoundaryError(path);
    }
    return candidate;
  }

  async #assertExistingPath(path: string): Promise<void> {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      throw new WorkspaceBoundaryError(path);
    }
    const resolved = await realpath(path);
    if (!isInside(this.#root, resolved)) {
      throw new WorkspaceBoundaryError(path);
    }
  }
}

async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function isInside(root: string, candidate: string): boolean {
  const pathRelative = relative(root, candidate);
  return pathRelative === "" || !pathRelative.startsWith("..");
}

function revisionFor(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

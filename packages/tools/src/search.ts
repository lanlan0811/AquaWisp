import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

export interface WorkspaceSearchOptions {
  readonly workspaceRoot: string;
  readonly maximumResults: number;
  readonly maximumFileBytes: number;
}

export interface GrepMatch {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export class WorkspaceSearch {
  readonly #root: string;
  readonly #maximumResults: number;
  readonly #maximumFileBytes: number;

  private constructor(root: string, options: WorkspaceSearchOptions) {
    if (!Number.isInteger(options.maximumResults) || options.maximumResults <= 0) {
      throw new Error("maximumResults must be a positive integer");
    }
    if (!Number.isInteger(options.maximumFileBytes) || options.maximumFileBytes <= 0) {
      throw new Error("maximumFileBytes must be a positive integer");
    }
    this.#root = root;
    this.#maximumResults = options.maximumResults;
    this.#maximumFileBytes = options.maximumFileBytes;
  }

  static async create(options: WorkspaceSearchOptions): Promise<WorkspaceSearch> {
    return new WorkspaceSearch(await realpath(options.workspaceRoot), options);
  }

  async glob(pattern: string): Promise<readonly string[]> {
    const expression = compileGlob(pattern);
    const results: string[] = [];
    for await (const path of this.#files()) {
      if (expression.test(path)) {
        results.push(path);
        if (results.length >= this.#maximumResults) {
          break;
        }
      }
    }
    return results;
  }

  async grep(query: string): Promise<readonly GrepMatch[]> {
    if (query === "") {
      throw new Error("grep query cannot be empty");
    }
    const matches: GrepMatch[] = [];
    for await (const path of this.#files()) {
      const absolute = resolve(this.#root, path);
      const stats = await lstat(absolute);
      if (stats.size > this.#maximumFileBytes) {
        continue;
      }
      const lines = (await readFile(absolute, "utf8")).split(/\r?\n/u);
      for (const [index, text] of lines.entries()) {
        if (text.includes(query)) {
          matches.push({ path, line: index + 1, text });
          if (matches.length >= this.#maximumResults) {
            return matches;
          }
        }
      }
    }
    return matches;
  }

  async *#files(directory = this.#root): AsyncIterable<string> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        yield* this.#files(absolute);
      } else if (entry.isFile()) {
        const path = relative(this.#root, absolute).split(sep).join("/");
        yield path;
      }
    }
  }
}

function compileGlob(pattern: string): RegExp {
  if (pattern === "") {
    throw new Error("glob pattern cannot be empty");
  }
  const normalized = pattern.replaceAll("\\", "/");
  let expression = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === undefined) {
      continue;
    }
    const following = normalized[index + 1];
    if (character === "*" && following === "*") {
      const afterGlobstar = normalized[index + 2];
      if (afterGlobstar === "/") {
        expression += "(?:.*/)?";
        index += 2;
      } else {
        expression += ".*";
        index += 1;
      }
    } else if (character === "*") {
      expression += "[^/]*";
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[|\\{}()[\]^$+*?.]/gu, "\\$&");
    }
  }
  return new RegExp(`${expression}$`, "u");
}

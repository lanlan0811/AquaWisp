import { readdir, readFile, realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";

export interface SkillSummary { readonly name: string; readonly description: string; readonly path: string; readonly metadata: Readonly<Record<string, string>>; }
export interface LoadedSkill extends SkillSummary { readonly instructions: string; }

export class BuiltInSkillLoader {
  readonly #roots: readonly string[];
  private constructor(roots: readonly string[]) { this.#roots = roots; }
  static async create(roots: readonly string[]): Promise<BuiltInSkillLoader> { if (roots.length === 0) throw new Error("At least one built-in skill root is required"); return new BuiltInSkillLoader(await Promise.all(roots.map((root) => realpath(root)))); }
  async list(): Promise<readonly SkillSummary[]> { const paths: string[] = []; for (const root of this.#roots) for await (const path of discoverSkillFiles(root)) paths.push(path); return Promise.all(paths.sort().map((path) => this.#summary(path))); }
  async load(path: string): Promise<LoadedSkill> { if (!this.#roots.some((root) => isInside(root, path))) throw new Error("Skill path is outside built-in roots"); const actual = await realpath(path); if (!this.#roots.some((root) => isInside(root, actual))) throw new Error("Skill path resolves outside built-in roots"); const source = await readFile(actual, "utf8"); const { summary, instructions } = parseSkill(source, actual); return { ...summary, instructions }; }
  async #summary(path: string): Promise<SkillSummary> { const source = await readFile(path, "utf8"); return parseSkill(source, path).summary; }
}

async function* discoverSkillFiles(root: string, directory = root): AsyncIterable<string> { for (const entry of await readdir(directory, { withFileTypes: true })) { const path = resolve(directory, entry.name); if (entry.isSymbolicLink()) continue; if (entry.isDirectory()) yield* discoverSkillFiles(root, path); else if (entry.isFile() && entry.name === "SKILL.md") yield path; } }
function parseSkill(source: string, path: string): { readonly summary: SkillSummary; readonly instructions: string } { const match = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/u.exec(source); if (match?.[1] === undefined || match[2] === undefined) throw new Error(`Skill is missing YAML frontmatter: ${path}`); const metadata = Object.fromEntries(match[1].split("\n").map((line) => line.split(/:\s*/u, 2)).filter(([key, value]) => key !== "" && value !== undefined)); const name = metadata.name; const description = metadata.description; if (name === undefined || description === undefined) throw new Error(`Skill requires name and description: ${path}`); return { summary: { name, description, path, metadata }, instructions: match[2].trim() }; }
function isInside(root: string, path: string): boolean { const value = relative(root, path); return value === "" || !value.startsWith(".."); }

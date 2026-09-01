import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface PromptRegistry {
  readonly sourceDirectory: string;
  readonly outputFile: string;
  readonly sources: readonly string[];
}

interface ProjectRegistry {
  readonly schemaVersion: number;
  readonly workspacePackages: readonly string[];
  readonly prompts: PromptRegistry;
}

interface CompiledPrompt {
  readonly source: string;
  readonly sha256: string;
  readonly content: string;
}

interface PromptBundle {
  readonly schemaVersion: number;
  readonly resourceVersion: string;
  readonly prompts: readonly CompiledPrompt[];
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

describe("M0 project foundation", () => {
  it("registers every workspace package with a source entry", async () => {
    const registry = await readJson<ProjectRegistry>(
      resolve(repositoryRoot, "config", "project.json"),
    );

    expect(registry.schemaVersion).toBe(1);
    expect(new Set(registry.workspacePackages).size).toBe(registry.workspacePackages.length);

    await Promise.all(
      registry.workspacePackages.flatMap((packageDirectory) => [
        access(resolve(repositoryRoot, packageDirectory, "package.json")),
        access(resolve(repositoryRoot, packageDirectory, "src", "index.ts")),
      ]),
    );
  });

  it("keeps the compiled prompt bundle synchronized with its sources", async () => {
    const registry = await readJson<ProjectRegistry>(
      resolve(repositoryRoot, "config", "project.json"),
    );
    const bundle = await readJson<PromptBundle>(
      resolve(repositoryRoot, registry.prompts.outputFile),
    );

    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.prompts.map(({ source }) => source)).toEqual(registry.prompts.sources);

    const aggregateParts: string[] = [];
    for (const prompt of bundle.prompts) {
      const source = await readFile(
        resolve(repositoryRoot, registry.prompts.sourceDirectory, prompt.source),
        "utf8",
      );
      const normalizedSource = source.replaceAll("\r\n", "\n");
      const sourceHash = sha256(normalizedSource);
      expect(prompt.content).toBe(normalizedSource);
      expect(prompt.sha256).toBe(sourceHash);
      aggregateParts.push(`${prompt.source}:${sourceHash}`);
    }

    expect(bundle.resourceVersion).toBe(`sha256:${sha256(aggregateParts.join("\n"))}`);
  });

  it("keeps public README links resolvable inside the repository", async () => {
    const readmePaths = [
      resolve(repositoryRoot, "README.md"),
      resolve(repositoryRoot, "README.en.md"),
    ];
    const markdownLink = /!?\[[^\]]*\]\(([^)]+)\)/g;

    for (const readmePath of readmePaths) {
      const markdown = await readFile(readmePath, "utf8");
      const targets = [...markdown.matchAll(markdownLink)].map((match) => match[1]);
      for (const target of targets) {
        if (target === undefined || /^(?:https?:|mailto:|#)/.test(target)) {
          continue;
        }
        const pathWithoutAnchor = target.split("#", 1)[0];
        if (pathWithoutAnchor === undefined || pathWithoutAnchor === "") {
          throw new Error(`Invalid local link in ${readmePath}: ${target}`);
        }
        await access(resolve(dirname(readmePath), decodeURIComponent(pathWithoutAnchor)));
      }
    }
  });
});

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";

import { loadProjectConfig, resolveInsideRepository } from "./project-config.mjs";

const checkOnly = process.argv.includes("--check");
const config = await loadProjectConfig();
const promptConfig = config.prompts;
const sourceDirectory = resolveInsideRepository(promptConfig.sourceDirectory);
const outputFile = resolveInsideRepository(promptConfig.outputFile);

function hash(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const prompts = [];
for (const source of promptConfig.sources) {
  const sourcePath = resolve(sourceDirectory, source);
  const content = (await readFile(sourcePath, "utf8")).replaceAll("\r\n", "\n");
  prompts.push({
    id: parse(source).name,
    source,
    sha256: hash(content),
    content,
  });
}

const aggregateInput = prompts.map(({ source, sha256 }) => `${source}:${sha256}`).join("\n");
const bundle = {
  schemaVersion: 1,
  resourceVersion: `sha256:${hash(aggregateInput)}`,
  sources: promptConfig.sources,
  prompts,
};
const serialized = `${JSON.stringify(bundle, null, 2)}\n`;

if (checkOnly) {
  let current;
  try {
    current = await readFile(outputFile, "utf8");
  } catch {
    throw new Error(`Prompt bundle is missing. Run npm run prompts: ${promptConfig.outputFile}`);
  }

  if (current !== serialized) {
    throw new Error("Prompt bundle drift detected. Run npm run prompts and commit the result.");
  }
  console.log(`Prompt bundle verified: ${bundle.resourceVersion}`);
} else {
  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, serialized, "utf8");
  console.log(`Prompt bundle generated: ${bundle.resourceVersion}`);
}

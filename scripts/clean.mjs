import { readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { loadProjectConfig, repositoryRoot, resolveInsideRepository } from "./project-config.mjs";

const config = await loadProjectConfig();
const targets = [];
for (const packageDirectory of config.workspacePackages) {
  const packageRoot = resolveInsideRepository(packageDirectory);
  const packageJson = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
  targets.push(resolve(packageRoot, dirname(packageJson.main)));
}

for (const target of targets) {
  const relative = target.slice(repositoryRoot.length);
  if (!relative.startsWith("\\") && !relative.startsWith("/")) {
    throw new Error(`Refusing to clean outside the repository: ${target}`);
  }
  await rm(target, { force: true, recursive: true });
}

console.log(`Removed ${targets.length} generated build directories.`);

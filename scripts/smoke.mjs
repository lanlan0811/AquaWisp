import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadProjectConfig, resolveInsideRepository } from "./project-config.mjs";

const config = await loadProjectConfig();
for (const packageDirectory of config.workspacePackages) {
  const packageJson = JSON.parse(
    await readFile(resolve(resolveInsideRepository(packageDirectory), "package.json"), "utf8"),
  );
  const entryPath = resolve(resolveInsideRepository(packageDirectory), packageJson.main);
  await access(entryPath);
  await import(pathToFileURL(entryPath));
}

await access(resolveInsideRepository(config.prompts.outputFile));
console.log(
  `Smoke check passed for ${config.workspacePackages.length} packages and the prompt bundle.`,
);

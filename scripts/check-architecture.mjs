import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { loadProjectConfig, repositoryRoot, resolveInsideRepository } from "./project-config.mjs";

const config = await loadProjectConfig();
const errors = [];
const packageNames = new Set();

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

for (const packageDirectory of config.workspacePackages) {
  const absoluteDirectory = resolveInsideRepository(packageDirectory);
  const packageJsonPath = resolve(absoluteDirectory, "package.json");
  const sourceEntryPath = resolve(absoluteDirectory, "src", "index.ts");

  if (!(await exists(packageJsonPath))) {
    errors.push(`${packageDirectory} is missing package.json`);
    continue;
  }
  if (!(await exists(sourceEntryPath))) {
    errors.push(`${packageDirectory} is missing src/index.ts`);
  }

  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  if (!packageJson.name?.startsWith(config.packageNamePrefix)) {
    errors.push(`${packageDirectory} must use the ${config.packageNamePrefix} package scope`);
  } else if (packageNames.has(packageJson.name)) {
    errors.push(`duplicate package name: ${packageJson.name}`);
  } else {
    packageNames.add(packageJson.name);
  }
}

for (const scope of config.packageScopes) {
  const scopePath = resolveInsideRepository(scope);
  const entries = await readdir(scopePath, { withFileTypes: true });
  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const packageDirectory = `${scope}/${entry.name}`;
    if (!config.workspacePackages.includes(packageDirectory)) {
      errors.push(`${packageDirectory} is not registered in config/project.json`);
    }
  }
}

const rendererRoot = resolveInsideRepository(config.architecture.rendererSourceDirectory);
if (await exists(rendererRoot)) {
  const pending = [rendererRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (/\.(?:ts|tsx)$/.test(entry.name)) {
        const source = await readFile(entryPath, "utf8");
        for (const forbiddenImport of config.architecture.forbiddenRendererImports) {
          if (
            source.includes(`from "${forbiddenImport}"`) ||
            source.includes(`from '${forbiddenImport}'`)
          ) {
            errors.push(
              `${relative(repositoryRoot, entryPath)} imports forbidden renderer module ${forbiddenImport}`,
            );
          }
        }
      }
    }
  }
}

if (errors.length > 0) {
  throw new Error(`Architecture check failed:\n- ${errors.join("\n- ")}`);
}

console.log(`Architecture check passed for ${config.workspacePackages.length} workspace packages.`);

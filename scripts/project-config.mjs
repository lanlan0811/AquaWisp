import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

export const repositoryRoot = resolve(scriptDirectory, "..");

export async function loadProjectConfig() {
  const registryPath = resolve(repositoryRoot, "config", "project.json");
  const schemaPath = resolve(repositoryRoot, "config", "project.schema.json");
  const [contents, schemaContents] = await Promise.all([
    readFile(registryPath, "utf8"),
    readFile(schemaPath, "utf8"),
  ]);
  const config = JSON.parse(contents);
  const schema = JSON.parse(schemaContents);
  const validator = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  if (!validator(config)) {
    const details = validator.errors
      ?.map(({ instancePath, message }) => `${instancePath || "/"} ${message ?? "is invalid"}`)
      .join("; ");
    throw new Error(`Invalid config/project.json: ${details ?? "schema validation failed"}`);
  }
  return config;
}

export function resolveInsideRepository(relativePath) {
  const resolvedPath = resolve(repositoryRoot, relativePath);
  const relative = resolvedPath.slice(repositoryRoot.length);
  if (relative === "" || (!relative.startsWith("\\") && !relative.startsWith("/"))) {
    throw new Error(`Path escapes the repository: ${relativePath}`);
  }
  return resolvedPath;
}

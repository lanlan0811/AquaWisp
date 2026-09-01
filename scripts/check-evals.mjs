import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const registry = JSON.parse(await readFile(resolve("evals/scenarios.json"), "utf8"));
if (
  registry.schemaVersion !== 1 ||
  !Array.isArray(registry.scenarios) ||
  registry.scenarios.length < 20 ||
  registry.scenarios.length > 50
)
  throw new Error("Evaluation registry must contain 20-50 versioned scenarios");
const ids = new Set(registry.scenarios.map(({ id }) => id));
if (
  ids.size !== registry.scenarios.length ||
  registry.scenarios.some(
    ({ id, category, mode }) =>
      typeof id !== "string" || typeof category !== "string" || mode !== "offline",
  )
)
  throw new Error("Evaluation registry contains invalid scenarios");
console.log(`Evaluation registry verified: ${registry.scenarios.length} offline scenarios.`);

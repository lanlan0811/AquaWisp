import { z } from "zod";

import source from "./runtime-host.data.json" with { type: "json" };

const runtimeHostConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    databaseFileName: z.string().min(1),
    maximumCycles: z.number().int().positive(),
  })
  .strict();

export const runtimeHostConfig = runtimeHostConfigSchema.parse(source);

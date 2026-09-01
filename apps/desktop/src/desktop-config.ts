import { z } from "zod";

import source from "./desktop-config.data.json" with { type: "json" };

const environmentNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/u);

const desktopConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    window: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        minWidth: z.number().int().positive(),
        minHeight: z.number().int().positive(),
        backgroundColor: z.string().regex(/^#[a-fA-F0-9]{6}$/u),
      })
      .strict(),
    runtime: z
      .object({
        workingDirectoryName: z.string().min(1),
        requestTimeoutMs: z.number().int().positive().max(300_000),
        maxLineBytes: z.number().int().positive().max(10_485_760),
        maxStderrBytes: z.number().int().positive().max(1_048_576),
        runAsNodeEnvironmentVariable: environmentNameSchema,
        inheritedEnvironment: z.array(environmentNameSchema),
      })
      .strict()
      .refine(
        ({ inheritedEnvironment }) =>
          new Set(inheritedEnvironment).size === inheritedEnvironment.length,
        { message: "Inherited runtime environment names must be unique" },
      ),
  })
  .strict();

export type DesktopConfig = z.infer<typeof desktopConfigSchema>;
export const desktopConfig: DesktopConfig = desktopConfigSchema.parse(source);

export function createRuntimeEnvironment(
  sourceEnvironment: Readonly<Record<string, string | undefined>>,
  config: DesktopConfig["runtime"],
): Record<string, string> {
  const environment: Record<string, string> = {
    [config.runAsNodeEnvironmentVariable]: "1",
  };
  for (const name of config.inheritedEnvironment) {
    const value = sourceEnvironment[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

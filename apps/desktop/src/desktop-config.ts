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
        runRequestTimeoutMs: z.number().int().positive().max(3_600_000),
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
    secrets: z
      .object({
        fileName: z.string().min(1),
        maxSecretCharacters: z.number().int().positive().max(1_048_576),
        maxCiphertextBytes: z.number().int().positive().max(10_485_760),
      })
      .strict(),
    knowledge: z
      .object({
        maximumFilesPerImport: z.number().int().positive().max(1_000),
        maximumFailureMessageCharacters: z.number().int().positive().max(65_536),
      })
      .strict(),
    executionModes: z
      .array(
        z
          .object({
            id: z.enum(["plan", "work", "full_access"]),
            label: z.string().min(1).max(32),
            description: z.string().min(1).max(256),
            canBeDefault: z.boolean(),
            requiresConfirmation: z.boolean(),
          })
          .strict(),
      )
      .length(3)
      .refine((modes) => new Set(modes.map(({ id }) => id)).size === modes.length, {
        message: "Desktop execution mode ids must be unique",
      })
      .refine(
        (modes) =>
          ["plan", "work", "full_access"].every((id) => modes.some((mode) => mode.id === id)),
        { message: "Desktop execution modes must define plan, work, and full_access" },
      ),
    actionLedger: z
      .object({
        maximumDetailCharacters: z.number().int().positive().max(65_536),
        summaryFields: z
          .array(z.string().min(1).max(64))
          .min(1)
          .refine((fields) => new Set(fields).size === fields.length, {
            message: "Action summary fields must be unique",
          }),
        states: z
          .array(
            z
              .object({
                id: z.enum([
                  "planned",
                  "authorized",
                  "dispatched",
                  "observed",
                  "verified",
                  "unknown",
                  "denied",
                ]),
                label: z.string().min(1).max(32),
              })
              .strict(),
          )
          .length(7)
          .refine((states) => new Set(states.map(({ id }) => id)).size === states.length, {
            message: "Action ledger state ids must be unique",
          }),
        toolIcons: z
          .array(
            z
              .object({
                toolName: z.string().min(1).max(128),
                icon: z.enum(["file", "search", "write", "terminal", "browser"]),
              })
              .strict(),
          )
          .refine((tools) => new Set(tools.map(({ toolName }) => toolName)).size === tools.length, {
            message: "Action ledger tool icon names must be unique",
          }),
      })
      .strict(),
    settings: z
      .object({
        fileName: z.string().min(1),
        defaultProviderId: z.string().min(1),
        defaultModelId: z.string().min(1),
        defaultProtocol: z.enum(["chat_completions", "responses"]),
        defaultReasoningLevel: z.string().min(1),
        defaultSecretName: z.string().min(1),
        defaultMode: z.enum(["plan", "work"]),
      })
      .strict(),
    ipcChannels: z
      .object({
        runtimePing: z.string().min(1),
        secretSet: z.string().min(1),
        secretHas: z.string().min(1),
        secretDelete: z.string().min(1),
        settingsGet: z.string().min(1),
        settingsSet: z.string().min(1),
        conversationStart: z.string().min(1),
        conversationCancel: z.string().min(1),
        conversationEvent: z.string().min(1),
        knowledgeList: z.string().min(1),
        knowledgeAddFiles: z.string().min(1),
        knowledgeRemove: z.string().min(1),
        approvalResolve: z.string().min(1),
      })
      .strict()
      .refine((channels) => {
        const values = Object.values(channels);
        return new Set(values).size === values.length;
      }, "Desktop IPC channels must be unique"),
  })
  .strict()
  .refine(
    (config) =>
      config.executionModes.some(
        (mode) => mode.id === config.settings.defaultMode && mode.canBeDefault,
      ),
    { message: "Desktop default mode must be marked as defaultable" },
  );

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

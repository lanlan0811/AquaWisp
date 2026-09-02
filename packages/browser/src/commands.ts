import { z } from "zod";

import source from "./browser-commands.data.json" with { type: "json" };

const browserCommandCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    commands: z.array(z.string().min(1)),
    readOnlyCommands: z.array(z.string().min(1)),
    limits: z
      .object({
        requestIdCharacters: z.number().int().positive(),
        tabIdCharacters: z.number().int().positive(),
        refCharacters: z.number().int().positive(),
        urlCharacters: z.number().int().positive(),
        selectorCharacters: z.number().int().positive(),
        frameDepth: z.number().int().positive(),
        textCharacters: z.number().int().positive(),
        expressionCharacters: z.number().int().positive(),
        pathCharacters: z.number().int().positive(),
        timeoutMs: z.number().int().positive(),
        scrollDelta: z.number().positive(),
      })
      .strict(),
  })
  .strict()
  .refine(({ commands }) => new Set(commands).size === commands.length, {
    message: "Browser command names must be unique",
  })
  .refine(
    ({ commands, readOnlyCommands }) =>
      new Set(readOnlyCommands).size === readOnlyCommands.length &&
      readOnlyCommands.every((command) => commands.includes(command)),
    {
      message: "Read-only browser commands must be unique catalog commands",
    },
  );

export const browserCommandCatalog = browserCommandCatalogSchema.parse(source);
const { limits } = browserCommandCatalog;
const tabIdSchema = z.string().min(1).max(limits.tabIdCharacters);
const refSchema = z.string().min(1).max(limits.refCharacters);
const textSchema = z.string().max(limits.textCharacters);
const pathSchema = z.string().min(1).max(limits.pathCharacters);
const timeoutSchema = z.number().int().positive().max(limits.timeoutMs);

const commandSchemas = [
  z.object({ kind: z.literal("navigate"), url: z.url().max(limits.urlCharacters) }).strict(),
  z.object({ kind: z.literal("back") }).strict(),
  z.object({ kind: z.literal("forward") }).strict(),
  z.object({ kind: z.literal("reload") }).strict(),
  z
    .object({
      kind: z.literal("waitFor"),
      text: textSchema.optional(),
      ref: refSchema.optional(),
      timeoutMs: timeoutSchema,
    })
    .strict()
    .refine(({ text, ref }) => text !== undefined || ref !== undefined, {
      message: "waitFor requires text or ref",
    }),
  z
    .object({
      kind: z.literal("waitForURL"),
      url: z.string().min(1).max(limits.urlCharacters),
      timeoutMs: timeoutSchema,
    })
    .strict(),
  z.object({ kind: z.literal("snapshot") }).strict(),
  z.object({ kind: z.literal("screenshot"), path: pathSchema }).strict(),
  z.object({ kind: z.literal("elementScreenshot"), ref: refSchema, path: pathSchema }).strict(),
  z
    .object({
      kind: z.literal("evaluate"),
      expression: z.string().min(1).max(limits.expressionCharacters),
    })
    .strict(),
  z.object({ kind: z.literal("getState") }).strict(),
  z.object({ kind: z.literal("click"), ref: refSchema }).strict(),
  z.object({ kind: z.literal("fill"), ref: refSchema, value: textSchema }).strict(),
  z.object({ kind: z.literal("type"), value: textSchema }).strict(),
  z.object({ kind: z.literal("press"), key: z.string().min(1).max(64) }).strict(),
  z.object({ kind: z.literal("hover"), ref: refSchema }).strict(),
  z
    .object({
      kind: z.literal("scroll"),
      deltaX: z.number().min(-limits.scrollDelta).max(limits.scrollDelta),
      deltaY: z.number().min(-limits.scrollDelta).max(limits.scrollDelta),
    })
    .strict(),
  z
    .object({ kind: z.literal("select"), ref: refSchema, values: z.array(textSchema).min(1) })
    .strict(),
  z.object({ kind: z.literal("check"), ref: refSchema, checked: z.boolean() }).strict(),
  z
    .object({ kind: z.literal("newTab"), url: z.url().max(limits.urlCharacters).optional() })
    .strict(),
  z.object({ kind: z.literal("activateTab"), tabId: tabIdSchema }).strict(),
  z.object({ kind: z.literal("listTabs") }).strict(),
  z.object({ kind: z.literal("close"), tabId: tabIdSchema.optional() }).strict(),
  z
    .object({
      kind: z.literal("handleDialog"),
      accept: z.boolean(),
      promptText: textSchema.optional(),
    })
    .strict(),
  z.object({ kind: z.literal("downloadPath") }).strict(),
  z.object({ kind: z.literal("recordingStart"), path: pathSchema }).strict(),
  z.object({ kind: z.literal("recordingStop") }).strict(),
] as const;

export const browserCommandSchema = z.discriminatedUnion("kind", commandSchemas);
export const browserRequestSchema = z
  .object({
    requestId: z.string().min(1).max(limits.requestIdCharacters),
    backendGeneration: z.number().int().positive(),
    tabId: tabIdSchema,
    command: browserCommandSchema,
  })
  .strict();
export const browserCancelRequestSchema = z
  .object({ requestId: z.string().min(1).max(limits.requestIdCharacters) })
  .strict();
export type BrowserCommand = z.infer<typeof browserCommandSchema>;
export type BrowserRequest = z.infer<typeof browserRequestSchema>;

const readOnlyBrowserCommands = new Set(browserCommandCatalog.readOnlyCommands);

export function isReadOnlyBrowserCommand(command: BrowserCommand): boolean {
  return readOnlyBrowserCommands.has(command.kind);
}

const schemaCommandNames = commandSchemas.map((schema) => schema.shape.kind.value);
if (
  schemaCommandNames.length !== browserCommandCatalog.commands.length ||
  schemaCommandNames.some((name) => !browserCommandCatalog.commands.includes(name))
) {
  throw new Error("Browser command schema and catalog are out of sync");
}

export function assertAllowedUrl(value: string, allowedProtocols: readonly string[]): URL {
  const url = new URL(value);
  if (!allowedProtocols.includes(url.protocol)) {
    throw new Error(`Browser URL protocol is not allowed: ${url.protocol}`);
  }
  return url;
}

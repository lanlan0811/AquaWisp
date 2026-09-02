import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";

import { z } from "zod";

import source from "./ingestion-formats.data.json" with { type: "json" };
import { extractOfficeText, type OfficeFormat } from "./office-ingestion.js";

const formatIdSchema = z.enum(["markdown", "text", "html", "docx", "pdf", "xlsx", "pptx"]);
const ingestionConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    limits: z
      .object({
        maximumInputBytes: z.number().int().positive(),
        maximumArchiveEntries: z.number().int().positive(),
        maximumArchiveEntryBytes: z.number().int().positive(),
        maximumArchiveTextBytes: z.number().int().positive(),
        maximumOutputCharacters: z.number().int().positive(),
      })
      .strict(),
    formats: z
      .array(
        z
          .object({
            id: formatIdSchema,
            extensions: z.array(z.string().regex(/^\.[a-z0-9]+$/u)).min(1),
            mimeTypes: z.array(z.string().min(1)).min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine(({ formats }, context) => {
    const ids = formats.map(({ id }) => id);
    const extensions = formats.flatMap(({ extensions: values }) => values);
    const mimeTypes = formats.flatMap(({ mimeTypes: values }) => values);
    if (
      new Set(ids).size !== ids.length ||
      ids.length !== formatIdSchema.options.length ||
      formatIdSchema.options.some((id) => !ids.includes(id))
    ) {
      context.addIssue({
        code: "custom",
        message: "Ingestion format IDs must be unique and complete",
      });
    }
    if (new Set(extensions).size !== extensions.length) {
      context.addIssue({ code: "custom", message: "Ingestion extensions must be unique" });
    }
    if (new Set(mimeTypes).size !== mimeTypes.length) {
      context.addIssue({ code: "custom", message: "Ingestion MIME types must be unique" });
    }
  });

export const ingestionConfig = ingestionConfigSchema.parse(source);
export type SupportedTextFormat = z.infer<typeof formatIdSchema>;

export interface ExtractedText {
  readonly format: SupportedTextFormat;
  readonly text: string;
}

export function extractText(
  format: Extract<SupportedTextFormat, "markdown" | "text" | "html">,
  input: string,
): ExtractedText {
  const text = normalizeWhitespace(
    format === "html" ? htmlToText(input) : format === "markdown" ? markdownToText(input) : input,
  );
  return checkedResult(format, text);
}

export interface ExtractFileOptions {
  readonly path: string;
  readonly mimeType?: string;
}

export async function extractFileText(options: ExtractFileOptions): Promise<ExtractedText> {
  if (options.path.trim() === "") throw new Error("Ingestion path cannot be empty");
  const fileStats = await stat(options.path);
  if (!fileStats.isFile()) throw new Error("Ingestion path must reference a file");
  if (fileStats.size > ingestionConfig.limits.maximumInputBytes) {
    throw new Error("Ingestion file exceeds the configured input limit");
  }
  const definition = resolveFormat(extname(options.path).toLowerCase(), options.mimeType);
  return await extractBufferText(definition.id, await readFile(options.path));
}

export async function extractBufferText(
  format: SupportedTextFormat,
  input: Uint8Array,
): Promise<ExtractedText> {
  if (input.byteLength > ingestionConfig.limits.maximumInputBytes) {
    throw new Error("Ingestion content exceeds the configured input limit");
  }
  if (format === "markdown" || format === "text" || format === "html") {
    return extractText(format, new TextDecoder().decode(input));
  }
  return checkedResult(
    format,
    await extractOfficeText(format satisfies OfficeFormat, input, ingestionConfig.limits),
  );
}

function resolveFormat(extension: string, mimeType?: string) {
  const byExtension = ingestionConfig.formats.find(({ extensions }) =>
    extensions.includes(extension),
  );
  const normalizedMime = mimeType?.split(";", 1)[0]?.trim().toLowerCase();
  const byMime =
    normalizedMime === undefined
      ? undefined
      : ingestionConfig.formats.find(({ mimeTypes }) => mimeTypes.includes(normalizedMime));
  if (byExtension !== undefined && byMime !== undefined && byExtension.id !== byMime.id) {
    throw new Error("Ingestion extension and MIME type disagree");
  }
  const definition = byExtension ?? byMime;
  if (definition === undefined) throw new Error("Unsupported ingestion file format");
  return definition;
}

function checkedResult(format: SupportedTextFormat, input: string): ExtractedText {
  const text = normalizeWhitespace(input);
  if (text.length > ingestionConfig.limits.maximumOutputCharacters) {
    throw new Error("Extracted text exceeds the configured output limit");
  }
  return { format, text };
}

function markdownToText(value: string): string {
  return value
    .replace(/```[\s\S]*?```/gu, (block) => block.replace(/```[a-zA-Z0-9_-]*\n?/u, ""))
    .replace(/!?(?:\[([^\]]*)\]\([^)]*\))/gu, "$1")
    .replace(/^[\s>*#-]+/gmu, "")
    .replace(/[*_`]/gu, "");
}

function htmlToText(value: string): string {
  return decodeEntities(
    value
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/giu, " ")
      .replace(/<br\s*\/?>/giu, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr)>/giu, "\n")
      .replace(/<[^>]+>/gu, " "),
  );
}

function decodeEntities(value: string): string {
  const named: Readonly<Record<string, string>> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/giu, (entity, code: string) => {
    const normalized = code.toLowerCase();
    const numeric = normalized.startsWith("#x")
      ? Number.parseInt(normalized.slice(2), 16)
      : normalized.startsWith("#")
        ? Number.parseInt(normalized.slice(1), 10)
        : undefined;
    if (numeric !== undefined) {
      return Number.isInteger(numeric) && numeric >= 0 && numeric <= 0x10ffff
        ? String.fromCodePoint(numeric)
        : "\uFFFD";
    }
    return named[normalized] ?? entity;
  });
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+/gu, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

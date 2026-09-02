import { strFromU8, unzipSync, type UnzipFileInfo } from "fflate";

interface PdfExtractionModule {
  extractText(
    input: Uint8Array,
    options: { readonly mergePages: true },
  ): Promise<{ readonly text: string | readonly string[] }>;
}

const pdfExtractionModuleName = ["unpdf"].join("");

export interface ArchiveLimits {
  readonly maximumArchiveEntries: number;
  readonly maximumArchiveEntryBytes: number;
  readonly maximumArchiveTextBytes: number;
}

export type OfficeFormat = "docx" | "pdf" | "xlsx" | "pptx";

export async function extractOfficeText(
  format: OfficeFormat,
  input: Uint8Array,
  limits: ArchiveLimits,
): Promise<string> {
  switch (format) {
    case "docx":
      return extractDocx(input, limits);
    case "xlsx":
      return extractXlsx(input, limits);
    case "pptx":
      return extractPptx(input, limits);
    case "pdf":
      return await extractPdf(input);
  }
}

function extractDocx(input: Uint8Array, limits: ArchiveLimits): string {
  const files = unzipSelected(input, limits, ({ name }) =>
    /^(word\/(document|footnotes|endnotes|comments)\.xml|word\/(header|footer)\d+\.xml)$/u.test(
      name,
    ),
  );
  if (files["word/document.xml"] === undefined) {
    throw new Error("DOCX archive does not contain word/document.xml");
  }
  return orderedText(files, (value) => wordXmlToText(decodeXml(value)));
}

function extractPptx(input: Uint8Array, limits: ArchiveLimits): string {
  const files = unzipSelected(input, limits, ({ name }) =>
    /^ppt\/(slides|notesSlides)\/[^/]+\.xml$/u.test(name),
  );
  if (!Object.keys(files).some((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name))) {
    throw new Error("PPTX archive does not contain any slides");
  }
  return orderedText(files, (value) => xmlText(decodeXml(value), "t").join("\n"));
}

function extractXlsx(input: Uint8Array, limits: ArchiveLimits): string {
  const files = unzipSelected(input, limits, ({ name }) =>
    /^(xl\/sharedStrings\.xml|xl\/worksheets\/sheet\d+\.xml)$/u.test(name),
  );
  const sheets = Object.entries(files)
    .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(name))
    .sort(([left], [right]) => naturalCompare(left, right));
  if (sheets.length === 0) throw new Error("XLSX archive does not contain any worksheets");
  const shared = files["xl/sharedStrings.xml"];
  const sharedStrings =
    shared === undefined
      ? []
      : xmlElements(decodeXml(shared), "si").map((value) => xmlText(value, "t").join(""));
  return sheets
    .map(([, value]) => worksheetXmlToText(decodeXml(value), sharedStrings))
    .filter(Boolean)
    .join("\n");
}

async function extractPdf(input: Uint8Array): Promise<string> {
  const pdfModule = (await import(pdfExtractionModuleName)) as PdfExtractionModule;
  const result = await pdfModule.extractText(new Uint8Array(input), { mergePages: true });
  return typeof result.text === "string" ? result.text : result.text.join("\n");
}

function unzipSelected(
  input: Uint8Array,
  limits: ArchiveLimits,
  selected: (file: UnzipFileInfo) => boolean,
): Record<string, Uint8Array> {
  let entryCount = 0;
  let selectedBytes = 0;
  try {
    return unzipSync(input, {
      filter: (file) => {
        entryCount += 1;
        if (entryCount > limits.maximumArchiveEntries) {
          throw new Error("Office archive exceeds the configured entry limit");
        }
        if (!selected(file)) return false;
        if (file.originalSize > limits.maximumArchiveEntryBytes) {
          throw new Error("Office archive entry exceeds the configured size limit");
        }
        selectedBytes += file.originalSize;
        if (selectedBytes > limits.maximumArchiveTextBytes) {
          throw new Error("Office archive text exceeds the configured expansion limit");
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Office archive")) throw error;
    throw new Error("Office archive is invalid or unsupported", { cause: error });
  }
}

function worksheetXmlToText(xml: string, sharedStrings: readonly string[]): string {
  return xmlElements(xml, "row")
    .map((row) =>
      xmlElements(row, "c")
        .map((cell) => {
          const type = xmlAttribute(cell, "t");
          if (type === "inlineStr") return xmlText(cell, "t").join("");
          const value = xmlText(cell, "v")[0] ?? "";
          if (type === "s") {
            const index = Number.parseInt(value, 10);
            return Number.isInteger(index) ? (sharedStrings[index] ?? "") : "";
          }
          if (type === "b") return value === "1" ? "TRUE" : "FALSE";
          return value;
        })
        .join("\t"),
    )
    .filter(Boolean)
    .join("\n");
}

function wordXmlToText(xml: string): string {
  return decodeXmlEntities(
    xml
      .replace(/<(?:[\w-]+:)?tab\b[^>]*\/\s*>/gu, "\t")
      .replace(/<(?:[\w-]+:)?(?:br|cr)\b[^>]*\/\s*>/gu, "\n")
      .replace(/<\/(?:[\w-]+:)?p\s*>/gu, "\n")
      .replace(/<\/(?:[\w-]+:)?tr\s*>/gu, "\n")
      .replace(/<\/(?:[\w-]+:)?tc\s*>/gu, "\t")
      .replace(/<(?:[\w-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?t\s*>/gu, "$1")
      .replace(/<[^>]+>/gu, ""),
  );
}

function orderedText(
  files: Readonly<Record<string, Uint8Array>>,
  extract: (value: Uint8Array) => string,
): string {
  return Object.entries(files)
    .sort(([left], [right]) => naturalCompare(left, right))
    .map(([, value]) => extract(value).trim())
    .filter(Boolean)
    .join("\n");
}

function xmlElements(xml: string, localName: string): string[] {
  const expression = new RegExp(
    `<(?:[\\w-]+:)?${localName}\\b[^>]*>[\\s\\S]*?<\\/(?:[\\w-]+:)?${localName}\\s*>`,
    "gu",
  );
  return [...xml.matchAll(expression)].map(([value]) => value);
}

function xmlText(xml: string, localName: string): string[] {
  const expression = new RegExp(
    `<(?:[\\w-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${localName}\\s*>`,
    "gu",
  );
  return [...xml.matchAll(expression)].map((match) => decodeXmlEntities(match[1] ?? ""));
}

function xmlAttribute(xml: string, attribute: string): string | undefined {
  const openingTag = /^<[^>]+>/u.exec(xml)?.[0];
  if (openingTag === undefined) return undefined;
  return new RegExp(`\\s${attribute}=["']([^"']*)["']`, "u").exec(openingTag)?.[1];
}

function decodeXml(input: Uint8Array): string {
  return strFromU8(input);
}

function decodeXmlEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/giu, (entity, code: string) => {
    const named: Readonly<Record<string, string>> = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
    };
    const normalized = code.toLowerCase();
    if (normalized.startsWith("#x")) return safeCodePoint(Number.parseInt(normalized.slice(2), 16));
    if (normalized.startsWith("#")) return safeCodePoint(Number.parseInt(normalized.slice(1), 10));
    return named[normalized] ?? entity;
  });
}

function safeCodePoint(value: number): string {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff
    ? String.fromCodePoint(value)
    : "\uFFFD";
}

function naturalCompare(left: string, right: string): number {
  return left.localeCompare(right, "en", { numeric: true });
}

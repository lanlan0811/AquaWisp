export type SupportedTextFormat = "markdown" | "text" | "html";

export interface ExtractedText {
  readonly format: SupportedTextFormat;
  readonly text: string;
}

export function extractText(format: SupportedTextFormat, input: string): ExtractedText {
  const text = normalizeWhitespace(
    format === "html" ? htmlToText(input) : format === "markdown" ? markdownToText(input) : input,
  );
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
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
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

export interface ChunkingConfig {
  readonly maximumCharacters: number;
  readonly overlapCharacters: number;
  readonly minimumCharacters: number;
}
export interface TextChunk {
  readonly ordinal: number;
  readonly content: string;
}
export function chunkText(text: string, config: ChunkingConfig): readonly TextChunk[] {
  if (
    config.maximumCharacters <= 0 ||
    config.overlapCharacters < 0 ||
    config.overlapCharacters >= config.maximumCharacters ||
    config.minimumCharacters <= 0
  )
    throw new Error("Invalid chunking configuration");
  const normalized = text.replace(/\r\n?/gu, "\n").trim();
  if (normalized === "") return [];
  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + config.maximumCharacters, normalized.length);
    if (end < normalized.length) {
      const boundary = Math.max(
        normalized.lastIndexOf("\n", end),
        normalized.lastIndexOf("。", end),
        normalized.lastIndexOf(" ", end),
      );
      if (boundary > start + config.minimumCharacters) end = boundary + 1;
    }
    const content = normalized.slice(start, end).trim();
    if (content !== "") chunks.push({ ordinal: chunks.length, content });
    if (end >= normalized.length) break;
    start = end - config.overlapCharacters;
  }
  return chunks;
}
export function segmentChineseForFts(text: string): string {
  return Array.from(text)
    .map((character) => (/[\u3400-\u9fff]/u.test(character) ? `${character} ` : character))
    .join("");
}

export function buildFtsQuery(text: string): string {
  const tokens = segmentChineseForFts(text).match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (tokens.length === 0) throw new Error("Knowledge search query has no searchable terms");
  return tokens.map((token) => `"${token}"`).join(" ");
}

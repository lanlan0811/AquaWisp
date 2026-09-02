import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  HybridKnowledgeIndex,
  KnowledgeBase,
  KnowledgeFileIngestionPipeline,
  SqliteVectorIndex,
} from "@aquawisp/kb";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("M4 file ingestion acceptance", () => {
  it("ingests every planned format and retrieves it with a file source", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aquawisp-file-pipeline-"));
    directories.push(directory);
    const databasePath = join(directory, "knowledge.sqlite");
    const knowledgeBase = new KnowledgeBase({
      databasePath,
      chunking: { maximumCharacters: 1000, overlapCharacters: 100, minimumCharacters: 20 },
    });
    const vectorIndex = new SqliteVectorIndex({
      databasePath,
      namespace: "acceptance",
      dimensions: 2,
    });
    try {
      const hybrid = new HybridKnowledgeIndex({
        knowledgeBase,
        vectorIndex,
        embeddingProvider: {
          dimensions: 2,
          embed: () => Promise.resolve([1, 0]),
        },
      });
      const pipeline = new KnowledgeFileIngestionPipeline(hybrid);
      const fixtures = createFixtures();
      for (const fixture of fixtures) {
        const path = join(directory, `sample.${fixture.extension}`);
        await writeFile(path, fixture.content);
        const ingested = await pipeline.ingest({
          id: `sample-${fixture.format}`,
          path,
          title: `${fixture.format.toUpperCase()} 样例`,
          tags: ["验收"],
          updatedAt: "2026-09-02T00:00:00.000Z",
        });
        expect(ingested.format).toBe(fixture.format);
        expect(ingested.chunks.length).toBeGreaterThan(0);

        const results = await hybrid.search({
          query: fixture.key,
          mode: "full_text",
          limit: 1,
        });
        expect(results[0]?.source).toEqual({
          documentId: `sample-${fixture.format}`,
          uri: pathToFileURL(path).href,
          title: `${fixture.format.toUpperCase()} 样例`,
          ordinal: 0,
          sourceType: "file",
          tags: ["验收"],
          updatedAt: "2026-09-02T00:00:00.000Z",
        });
        expect(results[0]?.highlights[0]?.text).toBe(fixture.key);
      }
    } finally {
      vectorIndex.close();
      knowledgeBase.close();
    }
  });
});

interface FileFixture {
  readonly format: "markdown" | "html" | "docx" | "pdf" | "xlsx" | "pptx";
  readonly extension: string;
  readonly key: string;
  readonly content: string | Uint8Array;
}

function createFixtures(): readonly FileFixture[] {
  return [
    { format: "markdown", extension: "md", key: "MARKDOWNKEY", content: "# MARKDOWNKEY\n知识" },
    { format: "html", extension: "html", key: "HTMLKEY", content: "<h1>HTMLKEY</h1><p>知识</p>" },
    {
      format: "docx",
      extension: "docx",
      key: "DOCXKEY",
      content: officeArchive({
        "word/document.xml":
          '<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>DOCXKEY 知识</w:t></w:r></w:p></w:body></w:document>',
      }),
    },
    { format: "pdf", extension: "pdf", key: "PDFKEY", content: createPdf("PDFKEY knowledge") },
    {
      format: "xlsx",
      extension: "xlsx",
      key: "XLSXKEY",
      content: officeArchive({
        "xl/worksheets/sheet1.xml":
          '<worksheet xmlns="urn:s"><sheetData><row><c t="inlineStr"><is><t>XLSXKEY</t></is></c></row></sheetData></worksheet>',
      }),
    },
    {
      format: "pptx",
      extension: "pptx",
      key: "PPTXKEY",
      content: officeArchive({
        "ppt/slides/slide1.xml":
          '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:t>PPTXKEY</a:t></p:sld>',
      }),
    },
  ];
}

function officeArchive(entries: Readonly<Record<string, string>>): Uint8Array {
  return zipSync(
    Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, strToU8(value)])),
  );
}

function createPdf(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 120 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 180] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream, "ascii").toString()} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body, "ascii"));
    body += `${(index + 1).toString()} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body, "ascii");
  body += `xref\n0 ${(objects.length + 1).toString()}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${offset.toString().padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${(objects.length + 1).toString()} /Root 1 0 R >>\nstartxref\n${xref.toString()}\n%%EOF\n`;
  return strToU8(body);
}

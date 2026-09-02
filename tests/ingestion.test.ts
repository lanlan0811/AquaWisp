import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extractBufferText, extractFileText, extractText, ingestionConfig } from "@aquawisp/kb";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

describe("M4 ingestion extraction", () => {
  it("normalizes Markdown and strips unsafe HTML markup", () => {
    expect(extractText("markdown", "# 标题\n[来源](https://example.test)\n**正文**").text).toBe(
      "标题\n来源\n正文",
    );
    expect(
      extractText("html", "<h1>标题</h1><script>ignore()</script><p>中文 &amp; 内容</p>").text,
    ).toBe("标题\n中文 & 内容");
  });

  it("extracts DOCX body, header, line breaks, and encoded text", async () => {
    const archive = officeArchive({
      "word/document.xml":
        '<w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>正文 &amp; &lt;引用&gt;</w:t></w:r><w:br/><w:r><w:t>第二行</w:t></w:r></w:p></w:body></w:document>',
      "word/header1.xml": '<w:hdr xmlns:w="urn:w"><w:p><w:r><w:t>页眉</w:t></w:r></w:p></w:hdr>',
    });

    await expect(extractBufferText("docx", archive)).resolves.toEqual({
      format: "docx",
      text: "正文 & <引用>\n第二行\n页眉",
    });
  });

  it("extracts XLSX shared, inline, boolean, and numeric cell values", async () => {
    const archive = officeArchive({
      "xl/sharedStrings.xml":
        '<sst xmlns="urn:s"><si><t>项目</t></si><si><r><t>A</t></r><r><t>B</t></r></si></sst>',
      "xl/worksheets/sheet1.xml":
        '<worksheet xmlns="urn:s"><sheetData><row><c t="s"><v>0</v></c><c t="inlineStr"><is><t>数据</t></is></c><c t="b"><v>1</v></c><c><v>42</v></c></row><row><c t="s"><v>1</v></c></row></sheetData></worksheet>',
    });

    await expect(extractBufferText("xlsx", archive)).resolves.toEqual({
      format: "xlsx",
      text: "项目 数据 TRUE 42\nAB",
    });
  });

  it("extracts PPTX slides in numeric order", async () => {
    const archive = officeArchive({
      "ppt/slides/slide10.xml": '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:t>第十页</a:t></p:sld>',
      "ppt/slides/slide2.xml": '<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:t>第二页</a:t></p:sld>',
    });

    await expect(extractBufferText("pptx", archive)).resolves.toEqual({
      format: "pptx",
      text: "第二页\n第十页",
    });
  });

  it("extracts text from a valid PDF", async () => {
    await expect(extractBufferText("pdf", createPdf("PDF knowledge"))).resolves.toEqual({
      format: "pdf",
      text: "PDF knowledge",
    });
  });

  it("resolves formats from file extension and rejects conflicting MIME metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aquawisp-ingestion-"));
    const path = join(directory, "notes.md");
    try {
      await writeFile(path, "# 本地知识\n");
      await expect(extractFileText({ path })).resolves.toEqual({
        format: "markdown",
        text: "本地知识",
      });
      await expect(extractFileText({ path, mimeType: "application/pdf" })).rejects.toThrow(
        "extension and MIME type disagree",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects invalid archives before extraction", async () => {
    await expect(extractBufferText("docx", strToU8("not a zip"))).rejects.toThrow(
      "Office archive is invalid",
    );
    expect(ingestionConfig.formats.map(({ id }) => id)).toEqual([
      "markdown",
      "text",
      "html",
      "docx",
      "pdf",
      "xlsx",
      "pptx",
    ]);
  });
});

function officeArchive(entries: Readonly<Record<string, string>>): Uint8Array {
  return zipSync(
    Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, strToU8(value)])),
  );
}

function createPdf(text: string): Uint8Array {
  const escaped = text.replace(/([()\\])/gu, "\\$1");
  const stream = `BT /F1 12 Tf 72 120 Td (${escaped}) Tj ET`;
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

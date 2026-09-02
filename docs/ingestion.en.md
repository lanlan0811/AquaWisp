# Local file ingestion

`packages/kb` exposes one local-file text extraction boundary for Markdown, plain text, HTML, DOCX, PDF, XLSX, and PPTX. `extractFileText` selects a parser from the extension and an optional MIME type, rejecting conflicting metadata. Callers that already hold bytes can use `extractBufferText`.

`KnowledgeFileIngestionPipeline` is the application-level entry point. It requires an explicit document ID, title, and update timestamp, converts the path to a portable `file:` URI, and connects extraction, chunking, embeddings, FTS5, and vector indexing. Empty extraction fails visibly instead of creating a misleading empty document.

Formats, extensions, MIME types, and resource limits live in `packages/kb/src/ingestion-formats.data.json` and are strictly validated with Zod at module load. A new format requires a registry entry, an implementation, and tests for valid, damaged, and resource-boundary inputs.

## Extraction behavior

- DOCX reads body, header, footer, footnote, endnote, and comment OOXML text while retaining paragraph, line-break, tab, and entity boundaries.
- XLSX reads worksheets in numeric order and handles shared strings, inline strings, booleans, and numeric values.
- PPTX reads DrawingML text in numeric slide order and includes speaker-note text.
- PDF uses the PDF.js engine shipped by the pinned `unpdf` package. It does not require Pandoc, LibreOffice, Microsoft Office, or Python.
- Markdown, HTML, and plain text use deterministic repository-owned cleanup; script and style bodies are excluded from HTML output.

## Safety and portability

The boundary checks that the input is a regular file and enforces an input-byte limit. Before Office entries are inflated, it limits ZIP entry count, individual original size, and cumulative selected text size. Normalized output has a separate character limit.

OOXML uses pure-JavaScript `fflate`, while PDF extraction uses cross-runtime `unpdf`, so Windows and macOS execute the same code path. The extractor never writes files, runs macros, reaches the network, or follows Office external relationships. File selection and database mutation remain subject to workspace and tool policy.

Scanned PDFs and image-only Office content do not yet run OCR. Callers must surface empty extraction as requiring OCR or manual handling instead of claiming complete ingestion.

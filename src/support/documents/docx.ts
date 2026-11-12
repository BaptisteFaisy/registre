/**
 * Minimal WordprocessingML (.docx) writer and reader, built on the ZIP container.
 *
 * A `.docx` is an OPC package holding three parts: `[Content_Types].xml`,
 * `_rels/.rels` and `word/document.xml`. Paragraphs map to lines (split on
 * `\n`) and a page break (`\f`) maps to `<w:br w:type="page"/>`, so the text
 * round-trips exactly: `textFromDocx(docxFromText(text)) === text`.
 *
 * The reader is a deterministic twin of Bedrock Data Automation's text
 * extraction: it concatenates `<w:t>` runs inside each paragraph, joins
 * paragraphs with `\n` and turns `<w:br w:type="page"/>` back into `\f`.
 *
 * All text nodes are XML-escaped (`&`, `<`, `>`, `"`, `'`); the helpers are
 * exported so the sibling OOXML module (`xlsx.ts`) reuses them instead of
 * re-implementing escaping.
 */

import { zipEntries, unzipEntries, type ZipEntry } from './zip.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Escapes the five XML special characters so text survives a round-trip. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Inverse of {@link escapeXml}: decodes the five XML special characters. */
export function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

/** Builds a real .docx archive carrying `text` as WordprocessingML paragraphs. */
export function docxFromText(text: string): Uint8Array {
  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', bytes: encoder.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', bytes: encoder.encode(RELS) },
    { name: 'word/document.xml', bytes: encoder.encode(documentXml(text)) }
  ];
  return zipEntries(entries);
}

/** Extracts the text back out of a .docx archive (paragraphs + page breaks). */
export function textFromDocx(bytes: Uint8Array): string {
  const parts = unzipEntries(bytes);
  const document = parts.get('word/document.xml');
  if (!document) throw new Error('docx: missing word/document.xml');
  return paragraphTexts(decoder.decode(document));
}

function documentXml(text: string): string {
  const body = text
    .split('\n')
    .map((line) => paragraphXml(line))
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body}<w:sectPr/></w:body>
</w:document>`;
}

function paragraphXml(line: string): string {
  const segments = line
    .split('\f')
    .map((segment, index) => {
      const runs = [];
      if (index > 0) runs.push('<w:r><w:br w:type="page"/></w:r>');
      if (segment.length > 0) runs.push(`<w:r><w:t xml:space="preserve">${escapeXml(segment)}</w:t></w:r>`);
      return runs.join('');
    })
    .join('');
  return `<w:p>${segments}</w:p>`;
}

function paragraphTexts(xml: string): string {
  const paragraphs = xml.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) ?? [];
  return paragraphs.map((paragraph) => runsToText(paragraph)).join('\n');
}

function runsToText(paragraph: string): string {
  let out = '';
  for (const match of paragraph.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:br\b[^>]*\/>/g)) {
    if (match[1] !== undefined) out += unescapeXml(match[1]!);
    else out += '\f';
  }
  return out;
}

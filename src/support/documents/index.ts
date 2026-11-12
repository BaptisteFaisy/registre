/**
 * Public surface of the document-format module.
 *
 * Two halves, one place: the deterministic WRITERS that build the real binary
 * demonstration corpus (PDF, DOCX, XLSX, PNG, ZIP), and the EXTRACTORS the
 * offline pipeline uses to read those same bytes back. Keeping both sides
 * together is what guarantees the round trip: a format change cannot silently
 * break the offline demo.
 */

export { bytesOf, concatBytes, crc32, deflate, inflate, LeWriter } from './bits.ts';
export { extractPdfText, pdfFromText } from './pdf.ts';
export { docxFromText, escapeXml, textFromDocx, unescapeXml } from './docx.ts';
export { rowsFromXlsx, xlsxFromRows } from './xlsx.ts';
export { pngFromLines, pngSize } from './png.ts';
export { unzipEntries, zipEntries } from './zip.ts';
export type { ZipEntry } from './zip.ts';
export { csvFromRows, extractText, fileNameFromUri, mimeTypeOf, sniffFormat } from './extract.ts';
export type { DocumentFormat, ExtractHint } from './extract.ts';

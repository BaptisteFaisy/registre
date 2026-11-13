/**
 * Format-aware text extraction for the offline pipeline.
 *
 * The demonstration corpus carries real binaries (PDF, DOCX, XLSX, PNG, CSV).
 * The offline readers must extract their text without a third-party parser, so
 * each format has a deterministic extractor here — the same bytes the vault
 * would hand to Bedrock Data Automation in the deployed pipeline.
 *
 * PNG is the one honest exception: reading pixels offline would mean OCR, which
 * a deterministic mock must not fake. Screenshots therefore carry a text twin in
 * the offline manifest (`demo/data/offline-text.json`), passed through
 * `ExtractHint.twins`; on AWS, Data Automation reads the image itself. A
 * screenshot with no twin is reported as unreadable, never guessed (EF-LEC-04).
 */

import { textFromDocx } from './docx.ts';
import { extractPdfText } from './pdf.ts';
import { rowsFromXlsx } from './xlsx.ts';
import { unzipEntries } from './zip.ts';
import { unreadable } from '../errors.ts';

/** Formats the offline extractor understands. */
export type DocumentFormat = 'pdf' | 'docx' | 'xlsx' | 'png' | 'csv' | 'text';

/** What the caller knows about the document, all optional. */
export interface ExtractHint {
  /** Original file name; its extension is the weakest signal, magic bytes win. */
  fileName?: string | null;
  /** Declared content type (`text/csv`, `application/pdf`, ...). */
  contentType?: string | null;
  /** Offline text twins, keyed by file name (screenshots only). */
  twins?: ReadonlyMap<string, string> | null;
}

/** MIME types of the corpus, by extension. */
const MIME_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  png: 'image/png',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown'
};

/** MIME type of a file name; unknown extensions fall back to `text/plain`. */
export function mimeTypeOf(fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  return MIME_TYPES[extension] ?? 'text/plain';
}

/**
 * File name of a storage URI (`file:///a/b/policy.pdf`, `s3://vault/policy.pdf`)
 * or of a bare name. Used to pick the offline text twin of a screenshot.
 */
export function fileNameFromUri(uri: string | null | undefined): string | null {
  if (!uri) return null;
  const withoutQuery = uri.split('?')[0] ?? uri;
  // Both separators: a local deposit on Windows is a backslash path.
  const last = withoutQuery.split(/[\\/]/).filter((part) => part.length > 0).pop();
  return last ?? null;
}

/** Extension of a file name, lower-cased, empty when there is none. */
function extensionOf(fileName: string | null | undefined): string {
  if (!fileName) return '';
  const base = fileName.split('/').pop() ?? fileName;
  return base.includes('.') ? (base.split('.').pop() ?? '').toLowerCase() : '';
}

/**
 * Detects the format from the magic bytes, falling back to the declared content
 * type and then to the extension. Bytes win: a mislabelled upload is read as
 * what it is, not as what it claims to be.
 */
export function sniffFormat(bytes: Uint8Array, hint: ExtractHint = {}): DocumentFormat {
  const fromBytes = formatFromMagic(bytes);
  if (fromBytes !== null) return fromBytes;
  const declared = formatFromContentType(hint.contentType);
  if (declared !== null) return declared;
  const extension = extensionOf(hint.fileName);
  if (extension === 'csv') return 'csv';
  if (extension === 'png' || extension === 'pdf' || extension === 'docx' || extension === 'xlsx') {
    return extension;
  }
  return 'text';
}

/** Format from the first bytes, or null when they are not conclusive. */
function formatFromMagic(bytes: Uint8Array): DocumentFormat | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return 'pdf';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'png';
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return formatFromZipEntries(bytes);
  return null;
}

/** A ZIP is a DOCX or an XLSX depending on the parts it carries. */
function formatFromZipEntries(bytes: Uint8Array): DocumentFormat | null {
  try {
    const names = [...unzipEntries(bytes).keys()];
    if (names.some((name) => name.startsWith('word/'))) return 'docx';
    if (names.some((name) => name.startsWith('xl/'))) return 'xlsx';
  } catch {
    return null;
  }
  return null;
}

/** Format from a declared content type, or null when it says nothing. */
function formatFromContentType(contentType: string | null | undefined): DocumentFormat | null {
  if (!contentType) return null;
  const value = contentType.toLowerCase();
  if (value.includes('pdf')) return 'pdf';
  if (value.includes('png')) return 'png';
  if (value.includes('wordprocessingml') || value.includes('msword')) return 'docx';
  if (value.includes('spreadsheetml') || value.includes('excel')) return 'csv';
  if (value.includes('csv')) return 'csv';
  return null;
}

/** True when the buffer starts with the given bytes. */
function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((value, index) => bytes[index] === value);
}

/**
 * Extracts the text of a document, whatever its format.
 *
 * The returned text is what the offline readers parse: `Key: value` header lines
 * followed by the body, with form feeds between pages (EF-LEC-01).
 */
export function extractText(bytes: Uint8Array, hint: ExtractHint = {}): string {
  const format = sniffFormat(bytes, hint);
  switch (format) {
    case 'pdf':
      return extractPdfText(bytes);
    case 'docx':
      return textFromDocx(bytes);
    case 'xlsx':
      return csvFromRows(rowsFromXlsx(bytes));
    case 'csv':
      return decodeUtf8(bytes);
    case 'png':
      return twinText(bytes, hint);
    default:
      return decodeUtf8(bytes);
  }
}

/** Text twin of a screenshot; a screenshot without a twin is unreadable. */
function twinText(bytes: Uint8Array, hint: ExtractHint): string {
  const twin = hint.fileName ? hint.twins?.get(hint.fileName) : undefined;
  if (twin === undefined || twin.trim().length === 0) {
    throw unreadable(
      `a screenshot has no offline text twin (${hint.fileName ?? 'unknown file'}): the scripted reader does not do OCR`,
      { fileName: hint.fileName ?? null, bytes: bytes.length }
    );
  }
  return twin;
}

/** Joins spreadsheet rows into the flat CSV text the readers expect. */
export function csvFromRows(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.join(',')).join('\n');
}

/** UTF-8 decoding of raw bytes. */
function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

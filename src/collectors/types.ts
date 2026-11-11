/**
 * Collector contract (EF-COL-01..05, EF-COL-07 later).
 *
 * A collector is the only way a new document enters the product. It produces
 * `CollectedFile`s — bytes plus provenance — and never touches the state store
 * or the vault: the pipeline decides what to keep, `runCollectors` deduplicates
 * by fingerprint, and `LocalEvidenceStore` stores the bytes.
 *
 * "Collectors are replaceable: one interface per source type" (chapter 7).
 */

import type { CollectorKind, ControlId } from '../domain/types.ts';
import { badRequest } from '../support/errors.ts';
import { sha256Bytes } from '../support/hash.ts';

/** Where a collection run starts and stops (EF-COL-03: a period). */
export interface CollectorCursor {
  /** Inclusive lower bound, ISO-8601. */
  since?: string;
  /** Inclusive upper bound, ISO-8601. */
  until?: string;
  /** Collector-defined resume token (S3 continuation token, page offset). */
  token?: string;
}

/** One document produced by a collector, ready to be fingerprinted and stored. */
export interface CollectedFile {
  /** Stable vault key, e.g. `s3/documents/policy.pdf`. */
  key: string;
  /** Where the bytes came from, journalled and shown in the evidence detail. */
  uri: string;
  kind: CollectorKind;
  contentType: string;
  bytes: Uint8Array;
  /** Fingerprint of `bytes`, computed by `collectedFile` (EF-COL-05). */
  sha256: string;
  sizeBytes: number;
  collectedAt: string;
  title?: string;
  /** Control the deposit targets, when the source knows it (EF-COL-02). */
  controlId?: ControlId;
  /** File-level date, cross-checked against the document date (EF-LEC-04). */
  fileDate?: string | null;
  /** Free-form provenance, journalled but never read by the reader. */
  metadata?: Record<string, string>;
}

/** Every collector implements exactly this (chapter 11.2). */
export interface Collector {
  readonly id: string;
  readonly kind: CollectorKind;
  /** Produces the files available for this cursor (EF-COL-01..05). */
  collect(cursor?: CollectorCursor): Promise<CollectedFile[]>;
}

/** Input of `collectedFile`, without the two derived fields. */
export type CollectedFileInput = Omit<CollectedFile, 'sha256' | 'sizeBytes'>;

/** Builds a `CollectedFile`, computing the fingerprint once, in one place. */
export function collectedFile(input: CollectedFileInput): CollectedFile {
  if (input.bytes.byteLength === 0) {
    throw badRequest('collector: refusing to collect an empty file', { key: input.key });
  }
  return { ...input, sha256: sha256Bytes(input.bytes), sizeBytes: input.bytes.byteLength };
}

/** UTF-8 bytes of a generated document (exports, reports). */
export function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** `YYYY-MM-DD` of an ISO instant, used to date generated files. */
export function dayOf(instant: string): string {
  return instant.slice(0, 10);
}

/** Makes a file name safe for a vault key. */
export function safeName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned : 'file';
}

/** Content type guessed from the extension, when the source does not say. */
export function contentTypeFor(name: string): string {
  const extension = name.toLowerCase().split('.').pop() ?? '';
  const known: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv',
    json: 'application/json',
    txt: 'text/plain',
    md: 'text/markdown',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg'
  };
  return known[extension] ?? 'application/octet-stream';
}

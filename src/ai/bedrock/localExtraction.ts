/**
 * Formats Data Automation does not take — EF-LEC-01.
 *
 * Data Automation reads documents and images (PDF, PNG, JPEG, TIFF). It refuses
 * spreadsheets, CSV exports and plain text ("The format of the input file isn't
 * supported"), yet those are a large share of MSP evidence (access reviews,
 * patch reports, ticket exports). Their text is structured already, so it is
 * extracted by code — the same deterministic extraction the offline reader uses
 * (`support/documents`) — with no model call, and the reading costs nothing.
 *
 * The bytes come from the vault (S3), so the step stays stateless.
 */

import type { S3Client } from '@aws-sdk/client-s3';
import type { CostMeter, ReadInput, ReadResult } from '../../ports/index.ts';
import { upstream } from '../../support/errors.ts';
import { createScriptedReader, splitHeader } from '../mock/scriptedReader.ts';
import { extractText, fileNameFromUri } from '../../support/documents/index.ts';
import { recordCost } from './costs.ts';
import { parseS3Uri } from './dataAutomationApi.ts';

/** Reader id of a code-extracted reading, reported in `Evidence.reader` and costs. */
export const LOCAL_EXTRACTION_ID = 'code-extraction';

const LOCAL_EXTENSIONS = new Set(['csv', 'xlsx', 'txt', 'md', 'json']);
const LOCAL_TYPES = /csv|spreadsheetml|ms-excel|^text\/|json/i;

/** True when the evidence is a format Data Automation refuses (by type, then extension). */
export function needsLocalExtraction(contentType: string, uri: string): boolean {
  if (LOCAL_TYPES.test(contentType)) return true;
  const leaf = uri.replace(/#.*$/, '').split('/').pop() ?? '';
  const extension = leaf.includes('.') ? (leaf.split('.').pop() ?? '').toLowerCase() : '';
  return LOCAL_EXTENSIONS.has(extension);
}

/** Raw bytes of one vault object. */
export async function readObjectBytes(client: S3Client, s3Uri: string): Promise<Uint8Array> {
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const { bucket, key } = parseS3Uri(s3Uri);
  const versionId = /#(.+)$/.exec(s3Uri)?.[1];
  try {
    const response = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key, ...(versionId ? { VersionId: versionId } : {}) })
    );
    const bytes = await response.Body?.transformToByteArray();
    if (!bytes) throw new Error('empty body');
    return bytes;
  } catch (error) {
    throw upstream(`cannot read evidence bytes: ${(error as Error).message}`, { s3Uri });
  }
}

/** True when the text opens with a front-matter block of `Key: value` lines. */
export function hasHeaderBlock(text: string): boolean {
  return Object.keys(splitHeader(text).headers).length > 0;
}

/** Reads a structured evidence by code; its cost is recorded at zero (ENF-COUT-01). */
export async function readLocally(
  input: ReadInput,
  loadBytes: () => Promise<Uint8Array>,
  meter?: CostMeter
): Promise<ReadResult> {
  const bytes = input.bytes ?? (await loadBytes());
  // A workbook that opens with a `Key: value` block (title, date, author…) is a
  // document, not a raw export: read its header instead of counting rows.
  const headed = hasHeaderBlock(extractText(bytes, { fileName: fileNameFromUri(input.uri), contentType: input.contentType }));
  const reader = createScriptedReader({ id: LOCAL_EXTRACTION_ID, ...(headed ? { contentType: 'text/plain' } : {}) });
  const result = await reader.read({ ...input, bytes });
  const cost = recordCost(meter, { usd: 0, tokensIn: 0, tokensOut: 0, source: LOCAL_EXTRACTION_ID });
  return { ...result, cost };
}

/**
 * `EvidenceReader` backed by Bedrock Data Automation — EF-LEC-01..04.
 *
 * One reading = one asynchronous invocation of the custom blueprint
 * (`prompts/readerBlueprint.ts`), a bounded wait, then the JSON result read from
 * S3. Sensitive-data detection is enabled by the blueprint, so the access level
 * is derived from the extracted fields by `reading.ts` (ENF-CONF-01).
 *
 * Spreadsheets, CSV and plain text, which Data Automation refuses, are read by
 * code instead (`localExtraction.ts`).
 *
 * The API surface lives in `dataAutomationApi.ts`; this file only orchestrates
 * and maps the result onto `EvidenceFields` (Annex B).
 */

import type { CostMeter, EvidenceReader, ReadInput, ReadResult } from '../../ports/index.ts';
import type { EvidenceFields, Settings } from '../../domain/types.ts';
import { upstream } from '../../support/errors.ts';
import { buildPeriod, buildReadFlags, inferAccessLevel, joinPages, normaliseEvidenceType, safeDate, splitPages, summarise } from '../reading.ts';
import { createDataAutomationClient, createS3Client } from './client.ts';
import { POLL_TIMEOUT_MS, dataAutomationTarget, readDocumentOutput, startInvocation, waitForInvocation } from './dataAutomationApi.ts';
import { readingCost, recordCost } from './costs.ts';
import { needsLocalExtraction, readLocally, readObjectBytes } from './localExtraction.ts';

/** Log prefix shared by every Bedrock adapter (ENF-OBS-01). */
export const LOG_PREFIX = '[ai:bedrock]';

export interface DataAutomationReaderOptions {
  env?: NodeJS.ProcessEnv;
  /** Bounded wait of one reading; defaults to the API module ceiling. */
  timeoutMs?: number;
  /** Shared meter; the reading cost is recorded there (ENF-COUT-01). */
  meter?: CostMeter;
}

/** Picks the first defined value among several key spellings. */
function pick(source: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return null;
}

function asText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number') return String(value);
  return null;
}

/**
 * Text of a Data Automation standard output: the document representation, or
 * its pages joined with form feeds (one page per ``).
 */
function standardOutputText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const root = payload as { pages?: unknown; document?: { representation?: Record<string, unknown> } };
  if (Array.isArray(root.pages)) {
    const pages = root.pages
      .map((page) => representationText((page as { representation?: Record<string, unknown> })?.representation))
      .filter((value): value is string => value !== null);
    if (pages.length > 0) return pages.join('');
  }
  return representationText(root.document?.representation) ?? '';
}

/** Plain text of one representation block (text, else markdown). */
function representationText(representation: Record<string, unknown> | undefined): string | null {
  if (!representation) return null;
  return asText(pick(representation, ['text', 'markdown']));
}

/** Finds the custom-output block of a Data Automation result, tolerantly. */
export function customOutput(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {};
  const root = payload as Record<string, unknown>;
  const list = Array.isArray(root.custom_output) ? root.custom_output : Array.isArray(payload) ? payload : [];
  const first = list.find((item) => item && typeof item === 'object') ?? root;
  return first as Record<string, unknown>;
}

/** Extracted plain text of the document, when the result carries it. */
export function extractText(payload: unknown): string {
  const standard = standardOutputText(payload);
  if (standard) return standard;
  const block = customOutput(payload);
  const direct = asText(pick(block, ['text', 'content', 'transcript', 'markdown']));
  if (direct) return direct;
  const pages = block.pages;
  if (Array.isArray(pages)) {
    return pages
      .map((page) => (page && typeof page === 'object' ? asText(pick(page as Record<string, unknown>, ['text', 'content'])) : null))
      .filter((value): value is string => Boolean(value))
      .join('\f');
  }
  return '';
}

/**
 * Maps the blueprint output onto the Annex B fields (EF-LEC-01).
 * `text` is passed in when the caller already extracted it, so the result is
 * parsed once per reading.
 */
export function fieldsFromOutput(payload: unknown, text = extractText(payload)): EvidenceFields {
  const block = customOutput(payload);
  const raw = (block.fields && typeof block.fields === 'object' ? block.fields : block) as Record<string, unknown>;
  return {
    type: normaliseEvidenceType(asText(pick(raw, ['evidenceType', 'type', 'evidence_type', 'documentType']))),
    title: asText(pick(raw, ['title', 'documentTitle', 'name'])),
    documentDate: safeDate(asText(pick(raw, ['documentDate', 'document_date', 'date']))),
    period: buildPeriod(
      asText(pick(raw, ['periodStart', 'period_start', 'startDate'])),
      asText(pick(raw, ['periodEnd', 'period_end', 'endDate']))
    ),
    version: asText(pick(raw, ['version', 'revision'])),
    author: asText(pick(raw, ['author', 'owner', 'preparedBy'])),
    approver: asText(pick(raw, ['approver', 'approvedBy', 'signatory'])),
    approvalDate: safeDate(asText(pick(raw, ['approvalDate', 'approval_date', 'signedOn']))),
    client: asText(pick(raw, ['client', 'customer', 'clientName'])),
    summary: asText(pick(raw, ['summary', 'abstract'])) ?? summarise(text),
    personalData: Boolean(pick(raw, ['personalData', 'personal_data', 'containsPersonalData']))
  };
}

/**
 * Reader backed by Data Automation (EF-LEC-01).
 * Fails with `upstream(...)` on any service error, after logging it (ENF-OBS-01).
 */
export class DataAutomationReader implements EvidenceReader {
  readonly id = 'bedrock-data-automation';
  private readonly settings: Settings;
  private readonly options: DataAutomationReaderOptions;

  constructor(settings: Settings, options: DataAutomationReaderOptions = {}) {
    this.settings = settings;
    this.options = options;
  }

  async read(input: ReadInput): Promise<ReadResult> {
    if (!input.uri.startsWith('s3://')) {
      throw upstream('Data Automation reads S3 objects only; upload the evidence to the vault first', {
        evidenceId: input.evidenceId,
        uri: input.uri
      });
    }
    if (needsLocalExtraction(input.contentType, input.uri)) {
      const s3 = await createS3Client(this.settings);
      return readLocally(input, () => readObjectBytes(s3, input.uri), this.options.meter);
    }
    const env = this.options.env ?? process.env;
    const target = dataAutomationTarget(env, this.settings.readerModel);
    const runtime = await createDataAutomationClient(this.settings);
    const arn = await startInvocation(runtime, { inputS3Uri: input.uri, target, token: input.evidenceId });
    const state = await waitForInvocation(runtime, arn, this.options.timeoutMs ?? POLL_TIMEOUT_MS);
    if (state.status === 'Failed') {
      console.error(`${LOG_PREFIX} reading failed for ${input.evidenceId}: ${state.failureMessage ?? 'unknown'}`);
      throw upstream('Data Automation: reading failed', {
        evidenceId: input.evidenceId,
        reason: state.failureMessage ?? 'unknown'
      });
    }
    const outputUri = state.outputS3Uri ?? joinOutputUri(target.outputS3Uri, arn);
    const payload = await readDocumentOutput(await createS3Client(this.settings), outputUri);
    return this.toResult(input, payload);
  }

  /** Turns a raw result into a `ReadResult` (flags and level computed by code). */
  private toResult(input: ReadInput, payload: unknown): ReadResult {
    const extracted = extractText(payload);
    const textPages = splitPages(extracted);
    const text = joinPages(textPages);
    const fields = fieldsFromOutput(payload, text);
    const accessLevel = inferAccessLevel(fields);
    const flags = buildReadFlags({ fields, text, fileDate: input.fileDate ?? null });
    console.info(`${LOG_PREFIX} read ${input.evidenceId}: ${textPages.length} page(s), level ${accessLevel}`);
    return {
      fields,
      flags,
      textPages,
      accessLevel,
      cost: recordCost(this.options.meter, readingCost(this.settings.readerModel, textPages.length))
    };
  }
}

/** Last-resort output location when the service returns none. */
function joinOutputUri(base: string, arn: string): string {
  const leaf = arn.split('/').pop() ?? 'result';
  return `${base.replace(/\/$/, '')}/${leaf}/0/job_metadata.json`;
}

/** Factory used by `createBedrockAi` (EF-LEC-01). */
export function createDataAutomationReader(
  settings: Settings,
  options: DataAutomationReaderOptions = {}
): EvidenceReader {
  return new DataAutomationReader(settings, options);
}

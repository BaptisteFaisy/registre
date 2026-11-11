/**
 * Annex C / Annex D shapes: JSON Schemas for structured output and the ONE
 * parser both the Bedrock reasoner and the mock reasoner use.
 *
 * Why one parser: a model can omit a key, send a string instead of a number or
 * return a control id that was never proposed. Rejecting or repairing that is a
 * code rule (ENF-IA-04), so it lives here, is tested offline, and no adapter
 * re-implements it.
 *
 * The parser accepts either a bare array (as the prompt asks) or an object
 * wrapping it (`{"attachments": [...]}`, `{"elements": [...]}`), because some
 * models only emit an object at the root.
 */

import type { ProposedAttachment } from '../ports/index.ts';
import type { SufficiencyElement } from '../domain/types.ts';
import { upstream } from '../support/errors.ts';
import { normalizeText } from '../support/normalize.ts';

/** Minimum length of a quotable passage (mirrors the prompt contract). */
export const MIN_QUOTE_CHARS = 8;

/** JSON Schema sent to `Converse` for attachment proposals (Annex C). */
export const ATTACHMENT_JSON_SCHEMA = JSON.stringify({
  type: 'array',
  description: 'One entry per candidate control, Annex C of the specification.',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['controlId', 'supports', 'confidence', 'quote', 'page', 'reason'],
    properties: {
      controlId: { type: 'string' },
      supports: { type: 'boolean' },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      quote: { type: 'string' },
      page: { type: ['integer', 'null'] },
      reason: { type: 'string' }
    }
  }
});

/** JSON Schema sent to `Converse` for sufficiency elements (Annex D). */
export const SUFFICIENCY_JSON_SCHEMA = JSON.stringify({
  type: 'array',
  description: 'One entry per expected item, Annex D of the specification.',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['expected', 'present', 'quote'],
    properties: {
      expected: { type: 'string' },
      present: { type: 'boolean' },
      quote: { type: ['string', 'null'] }
    }
  }
});

/** JSON Schema sent to `Converse` for a grounded answer (EF-QR-01). */
export const ANSWER_JSON_SCHEMA = JSON.stringify({
  type: 'object',
  additionalProperties: false,
  required: ['text', 'citations'],
  properties: {
    text: { type: 'string' },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['evidenceId', 'quote', 'page'],
        properties: {
          evidenceId: { type: 'string' },
          quote: { type: 'string' },
          page: { type: ['integer', 'null'] }
        }
      }
    }
  }
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Unwraps a root object that carries the array under a known key. */
function toArray(payload: unknown, keys: readonly string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload)) {
    for (const key of keys) {
      const value = payload[key];
      if (Array.isArray(value)) return value;
    }
  }
  return [];
}

/** True when `value` has the Annex C element shape. */
export function isProposedAttachment(value: unknown): value is ProposedAttachment {
  if (!isRecord(value)) return false;
  return (
    typeof value.controlId === 'string' &&
    value.controlId.length > 0 &&
    typeof value.supports === 'boolean' &&
    typeof value.confidence === 'number' &&
    Number.isFinite(value.confidence) &&
    typeof value.quote === 'string' &&
    typeof value.reason === 'string' &&
    (value.page === null || typeof value.page === 'number')
  );
}

/**
 * Clamps a confidence into 0..1; a model sometimes answers in percent.
 * A value above 1 is read as a percentage (1.7 -> 0.017): when in doubt, the
 * lower confidence wins, which sends the attachment to human review.
 */
export function normaliseConfidence(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const scaled = numeric > 1 && numeric <= 100 ? numeric / 100 : numeric;
  return Math.min(1, Math.max(0, Math.round(scaled * 1000) / 1000));
}

/** Normalises one element, or null when the shape is unusable. */
function toProposal(value: unknown): ProposedAttachment | null {
  if (!isRecord(value)) return null;
  if (typeof value.controlId !== 'string' || value.controlId.length === 0) return null;
  const supports = value.supports === true;
  const quote = typeof value.quote === 'string' ? value.quote.trim() : '';
  const page = typeof value.page === 'number' && Number.isFinite(value.page) ? Math.trunc(value.page) : null;
  return {
    controlId: value.controlId,
    supports,
    confidence: normaliseConfidence(value.confidence),
    quote,
    page,
    reason: typeof value.reason === 'string' ? value.reason.trim() : ''
  };
}

/**
 * Parses a model answer into Annex C proposals (EF-RAT-01/02).
 * Unknown control ids are dropped: a model may only answer about the
 * candidates it was given; a proposal without a usable quote is downgraded to
 * `supports: false` because code verifies the quote anyway (EF-RAT-02).
 */
export function parseAttachmentProposals(
  payload: unknown,
  allowedControlIds: readonly string[] = []
): ProposedAttachment[] {
  const items = toArray(payload, ['attachments', 'proposals', 'results']);
  const allowed = new Set(allowedControlIds);
  const out: ProposedAttachment[] = [];
  for (const item of items) {
    const proposal = toProposal(item);
    if (!proposal) continue;
    if (allowed.size > 0 && !allowed.has(proposal.controlId)) continue;
    if (proposal.supports && proposal.quote.length < MIN_QUOTE_CHARS) {
      out.push({ ...proposal, supports: false, confidence: 0, quote: '', reason: 'No quotable passage returned' });
      continue;
    }
    out.push(proposal);
  }
  return out;
}

/** Parses a JSON string, throwing `upstream` when the model returned prose. */
export function parseJsonPayload(text: string, context: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = trimmed.search(/[[{]/);
  if (start < 0) throw upstream(`${context}: model returned no JSON`, { preview: trimmed.slice(0, 120) });
  try {
    return JSON.parse(trimmed.slice(start)) as unknown;
  } catch (error) {
    throw upstream(`${context}: model returned invalid JSON: ${(error as Error).message}`, {
      preview: trimmed.slice(0, 120)
    });
  }
}

/**
 * Reconciles model elements with the expected list (EF-SUF-01).
 * Every expected item appears once and in order; an item the model forgot is
 * `present: false`, so a missing answer never looks like a present element.
 */
export function parseSufficiencyElements(payload: unknown, expected: readonly string[]): SufficiencyElement[] {
  const items = toArray(payload, ['elements', 'results']);
  const byKey = new Map<string, { present: boolean; quote: string | null }>();
  for (const item of items) {
    if (!isRecord(item) || typeof item.expected !== 'string') continue;
    const quote = typeof item.quote === 'string' && item.quote.trim().length > 0 ? item.quote.trim() : null;
    const present = item.present === true && quote !== null && quote.length >= MIN_QUOTE_CHARS;
    byKey.set(normalizeText(item.expected), { present, quote: present ? quote : null });
  }
  return expected.map((name) => {
    const found = byKey.get(normalizeText(name));
    return { expected: name, present: found?.present ?? false, quote: found?.quote ?? null };
  });
}

/** One citation of a draft answer, before the guardrail checks it. */
export interface DraftCitation {
  evidenceId: string;
  quote: string;
  page: number | null;
}

/** A parsed draft answer (EF-QR-01). */
export interface ParsedDraftAnswer {
  text: string;
  citations: DraftCitation[];
}

/**
 * Parses a model answer into a draft (EF-QR-01, EF-QR-02).
 * Citations pointing at a passage that was not retrieved, or carrying a quote
 * too short to verify, are dropped: the composer never cites what it did not see.
 */
export function parseDraftAnswer(payload: unknown, allowedEvidenceIds: readonly string[] = []): ParsedDraftAnswer {
  if (!isRecord(payload)) {
    return { text: typeof payload === 'string' ? payload.trim() : '', citations: [] };
  }
  const allowed = new Set(allowedEvidenceIds);
  const rawCitations = Array.isArray(payload.citations) ? payload.citations : [];
  const citations: DraftCitation[] = [];
  for (const item of rawCitations) {
    if (!isRecord(item)) continue;
    const evidenceId = typeof item.evidenceId === 'string' ? item.evidenceId : '';
    const quote = typeof item.quote === 'string' ? item.quote.trim() : '';
    if (!evidenceId || quote.length < MIN_QUOTE_CHARS) continue;
    if (allowed.size > 0 && !allowed.has(evidenceId)) continue;
    const page = typeof item.page === 'number' && Number.isFinite(item.page) ? Math.trunc(item.page) : null;
    citations.push({ evidenceId, quote, page });
  }
  const text = typeof payload.text === 'string' ? payload.text.trim() : '';
  return { text, citations };
}

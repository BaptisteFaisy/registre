/**
 * Mock state engine: freshness, sufficiency and control states (chapter 12).
 *
 * The real engine lives in the backend (`src/domain/engine.ts`); this copy
 * keeps the same rules so the portal behaves identically offline. Dates and
 * counts are always computed here, never guessed (ENF-IA-04).
 */

import type {
  Attachment,
  Control,
  ControlState,
  ControlStatus,
  CostReport,
  Evidence,
  EvidenceFreshness,
  ReadinessSnapshot,
  ReadinessTrendPoint,
  Sufficiency,
  SufficiencyClass
} from '../api/types.ts';
import { emptyCounts } from '../lib/states.ts';
import type { EvidenceSpec } from './evidenceSpecs.ts';

const DAY_MS = 86_400_000;

/** Quote that is deliberately absent from the document (citation check). */
export const UNVERIFIED_QUOTE = 'The backup job completed successfully at 03:12.';

/** Adds an ISO-8601 duration ("P3M", "P1Y", "P30D") to an ISO date. */
export function addDuration(dateIso: string, periodicity: string): string | null {
  const match = /^P(\d+)([DWMY])$/.exec(periodicity.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  const date = new Date(`${dateIso.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (unit === 'D') return new Date(date.getTime() + amount * DAY_MS).toISOString();
  if (unit === 'W') return new Date(date.getTime() + amount * 7 * DAY_MS).toISOString();
  if (unit === 'M') date.setUTCMonth(date.getUTCMonth() + amount);
  else date.setUTCFullYear(date.getUTCFullYear() + amount);
  return date.toISOString();
}

/** Expiry of an evidence against a control periodicity (EF-FRA-01). */
export function expiryOf(evidence: Evidence, control: Control): string | null {
  const base = evidence.fields.period.end ?? evidence.fields.documentDate;
  if (!base) return null;
  return addDuration(base, control.periodicity);
}

/** Freshness of an expiry date with a renewal lead time (chapter 12.2). */
export function freshnessOf(
  expiry: string | null,
  now: string,
  leadDays: number
): EvidenceFreshness {
  if (!expiry) return 'UNDETERMINED';
  const remaining = new Date(expiry).getTime() - new Date(now).getTime();
  if (Number.isNaN(remaining)) return 'UNDETERMINED';
  if (remaining < 0) return 'EXPIRED';
  if (remaining < leadDays * DAY_MS) return 'TO_RENEW';
  return 'FRESH';
}

/** First sentence of the first page, used as the attachment citation. */
export function pickQuote(evidence: Evidence): { quote: string; page: number } {
  const page = evidence.textPages[0];
  if (!page) return { quote: '', page: 1 };
  const sentence = page.text.split(/(?<=\.)\s/)[0] ?? page.text;
  return { quote: sentence.slice(0, 220), page: page.page };
}

/** Builds the attachment of one evidence to one control (Annex C). */
export function buildAttachment(
  spec: EvidenceSpec,
  evidence: Evidence,
  controlId: string,
  frameworkId: string,
  index: number,
  threshold: number
): Attachment {
  const status = spec.status ?? 'APPLIED';
  const confidence = spec.confidence ?? (status === 'APPLIED' ? 0.93 : 0.61);
  const citation = pickQuote(evidence);
  const citationVerified = spec.citationOk !== false;
  const attachment: Attachment = {
    id: `at-${String(index).padStart(3, '0')}`,
    evidenceId: evidence.id,
    controlId,
    frameworkId,
    supports: true,
    confidence,
    quote: citationVerified ? citation.quote : UNVERIFIED_QUOTE,
    quoteLocation: { page: citation.page },
    reason: spec.note ?? `The cited passage states the expectation of ${controlId}.`,
    status,
    citationVerified,
    autoApplied: status === 'APPLIED' && confidence >= threshold,
    model: 'structured-output-reasoner',
    createdAt: `${evidence.ingestedAt.slice(0, 10)}T07:20:00.000Z`
  };
  if (!citationVerified) attachment.rejectionReason = 'CITATION_NOT_FOUND';
  return attachment;
}

/** Element-by-element sufficiency of an attachment (Annex D). */
export function buildSufficiency(
  attachment: Attachment,
  control: Control,
  evidence: Evidence,
  spec: EvidenceSpec,
  index: number,
  now: string
): Sufficiency {
  const missing = new Set(spec.missing ?? []);
  const elements = control.expectedEvidence.map((expected) => {
    const present = !missing.has(expected);
    return { expected, present, quote: present ? attachment.quote : null };
  });
  const absent = elements.filter((element) => !element.present).map((element) => element.expected);
  let klass: SufficiencyClass = 'COMPLETE';
  if (absent.length > 0) klass = 'PARTIAL';
  else if (attachment.confidence < 0.6) klass = 'TO_VERIFY';
  return {
    id: `sf-${String(index).padStart(3, '0')}`,
    attachmentId: attachment.id,
    evidenceId: evidence.id,
    controlId: control.id,
    elements,
    class: klass,
    missing: absent,
    computedAt: now
  };
}

interface StatusInput {
  control: Control;
  attachments: Attachment[];
  sufficiencies: Sufficiency[];
  evidenceById: Map<string, Evidence>;
  now: string;
  leadDays: number;
}

interface BestEvidence {
  attachment: Attachment;
  evidence: Evidence | undefined;
  expiry: string | null;
  freshness: EvidenceFreshness;
  sufficiency: Sufficiency | null;
}

/** State of a control, doubt always falling to "to verify" (chapter 12.3). */
export function computeStatus(input: StatusInput): ControlStatus {
  const { control, attachments, sufficiencies, evidenceById, now, leadDays } = input;
  const applied = attachments.filter((item) => item.status === 'APPLIED' && item.supports);
  const proposed = attachments.filter((item) => item.status === 'PROPOSED');
  const notes: string[] = [];

  if (applied.length === 0) {
    if (proposed.length > 0) notes.push('only-proposed-attachments');
    return makeStatus(control, proposed.length > 0 ? 'TO_VERIFY' : 'NO_EVIDENCE', now, {
      freshness: 'UNDETERMINED',
      sufficiencyClass: null,
      bestEvidenceId: null,
      expiresAt: null,
      pendingProposals: proposed.length,
      notes
    });
  }

  const scored = applied
    .map((attachment) => scoreAttachment(attachment, control, sufficiencies, evidenceById, now, leadDays))
    .sort((a, b) => (b.expiry ?? '').localeCompare(a.expiry ?? ''));
  const best = scored[0];

  if (!best) {
    return makeStatus(control, 'TO_VERIFY', now, {
      freshness: 'UNDETERMINED',
      sufficiencyClass: null,
      bestEvidenceId: null,
      expiresAt: null,
      pendingProposals: proposed.length,
      notes
    });
  }
  if (best.freshness === 'EXPIRED') notes.push('every-applied-evidence-expired');
  if (best.freshness === 'TO_RENEW') notes.push('best-evidence-expires-soon');
  if (best.sufficiency?.class === 'PARTIAL') notes.push('partial-sufficiency');
  if (best.sufficiency?.class === 'TO_VERIFY') notes.push('low-confidence-sufficiency');
  if (proposed.length > 0) notes.push('pending-proposals');
  notes.push(...readWarnings(best.evidence));

  return makeStatus(control, stateOf(best), now, {
    freshness: best.freshness,
    sufficiencyClass: best.sufficiency?.class ?? null,
    bestEvidenceId: best.attachment.evidenceId,
    expiresAt: best.expiry,
    pendingProposals: proposed.length,
    notes
  });
}

function scoreAttachment(
  attachment: Attachment,
  control: Control,
  sufficiencies: readonly Sufficiency[],
  evidenceById: Map<string, Evidence>,
  now: string,
  leadDays: number
): BestEvidence {
  const evidence = evidenceById.get(attachment.evidenceId);
  const expiry = evidence ? expiryOf(evidence, control) : null;
  return {
    attachment,
    evidence,
    expiry,
    freshness: freshnessOf(expiry, now, leadDays),
    sufficiency: sufficiencies.find((item) => item.attachmentId === attachment.id) ?? null
  };
}

/** Derives the state from the best applied evidence (chapter 12.3). */
function stateOf(best: BestEvidence): ControlState {
  if (best.freshness === 'EXPIRED') return 'EXPIRED';
  if (best.freshness === 'TO_RENEW') return 'TO_RENEW';
  const klass = best.sufficiency?.class ?? null;
  if (klass !== 'COMPLETE') return 'TO_VERIFY';
  if (readWarnings(best.evidence).length > 0) return 'TO_VERIFY';
  return 'COVERED';
}

/** Reading warnings that prevent a control from being considered covered. */
export function readWarnings(evidence: Evidence | undefined): string[] {
  if (!evidence) return ['evidence-missing'];
  const warnings: string[] = [];
  if (evidence.flags.unreadable) warnings.push('evidence-unreadable');
  if (evidence.flags.missingDate) warnings.push('document-date-missing');
  if (evidence.flags.dateToConfirm) warnings.push('document-date-to-confirm');
  if (!evidence.fields.approver) warnings.push('document-not-signed');
  if (evidence.locations.some((location) => location.duplicate)) warnings.push('duplicate-location');
  return warnings;
}

interface StatusRest {
  freshness: EvidenceFreshness;
  sufficiencyClass: SufficiencyClass | null;
  bestEvidenceId: string | null;
  expiresAt: string | null;
  pendingProposals: number;
  notes: string[];
}

function makeStatus(
  control: Control,
  state: ControlState,
  now: string,
  rest: StatusRest
): ControlStatus {
  return {
    controlId: control.id,
    frameworkId: control.frameworkId,
    state,
    freshness: rest.freshness,
    sufficiencyClass: rest.sufficiencyClass,
    bestEvidenceId: rest.bestEvidenceId,
    expiresAt: rest.expiresAt,
    pendingProposals: rest.pendingProposals,
    notes: rest.notes,
    computedAt: now
  };
}

/* --------------------------------------------------------------- readiness */

/** Readiness snapshot of a framework (EF-FRA-03). */
export function computeSnapshot(
  frameworkId: string,
  statuses: readonly ControlStatus[],
  now: string
): ReadinessSnapshot {
  const counts = emptyCounts();
  for (const status of statuses) counts[status.state] += 1;
  const total = statuses.length;
  const shares = emptyCounts();
  for (const state of Object.keys(shares) as Array<keyof typeof shares>) {
    shares[state] = total === 0 ? 0 : Math.round((counts[state] / total) * 10_000) / 10_000;
  }
  return { frameworkId, computedAt: now, total, counts, shares };
}

/** Counts per state for each domain of the framework. */
export function computeByDomain(
  controls: readonly Control[],
  statuses: readonly ControlStatus[]
): Record<string, { total: number; counts: Record<ControlState, number> }> {
  const byControl = new Map(statuses.map((item) => [item.controlId, item]));
  const result: Record<string, { total: number; counts: Record<ControlState, number> }> = {};
  for (const control of controls) {
    const bucket = result[control.domain] ?? { total: 0, counts: emptyCounts() };
    const current = byControl.get(control.id);
    if (current) bucket.counts[current.state] += 1;
    bucket.total += 1;
    result[control.domain] = bucket;
  }
  return result;
}

/** Six monthly points ending at `now`, derived backwards from the snapshot. */
export function buildTrend(
  snapshot: ReadinessSnapshot,
  now: string
): ReadinessTrendPoint[] {
  const drift: Array<Partial<Record<ControlState, number>>> = [
    { COVERED: -5, TO_RENEW: 1, TO_VERIFY: 2, EXPIRED: 1, NO_EVIDENCE: 1 },
    { COVERED: -4, TO_RENEW: 0, TO_VERIFY: 2, EXPIRED: 1, NO_EVIDENCE: 1 },
    { COVERED: -3, TO_RENEW: 1, TO_VERIFY: 1, EXPIRED: 1, NO_EVIDENCE: 0 },
    { COVERED: -2, TO_RENEW: 1, TO_VERIFY: 0, EXPIRED: 1, NO_EVIDENCE: 0 },
    { COVERED: -1, TO_RENEW: 0, TO_VERIFY: 1, EXPIRED: 0, NO_EVIDENCE: 0 },
    { COVERED: 0, TO_RENEW: 0, TO_VERIFY: 0, EXPIRED: 0, NO_EVIDENCE: 0 }
  ];
  const reference = new Date(now);
  return drift.map((offset, index) => {
    const counts = { ...snapshot.counts };
    for (const state of Object.keys(counts) as Array<ControlState>) {
      const delta = offset[state] ?? 0;
      counts[state] = delta < 0 ? Math.max(0, counts[state] + delta) : counts[state] + delta;
    }
    const at = new Date(reference);
    at.setUTCMonth(at.getUTCMonth() - (drift.length - 1 - index));
    return { frameworkId: snapshot.frameworkId, at: at.toISOString(), counts };
  });
}

/** Cost per evidence and per reader (ENF-COUT-01). */
export function computeCosts(evidence: readonly Evidence[]): CostReport {
  const bySource: Record<string, number> = {};
  let total = 0;
  for (const item of evidence) {
    if (!item.cost) continue;
    total += item.cost.usd;
    bySource[item.cost.source] = (bySource[item.cost.source] ?? 0) + item.cost.usd;
  }
  const round = (value: number): number => Math.round(value * 10_000) / 10_000;
  const sources: Record<string, number> = {};
  for (const [key, value] of Object.entries(bySource)) sources[key] = round(value);
  return {
    totalUsd: round(total),
    perEvidenceUsd: evidence.length === 0 ? 0 : round(total / evidence.length),
    evidenceCount: evidence.length,
    bySource: sources
  };
}

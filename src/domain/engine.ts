/**
 * Freshness and state engine (chapters 12 & 13 of the specification).
 *
 * Non-negotiable rule (ENF-IA-04):
 * "States, dates and counts are ALWAYS computed by code.
 *  The language model computes none of them."
 *
 * Functions are pure, small (< 50 lines), deterministic, and tested offline.
 */

import type {
  Attachment,
  Control,
  ControlState,
  ControlStatus,
  Evidence,
  EvidenceFreshness,
  FrameworkId,
  ReadinessSnapshot,
  Sufficiency,
  SufficiencyClass,
  SufficiencyElement
} from './types.ts';
import { addDuration, daysBetween } from '../support/iso8601.ts';

/* ------------------------------------------------------------- 1. quotes */

/**
 * Searches the quoted passage inside the full evidence text.
 * The spec: "A missing citation cancels the attachment."
 */
export function verifyQuote(
  evidenceText: string,
  quote: string
): { found: boolean; page: number | null } {
  const trimmed = quote.trim();
  if (trimmed.length < 8) return { found: false, page: null };
  const haystack = evidenceText.toLowerCase().replace(/\s+/g, ' ');
  const needle = trimmed.toLowerCase().replace(/\s+/g, ' ');
  return { found: haystack.includes(needle), page: null };
}

/* --------------------------------------------------------- 2. sufficiency */

/**
 * Computes the sufficiency class from element-by-element findings.
 * COMPLETE: all expected elements present, each with a verifiable quote.
 * PARTIAL: at least one element missing.
 * TO_VERIFY: empty expectations, unreadable text, or low confidence.
 */
export function computeSufficiencyClass(
  elements: readonly SufficiencyElement[],
  confidence = 1
): { class: SufficiencyClass; missing: string[] } {
  if (elements.length === 0 || confidence < 0.6) {
    return { class: 'TO_VERIFY', missing: [] };
  }
  const missing = elements.filter((e) => !e.present).map((e) => e.expected);
  if (missing.length === 0) {
    return { class: 'COMPLETE', missing: [] };
  }
  return { class: 'PARTIAL', missing };
}

/* ---------------------------------------------------------- 3. freshness */

/**
 * Resolves the reference date of an evidence for freshness calculations.
 * For periodic exports, the period end date is used (spec chapter 12.2).
 */
export function referenceDate(evidence: Pick<Evidence, 'fields' | 'flags'>): string | null {
  if (evidence.flags.unreadable) return null;
  const periodEnd = evidence.fields.period.end;
  if (periodEnd) return periodEnd;
  return evidence.fields.documentDate ?? evidence.fields.approvalDate ?? null;
}

/**
 * Computes the expiry date: reference date + control periodicity.
 * Returns null if no date could be extracted from the evidence.
 */
export function computeExpiryDate(evidence: Pick<Evidence, 'fields' | 'flags'>, periodicity: string): string | null {
  const ref = referenceDate(evidence);
  if (!ref) return null;
  try {
    return addDuration(ref, periodicity);
  } catch {
    return null;
  }
}

/**
 * Freshness of one evidence against one control at `now`:
 * FRESH: expires strictly more than 30 days in the future.
 * TO_RENEW: expires within 30 days (or today).
 * EXPIRED: expiry is strictly in the past.
 * UNDETERMINED: no readable date.
 */
export function computeFreshness(
  evidence: Pick<Evidence, 'fields' | 'flags'>,
  periodicity: string,
  now: string,
  leadDays = 30
): { freshness: EvidenceFreshness; expiresAt: string | null } {
  const expiresAt = computeExpiryDate(evidence, periodicity);
  if (!expiresAt) return { freshness: 'UNDETERMINED', expiresAt: null };
  const daysLeft = daysBetween(now, expiresAt);
  if (daysLeft < 0) return { freshness: 'EXPIRED', expiresAt };
  if (daysLeft <= leadDays) return { freshness: 'TO_RENEW', expiresAt };
  return { freshness: 'FRESH', expiresAt };
}

/* ------------------------------------------------------ 4. control state */

export interface ControlEvaluationInput {
  control: Control;
  attachments: Attachment[];
  evidences: Map<string, Evidence>;
  sufficiencies: Map<string, Sufficiency>;
  isTypeValidated: boolean;
  now: string;
  leadDays?: number;
}

type Candidate = {
  evidence: Evidence;
  attachment: Attachment;
  freshness: EvidenceFreshness;
  expiresAt: string | null;
  sufficiency: Sufficiency | null;
};

/**
 * Evaluates one control per the matrix in spec chapter 12.3:
 * COVERED     - applied evidence, fresh, complete sufficiency (+ human review if mandatory first time)
 * TO_RENEW    - best applied evidence expires within 30 days
 * TO_VERIFY   - only proposed attachments, or partial sufficiency, or unconfirmed mandatory
 * EXPIRED     - all applied evidences are expired
 * NO_EVIDENCE - no applied evidence
 */
export function evaluateControl(input: ControlEvaluationInput): ControlStatus {
  const { control, attachments, evidences, sufficiencies, isTypeValidated, now, leadDays = 30 } = input;
  const applied = attachments.filter((a) => a.status === 'APPLIED' && a.supports);
  const proposed = attachments.filter((a) => a.status === 'PROPOSED');
  const notes: string[] = [];

  if (applied.length === 0) {
    const state: ControlState = proposed.length > 0 ? 'TO_VERIFY' : 'NO_EVIDENCE';
    if (proposed.length > 0) notes.push(`${proposed.length} proposed attachment(s) pending review`);
    return makeStatus(control, state, 'UNDETERMINED', null, null, null, proposed.length, notes, now);
  }

  const candidates = collectCandidates(applied, evidences, sufficiencies, control.periodicity, now, leadDays);
  if (candidates.length === 0) {
    return makeStatus(control, 'NO_EVIDENCE', 'UNDETERMINED', null, null, null, proposed.length, notes, now);
  }

  candidates.sort((a, b) => candidateRank(b) - candidateRank(a) || compareExpiry(b.expiresAt, a.expiresAt));
  const best = candidates[0]!;

  return deriveFinalState(control, best, candidates, isTypeValidated, proposed.length, notes, now);
}

function collectCandidates(
  applied: Attachment[],
  evidences: Map<string, Evidence>,
  sufficiencies: Map<string, Sufficiency>,
  periodicity: string,
  now: string,
  leadDays: number
): Candidate[] {
  const out: Candidate[] = [];
  for (const att of applied) {
    const ev = evidences.get(att.evidenceId);
    if (!ev) continue;
    const { freshness, expiresAt } = computeFreshness(ev, periodicity, now, leadDays);
    const suf = sufficiencies.get(att.id) ?? null;
    out.push({ evidence: ev, attachment: att, freshness, expiresAt, sufficiency: suf });
  }
  return out;
}

function deriveFinalState(
  control: Control,
  best: Candidate,
  all: Candidate[],
  isTypeValidated: boolean,
  pendingCount: number,
  notes: string[],
  now: string
): ControlStatus {
  if (best.evidence.flags.dateToConfirm || best.evidence.flags.missingDate) {
    notes.push('Evidence date must be confirmed before covering the control');
    return makeStatus(control, 'TO_VERIFY', best.freshness, best.sufficiency?.class ?? null, best.evidence.id, best.expiresAt, pendingCount, notes, now);
  }

  const sufClass = best.sufficiency?.class ?? 'TO_VERIFY';
  if (control.mandatory && sufClass === 'COMPLETE' && !isTypeValidated) {
    notes.push('Mandatory control requires first human validation for this evidence type');
    return makeStatus(control, 'TO_VERIFY', best.freshness, sufClass, best.evidence.id, best.expiresAt, pendingCount, notes, now);
  }

  if (best.freshness === 'FRESH' && sufClass === 'COMPLETE') {
    return makeStatus(control, 'COVERED', 'FRESH', 'COMPLETE', best.evidence.id, best.expiresAt, pendingCount, notes, now);
  }
  if (best.freshness === 'TO_RENEW') {
    return makeStatus(control, 'TO_RENEW', 'TO_RENEW', sufClass, best.evidence.id, best.expiresAt, pendingCount, notes, now);
  }
  if (sufClass === 'PARTIAL' || sufClass === 'TO_VERIFY' || best.freshness === 'UNDETERMINED') {
    return makeStatus(control, 'TO_VERIFY', best.freshness, sufClass, best.evidence.id, best.expiresAt, pendingCount, notes, now);
  }

  const allExpired = all.every((c) => c.freshness === 'EXPIRED');
  const state: ControlState = allExpired ? 'EXPIRED' : 'TO_VERIFY';
  return makeStatus(control, state, best.freshness, sufClass, best.evidence.id, best.expiresAt, pendingCount, notes, now);
}

function candidateRank(c: { freshness: EvidenceFreshness; sufficiency: Sufficiency | null }): number {
  let score = 0;
  if (c.freshness === 'FRESH') score += 100;
  else if (c.freshness === 'TO_RENEW') score += 50;
  else if (c.freshness === 'EXPIRED') score += 10;
  if (c.sufficiency?.class === 'COMPLETE') score += 20;
  else if (c.sufficiency?.class === 'PARTIAL') score += 10;
  return score;
}

function compareExpiry(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return a.localeCompare(b);
}

function makeStatus(
  control: Control,
  state: ControlState,
  freshness: EvidenceFreshness,
  sufficiencyClass: SufficiencyClass | null,
  bestEvidenceId: string | null,
  expiresAt: string | null,
  pendingProposals: number,
  notes: string[],
  now: string
): ControlStatus {
  return {
    controlId: control.id,
    frameworkId: control.frameworkId,
    state,
    freshness,
    sufficiencyClass,
    bestEvidenceId,
    expiresAt,
    pendingProposals,
    notes,
    computedAt: now
  };
}

/* ---------------------------------------------------- 5. readiness math */

/**
 * Computes counts and percentages for a framework (spec chapter 4.1).
 * Shares sum to 1 (except rounding).
 */
export function computeReadiness(
  frameworkId: FrameworkId,
  statuses: readonly ControlStatus[],
  now: string
): ReadinessSnapshot {
  const counts: Record<ControlState, number> = {
    COVERED: 0,
    TO_RENEW: 0,
    TO_VERIFY: 0,
    EXPIRED: 0,
    NO_EVIDENCE: 0
  };
  for (const s of statuses) counts[s.state] += 1;
  const total = statuses.length;
  const shares: Record<ControlState, number> = {
    COVERED: total === 0 ? 0 : Math.round((counts.COVERED / total) * 10000) / 10000,
    TO_RENEW: total === 0 ? 0 : Math.round((counts.TO_RENEW / total) * 10000) / 10000,
    TO_VERIFY: total === 0 ? 0 : Math.round((counts.TO_VERIFY / total) * 10000) / 10000,
    EXPIRED: total === 0 ? 0 : Math.round((counts.EXPIRED / total) * 10000) / 10000,
    NO_EVIDENCE: total === 0 ? 0 : Math.round((counts.NO_EVIDENCE / total) * 10000) / 10000
  };
  return { frameworkId, computedAt: now, total, counts, shares };
}

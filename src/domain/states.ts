/**
 * Control state engine — EF-FRA-02 (spec 12.3 matrix, 12.4 prudence rules).
 *
 * 12.3: COVERED = at least one applied, fresh, complete evidence;
 *       TO_RENEW = the best evidence is within the renewal window;
 *       TO_VERIFY = only proposed attachments, or partial sufficiency;
 *       EXPIRED = every applied evidence is expired;
 *       NO_EVIDENCE = no applied evidence.
 * 12.4: doubt always falls to TO_VERIFY, never to COVERED; an evidence without
 *       a readable date cannot cover; a mandatory control whose sufficiency is
 *       complete needs one human validation per evidence type first.
 */

import type {
  Attachment,
  Control,
  ControlState,
  ControlStatus,
  Evidence,
  EvidenceFreshness,
  Sufficiency,
  SufficiencyClass
} from './types.ts';
import { computeFreshness, RENEWAL_LEAD_DAYS } from './freshness.ts';

/** Machine-readable note codes carried by `ControlStatus.notes` — EF-FRA-02. */
export const STATE_NOTES = {
  proposedPending: 'proposed-attachments-pending-review',
  evidenceUnreadable: 'evidence-unreadable',
  dateToConfirm: 'evidence-date-to-confirm',
  dateMissing: 'evidence-date-missing',
  mandatoryFirstValidation: 'mandatory-first-validation-required',
  sufficiencyIncomplete: 'sufficiency-not-complete',
  expiresSoon: 'best-evidence-expires-soon',
  expired: 'applied-evidence-expired'
} as const;

/** Human sentence for each note code, used by packs, reminders and the portal — EF-FRA-02. */
export const STATE_NOTE_TEXT: Readonly<Record<string, string>> = {
  [STATE_NOTES.proposedPending]: 'proposed attachments are pending review',
  [STATE_NOTES.evidenceUnreadable]: 'the evidence could not be read',
  [STATE_NOTES.dateToConfirm]: 'the evidence date must be confirmed before it can cover the control',
  [STATE_NOTES.dateMissing]: 'the evidence carries no readable date',
  [STATE_NOTES.mandatoryFirstValidation]: 'a mandatory control needs a first human validation for this evidence type',
  [STATE_NOTES.sufficiencyIncomplete]: 'the expected evidence elements are not all present',
  [STATE_NOTES.expiresSoon]: 'the best evidence expires within the renewal window',
  [STATE_NOTES.expired]: 'the applied evidence is expired'
};

/** Everything the state engine needs about one control. */
export interface ControlEvaluationInput {
  control: Control;
  attachments: Attachment[];
  evidences: Map<string, Evidence>;
  sufficiencies: Map<string, Sufficiency>;
  /** True when a human already validated this (control, evidence type) pair — EF-SUF-03. */
  isTypeValidated: boolean;
  now: string;
  leadDays?: number;
}

/** One applied evidence, scored for the control. */
interface Candidate {
  evidence: Evidence;
  attachment: Attachment;
  freshness: EvidenceFreshness;
  expiresAt: string | null;
  sufficiency: Sufficiency | null;
}

/** Evaluates one control per chapter 12.3 and the 12.4 prudence rules — EF-FRA-02. */
export function evaluateControl(input: ControlEvaluationInput): ControlStatus {
  const applied = input.attachments.filter((a) => a.status === 'APPLIED' && a.supports);
  const pending = input.attachments.filter((a) => a.status === 'PROPOSED').length;
  if (applied.length === 0) return withoutEvidence(input.control, pending, input.now);
  const candidates = collectCandidates(applied, input);
  if (candidates.length === 0) return withoutEvidence(input.control, pending, input.now);
  return statusForBest(input.control, pickBest(candidates), candidates, input.isTypeValidated, pending, input.now);
}

/** NO_EVIDENCE, or TO_VERIFY when proposals are waiting for a human — EF-FRA-02. */
function withoutEvidence(control: Control, pending: number, now: string): ControlStatus {
  const state: ControlState = pending > 0 ? 'TO_VERIFY' : 'NO_EVIDENCE';
  const notes = pending > 0 ? [`${pending} ${STATE_NOTES.proposedPending}`] : [];
  return makeStatus(control, state, 'UNDETERMINED', null, null, null, pending, notes, now);
}

/** Scores every applied evidence for this control — EF-FRA-02. */
function collectCandidates(applied: readonly Attachment[], input: ControlEvaluationInput): Candidate[] {
  const candidates: Candidate[] = [];
  for (const attachment of applied) {
    const evidence = input.evidences.get(attachment.evidenceId);
    if (!evidence) continue;
    const { freshness, expiresAt } = computeFreshness(
      evidence,
      input.control.periodicity,
      input.now,
      input.leadDays ?? RENEWAL_LEAD_DAYS
    );
    candidates.push({ evidence, attachment, freshness, expiresAt, sufficiency: input.sufficiencies.get(attachment.id) ?? null });
  }
  return candidates;
}

/** Best candidate: freshest first, then most complete, then latest expiry — EF-FRA-02. */
function pickBest(candidates: readonly Candidate[]): Candidate {
  return [...candidates].sort((a, b) => rank(b) - rank(a) || compareExpiry(b.expiresAt, a.expiresAt))[0]!;
}

function rank(candidate: Candidate): number {
  let score = 0;
  if (candidate.freshness === 'FRESH') score += 100;
  else if (candidate.freshness === 'TO_RENEW') score += 50;
  else if (candidate.freshness === 'EXPIRED') score += 10;
  if (candidate.sufficiency?.class === 'COMPLETE') score += 20;
  else if (candidate.sufficiency?.class === 'PARTIAL') score += 10;
  return score;
}

function compareExpiry(left: string | null, right: string | null): number {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  return left.localeCompare(right);
}

/** Applies the 12.4 prudence rules before any favourable state — EF-FRA-02. */
function prudenceBlocker(
  best: Candidate,
  control: Control,
  sufficiencyClass: SufficiencyClass,
  isTypeValidated: boolean
): string | null {
  if (best.evidence.flags.unreadable) return STATE_NOTES.evidenceUnreadable;
  if (best.evidence.flags.dateToConfirm) return STATE_NOTES.dateToConfirm;
  if (best.evidence.flags.missingDate || best.freshness === 'UNDETERMINED') return STATE_NOTES.dateMissing;
  if (control.mandatory && sufficiencyClass === 'COMPLETE' && !isTypeValidated) {
    return STATE_NOTES.mandatoryFirstValidation;
  }
  return null;
}

/** Builds the status of a control that has at least one applied evidence — EF-FRA-02. */
function statusForBest(
  control: Control,
  best: Candidate,
  candidates: readonly Candidate[],
  isTypeValidated: boolean,
  pending: number,
  now: string
): ControlStatus {
  const sufficiencyClass = best.sufficiency?.class ?? 'TO_VERIFY';
  const state = stateFromBest(best, candidates);
  const blocker = prudenceBlocker(best, control, sufficiencyClass, isTypeValidated);
  // Prudence (12.4) only ever prevents an upgrade to COVERED: an expired
  // control stays EXPIRED (R5) and a control about to expire stays TO_RENEW,
  // with the blocker recorded as a note so the reviewer still sees the doubt.
  if (state === 'COVERED' && blocker !== null) {
    return makeStatus(control, 'TO_VERIFY', best.freshness, sufficiencyClass, best.evidence.id, best.expiresAt, pending, [blocker], now);
  }
  const notes = blocker === null ? notesFor(state, sufficiencyClass) : [...notesFor(state, sufficiencyClass), blocker];
  return makeStatus(control, state, best.freshness, sufficiencyClass, best.evidence.id, best.expiresAt, pending, notes, now);
}

/** Maps the best candidate to a state, doubt going to TO_VERIFY — EF-FRA-02. */
function stateFromBest(best: Candidate, all: readonly Candidate[]): ControlState {
  const sufficiencyClass = best.sufficiency?.class ?? 'TO_VERIFY';
  if (best.freshness === 'FRESH' && sufficiencyClass === 'COMPLETE') return 'COVERED';
  if (best.freshness === 'TO_RENEW') return 'TO_RENEW';
  if (sufficiencyClass !== 'COMPLETE' || best.freshness === 'UNDETERMINED') return 'TO_VERIFY';
  return all.every((candidate) => candidate.freshness === 'EXPIRED') ? 'EXPIRED' : 'TO_VERIFY';
}

/**
 * Notes of a state. `sufficiency-not-complete` is only claimed when the
 * sufficiency really is incomplete: an unreadable document with a complete
 * assessment must not be reported as missing elements.
 */
function notesFor(state: ControlState, sufficiencyClass: SufficiencyClass): string[] {
  if (state === 'COVERED') return [];
  if (state === 'TO_RENEW') return [STATE_NOTES.expiresSoon];
  if (state === 'EXPIRED') return [STATE_NOTES.expired];
  return sufficiencyClass === 'COMPLETE' ? [] : [STATE_NOTES.sufficiencyIncomplete];
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

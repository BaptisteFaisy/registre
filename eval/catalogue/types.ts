/**
 * Catalogue — shared shapes for the demonstration framework and its evidence.
 *
 * This module is the single source of truth shared by two consumers:
 *  - the demo generator (`tools/demo/**`), which renders the 60 evidence files;
 *  - the evaluation module (`eval/**`, `tools/eval/**`), which builds the four
 *    measurement datasets (spec chapter 13.5) from the same rows.
 *
 * Pure types and constants: importing this file has no side effect.
 */

import type { AccessLevel, EvidenceType } from '../../src/domain/types.ts';

/* ----------------------------------------------------------------- domains */

/** The six domains of the demonstration framework (spec chapter 18.1). */
export type DomainId =
  | 'governance'
  | 'incident_management'
  | 'change_management'
  | 'continuity'
  | 'security'
  | 'client_relationship';

export interface Domain {
  id: DomainId;
  /** Human label used in the portal and in the audit pack index. */
  label: string;
}

export const DOMAINS: readonly Domain[] = [
  { id: 'governance', label: 'Governance' },
  { id: 'incident_management', label: 'Incident management' },
  { id: 'change_management', label: 'Change management' },
  { id: 'continuity', label: 'Continuity' },
  { id: 'security', label: 'Security' },
  { id: 'client_relationship', label: 'Client relationship' }
] as const;

/* ---------------------------------------------------------------- controls */

/** Periodicity accepted by the demonstration framework (ISO-8601 durations). */
export type Periodicity = 'P1Y' | 'P6M' | 'P3M' | 'P1M';

export const PERIODICITIES: readonly Periodicity[] = ['P1Y', 'P6M', 'P3M', 'P1M'] as const;

/** One control of the framework, shaped after Annex A of the specification. */
export interface CatalogueControl {
  /** `CONT-01` … `CONT-30`. */
  id: string;
  domain: DomainId;
  title: string;
  requirement: string;
  /** What an evidence must contain to support this control (Annex A). */
  expectedEvidence: string[];
  periodicity: Periodicity;
  /** Account owning the evidence, e.g. `quality.lead`. */
  owner: string;
  mandatory: boolean;
}

/** Owners used across the catalogue; the demo maps them to mailboxes. */
export const OWNERS: readonly string[] = [
  'quality.lead',
  'managing.director',
  'procurement.lead',
  'service.desk.manager',
  'security.officer',
  'change.manager',
  'platform.lead',
  'operations.lead',
  'hr.lead',
  'account.manager'
] as const;

/* ---------------------------------------------------------------- evidence */

/**
 * Situations deliberately seeded in the demonstration data (spec 18.1) plus
 * the four edge cases the acceptance list needs (R10, unreadable document,
 * personal data, screenshot whose date must be confirmed).
 */
export type SeededSituationKind =
  | 'STALE_SECURITY_POLICY'
  | 'NO_RESTORE_TEST_THIS_QUARTER'
  | 'RESTORE_REPORT_MISSING_DURATION'
  | 'UNSIGNED_PROCEDURE'
  | 'MISFILED_EVIDENCE'
  | 'DUPLICATE_DOCUMENT'
  | 'UNRELATED_EVIDENCE'
  | 'UNREADABLE_EVIDENCE'
  | 'PERSONAL_DATA_RESTRICTED'
  | 'SCREENSHOT_DATE_TO_CONFIRM';

export interface SeededSituation {
  kind: SeededSituationKind;
  /** One-line statement of what the seed demonstrates. */
  label: string;
  /** Control whose state or sufficiency the seed exercises; `null` if none. */
  controlId: string | null;
  /** Evidence carrying the seed; empty when the seed is an absence. */
  evidenceIds: string[];
  /** Acceptance scenario of chapter 22 the seed feeds. */
  scenario: string;
}

/** An expected sufficiency gap: the element is missing for that control. */
export interface ExpectedGap {
  controlId: string;
  /** Must be one of the control's `expectedEvidence` entries. */
  expected: string;
}

/** One evidence of the demonstration set. */
export interface CatalogueEvidence {
  /** `EV-001` … `EV-060`. */
  id: string;
  fileName: string;
  type: EvidenceType;
  title: string;
  /** Date printed on the document (Annex B `documentDate`). */
  documentDate: string;
  /** Covered period for reports and exports, otherwise `null`. */
  period: { start: string | null; end: string | null } | null;
  version: string | null;
  author: string | null;
  /** `null` when the document is not signed. */
  approver: string | null;
  approvalDate: string | null;
  /** Customer the evidence relates to, `null` for internal evidence. */
  client: string | null;
  summary: string;
  /** Annex B `personalData`; forces the RESTRICTED access level. */
  personalData: boolean;
  accessLevel: AccessLevel;
  /** Controls this evidence is expected to support (empty for R10). */
  expectedControls: string[];
  /** Expected sufficiency gaps (feeds `sufficiency.jsonl`). */
  missingElements: ExpectedGap[];
  seededSituation: SeededSituationKind | null;
  /** Id of the first copy when the same content is filed twice (R8). */
  duplicateOf: string | null;
  /** Folder the file was actually filed in, when it is not the right one. */
  filedUnder: string | null;
  /** Reader cannot extract anything from the file (EF-LEC-04). */
  unreadable: boolean;
  /** Document date differs from the file date (screenshots, 13.1). */
  dateToConfirm: boolean;
}

/* --------------------------------------------------------------- questions */

/** One question of the question-answering set (spec 13.5, R11–R13). */
export interface CatalogueQuestion {
  /** `Q-01` … `Q-25`. */
  id: string;
  question: string;
  /** Evidence the answer must cite; empty for the five trap questions. */
  expectedEvidenceIds: string[];
  /** `NO_EVIDENCE` marks a trap: the only acceptable answer is a refusal. */
  expectedAnswerKind: 'EVIDENCE' | 'NO_EVIDENCE';
  /** Why the question is asked; kept short for the reviewer. */
  intent: string;
}

/* ----------------------------------------------------------------- helpers */

/** `1` → `CONT-01`. */
export function controlId(n: number): string {
  return `CONT-${String(n).padStart(2, '0')}`;
}

/** `1` → `EV-001`. */
export function evidenceId(n: number): string {
  return `EV-${String(n).padStart(3, '0')}`;
}

/** `1` → `Q-01`. */
export function questionId(n: number): string {
  return `Q-${String(n).padStart(2, '0')}`;
}

export function domainLabel(id: DomainId): string {
  return DOMAINS.find((domain) => domain.id === id)?.label ?? id;
}

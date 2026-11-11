/**
 * Evidence builder. Every row of the demonstration set goes through `ev()`, so
 * the defaults (access level, flags, empty gaps) live in one place and adding a
 * field to `CatalogueEvidence` touches this file only.
 */

import type { AccessLevel, EvidenceType } from '../../src/domain/types.ts';
import type { CatalogueEvidence, ExpectedGap, SeededSituationKind } from './types.ts';

export interface EvidenceInput {
  id: string;
  fileName: string;
  type: EvidenceType;
  title: string;
  documentDate: string;
  summary: string;
  expectedControls: string[];
  period?: { start: string | null; end: string | null } | null;
  version?: string | null;
  author?: string | null;
  approver?: string | null;
  approvalDate?: string | null;
  client?: string | null;
  personalData?: boolean;
  accessLevel?: AccessLevel;
  missingElements?: ExpectedGap[];
  seededSituation?: SeededSituationKind | null;
  duplicateOf?: string | null;
  filedUnder?: string | null;
  unreadable?: boolean;
  dateToConfirm?: boolean;
}

/** Builds one catalogue evidence with the catalogue-wide defaults applied. */
export function ev(input: EvidenceInput): CatalogueEvidence {
  return {
    period: null,
    version: '1.0',
    author: null,
    approver: null,
    approvalDate: null,
    client: null,
    personalData: false,
    accessLevel: input.personalData ? 'RESTRICTED' : 'INTERNAL',
    missingElements: [],
    seededSituation: null,
    duplicateOf: null,
    filedUnder: null,
    unreadable: false,
    dateToConfirm: false,
    ...input
  };
}

/** Shorthand for one expected sufficiency gap. */
export function gap(controlId: string, expected: string): ExpectedGap {
  return { controlId, expected };
}

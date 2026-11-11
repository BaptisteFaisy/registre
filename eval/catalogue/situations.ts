/**
 * The seeded situations of the demonstration set (spec 18.1), plus the four
 * edge cases the acceptance list needs.
 *
 * A situation is an absence as often as a document: "no restore test this
 * quarter" has no evidence to point at, so `evidenceIds` is empty and the
 * situation is carried by the control only.
 */

import type { SeededSituation } from './types.ts';

export const SEEDED_SITUATIONS: readonly SeededSituation[] = [
  {
    kind: 'STALE_SECURITY_POLICY',
    label: 'Security policy last reviewed 18 months ago',
    controlId: 'CONT-01',
    evidenceIds: ['EV-001'],
    scenario: 'R5'
  },
  {
    kind: 'NO_RESTORE_TEST_THIS_QUARTER',
    label:
      'No restore test recorded in the current quarter: the latest restore report is dated Q2 2026, so the control expires and the reminder asks for this quarter. Before that report is ingested the control has no evidence at all.',
    controlId: 'CONT-16',
    evidenceIds: [],
    scenario: 'R6'
  },
  {
    kind: 'RESTORE_REPORT_MISSING_DURATION',
    label: 'Restore report without a measured recovery time',
    controlId: 'CONT-16',
    evidenceIds: ['EV-033'],
    scenario: 'R7'
  },
  {
    kind: 'UNSIGNED_PROCEDURE',
    label: 'Procedure published without a signature',
    controlId: 'CONT-11',
    evidenceIds: ['EV-007'],
    scenario: 'R7'
  },
  {
    kind: 'MISFILED_EVIDENCE',
    label: 'Access review filed in the continuity folder, supporting a security control',
    controlId: 'CONT-21',
    evidenceIds: ['EV-043'],
    scenario: 'R9'
  },
  {
    kind: 'DUPLICATE_DOCUMENT',
    label: 'Same policy filed twice under two names',
    controlId: 'CONT-01',
    evidenceIds: ['EV-001', 'EV-002'],
    scenario: 'R8'
  },
  {
    kind: 'UNRELATED_EVIDENCE',
    label: 'Document with no link to the framework: it supports no control',
    controlId: null,
    evidenceIds: ['EV-060'],
    scenario: 'R10'
  },
  {
    kind: 'UNREADABLE_EVIDENCE',
    label: 'Scanned procedure the reader cannot extract text from',
    controlId: 'CONT-24',
    evidenceIds: ['EV-052'],
    scenario: 'R2'
  },
  {
    kind: 'PERSONAL_DATA_RESTRICTED',
    label: 'Evidence holding personal data, restricted to cleared roles',
    controlId: 'CONT-22',
    evidenceIds: ['EV-045', 'EV-048', 'EV-050'],
    scenario: 'R13'
  },
  {
    kind: 'SCREENSHOT_DATE_TO_CONFIRM',
    label: 'Screenshot whose printed date differs from the file date',
    controlId: 'CONT-04',
    evidenceIds: ['EV-011', 'EV-042'],
    scenario: 'R2'
  }
] as const;

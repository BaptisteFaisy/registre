/**
 * Evidence EV-033 … EV-042 — continuity domain.
 *
 * Seeds carried here: a restore report without a measured recovery time (R7),
 * no restore test in the current quarter (the seed is an absence, described in
 * `situations.ts`), and a backup console screenshot whose date must be
 * confirmed.
 */

import type { CatalogueEvidence } from './types.ts';
import { ev, gap } from './build.ts';

export const CONTINUITY_EVIDENCE: readonly CatalogueEvidence[] = [
  ev({
    id: 'EV-033',
    fileName: 'restore-test-report-q2-2026.pdf',
    type: 'REPORT',
    title: 'Restore Test Report, Q2 2026',
    documentDate: '2026-06-28',
    author: 'Operations Lead',
    approver: 'Managing Director',
    approvalDate: '2026-07-01',
    summary:
      'Report of the restore test run on the customer database in June 2026. The restored dataset, the test date, the result and the signatory are recorded; the recovery time was not measured during the exercise.',
    expectedControls: ['CONT-16'],
    missingElements: [gap('CONT-16', 'Measured recovery time')],
    seededSituation: 'RESTORE_REPORT_MISSING_DURATION'
  }),
  ev({
    id: 'EV-034',
    fileName: 'business-continuity-plan-v5.pdf',
    type: 'POLICY',
    title: 'Business Continuity Plan',
    documentDate: '2026-01-15',
    version: '5.0',
    author: 'Operations Lead',
    approver: 'Managing Director',
    approvalDate: '2026-01-22',
    summary:
      'Continuity plan covering the managed service catalogue, the escalation path and the recovery roles. Approved by the managing director in January.',
    expectedControls: ['CONT-17']
  }),
  ev({
    id: 'EV-035',
    fileName: 'recovery-objectives-per-service.xlsx',
    type: 'LIST',
    title: 'Recovery Objectives per Service',
    documentDate: '2025-11-20',
    author: 'Operations Lead',
    approver: 'Managing Director',
    approvalDate: '2025-11-28',
    summary:
      'Table of recovery time and recovery point objectives for each managed service, approved with the continuity plan revision.',
    expectedControls: ['CONT-18']
  }),
  ev({
    id: 'EV-036',
    fileName: 'backup-job-report-sep-2026.pdf',
    type: 'EXPORT',
    title: 'Backup Job Report, September 2026',
    documentDate: '2026-10-01',
    period: { start: '2026-09-01', end: '2026-09-30' },
    author: 'Operations Lead',
    summary:
      'Monthly report of backup jobs with the job count and the list of failed jobs. The report is a manual export; no monitoring alarm is attached.',
    expectedControls: ['CONT-19'],
    missingElements: [gap('CONT-19', 'Monitoring evidence')]
  }),
  ev({
    id: 'EV-037',
    fileName: 'continuity-exercise-minutes-2026.docx',
    type: 'MINUTES',
    title: 'Continuity Exercise Minutes 2026',
    documentDate: '2026-05-06',
    author: 'Operations Lead',
    approver: 'Managing Director',
    approvalDate: '2026-05-12',
    summary:
      'Minutes of the continuity exercise based on the loss of a customer file share. Participants, scenario and lessons are recorded.',
    expectedControls: ['CONT-20']
  }),
  ev({
    id: 'EV-038',
    fileName: 'restore-test-report-q1-2026.pdf',
    type: 'REPORT',
    title: 'Restore Test Report, Q1 2026',
    documentDate: '2026-03-27',
    author: 'Operations Lead',
    approver: 'Managing Director',
    approvalDate: '2026-03-31',
    summary:
      'Report of the restore test run on the billing platform in March 2026, with the measured recovery time and the result. Signed by the operations lead.',
    expectedControls: ['CONT-16']
  }),
  ev({
    id: 'EV-039',
    fileName: 'backup-job-report-aug-2026.pdf',
    type: 'EXPORT',
    title: 'Backup Job Report, August 2026',
    documentDate: '2026-09-01',
    period: { start: '2026-08-01', end: '2026-08-31' },
    author: 'Operations Lead',
    summary:
      'Monthly backup report for August 2026 with the job count, the failed jobs and the alarm that fired on the failed run.',
    expectedControls: ['CONT-19']
  }),
  ev({
    id: 'EV-040',
    fileName: 'recovery-runbook-inventory.xlsx',
    type: 'LIST',
    title: 'Recovery Runbook Inventory',
    documentDate: '2026-04-02',
    author: 'Operations Lead',
    approver: 'Managing Director',
    approvalDate: '2026-04-09',
    summary:
      'Inventory of recovery runbooks per service with the service name and the objectives each runbook implements.',
    expectedControls: ['CONT-17', 'CONT-18']
  }),
  ev({
    id: 'EV-041',
    fileName: 'continuity-test-report-2026.pdf',
    type: 'REPORT',
    title: 'Continuity Test Report 2026',
    documentDate: '2026-09-12',
    author: 'Operations Lead',
    approver: 'Managing Director',
    approvalDate: '2026-09-16',
    summary:
      'Report of the September continuity test on the customer portal. The scenario and the participants are described; the lessons learned section is empty. The test covers failover, not the restore of a backup.',
    expectedControls: ['CONT-20'],
    missingElements: [gap('CONT-20', 'Lessons recorded')]
  }),
  ev({
    id: 'EV-042',
    fileName: 'backup-console-screenshot.png',
    type: 'SCREENSHOT',
    title: 'Backup Console Screenshot',
    documentDate: '2026-10-06',
    author: 'Operations Lead',
    summary:
      'Screenshot of the backup console showing the last successful runs of the managed databases. The date shown on screen differs from the file timestamp.',
    expectedControls: ['CONT-19'],
    seededSituation: 'SCREENSHOT_DATE_TO_CONFIRM',
    dateToConfirm: true
  })
] as const;

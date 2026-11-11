/**
 * Evidence EV-013 … EV-032 — incident management and change management.
 */

import type { CatalogueEvidence } from './types.ts';
import { ev, gap } from './build.ts';

export const OPERATIONS_EVIDENCE: readonly CatalogueEvidence[] = [
  /* ------------------------------------------------- incident management */
  ev({
    id: 'EV-013',
    fileName: 'incident-register-export-q3-2026.csv',
    type: 'EXPORT',
    title: 'Incident Register Export, Q3 2026',
    documentDate: '2026-10-01',
    period: { start: '2026-07-01', end: '2026-09-30' },
    author: 'Service Desk Manager',
    summary:
      'Export of the incident register for the third quarter of 2026. Each row carries the incident reference, its opening date and its closure date.',
    expectedControls: ['CONT-06'],
    missingElements: [gap('CONT-06', 'Severity breakdown')]
  }),
  ev({
    id: 'EV-014',
    fileName: 'incident-register-export-aug-2026.csv',
    type: 'EXPORT',
    title: 'Incident Register Export, August 2026',
    documentDate: '2026-09-01',
    period: { start: '2026-08-01', end: '2026-08-31' },
    author: 'Service Desk Manager',
    summary:
      'Monthly export of the incident register with severity, response time and closure date for each ticket.',
    expectedControls: ['CONT-06', 'CONT-08']
  }),
  ev({
    id: 'EV-015',
    fileName: 'major-incident-review-inc-2026-014.docx',
    type: 'MINUTES',
    title: 'Major Incident Review INC-2026-014',
    documentDate: '2026-07-22',
    author: 'Service Desk Manager',
    approver: 'Operations Lead',
    approvalDate: '2026-07-28',
    summary:
      'Review of a payment gateway outage. The minutes state the root cause, the corrective actions and the signatory.',
    expectedControls: ['CONT-07']
  }),
  ev({
    id: 'EV-016',
    fileName: 'post-incident-review-inc-2026-021.docx',
    type: 'MINUTES',
    title: 'Post-Incident Review INC-2026-021',
    documentDate: '2026-09-30',
    author: 'Service Desk Manager',
    approver: 'Operations Lead',
    approvalDate: '2026-10-06',
    summary:
      'Review of a storage saturation incident. The root cause is documented; the follow-up actions are still being defined.',
    expectedControls: ['CONT-07'],
    missingElements: [gap('CONT-07', 'Corrective actions')]
  }),
  ev({
    id: 'EV-017',
    fileName: 'incident-response-time-report-sep-2026.pdf',
    type: 'REPORT',
    title: 'Incident Response Time Report, September 2026',
    documentDate: '2026-10-03',
    period: { start: '2026-09-01', end: '2026-09-30' },
    author: 'Service Desk Manager',
    summary:
      'Monthly report of measured first-response times per severity, with the number of breaches. The committed targets are not reproduced in the report.',
    expectedControls: ['CONT-08'],
    missingElements: [gap('CONT-08', 'Target response time')]
  }),
  ev({
    id: 'EV-018',
    fileName: 'security-incident-notification-log-h1-2026.csv',
    type: 'EXPORT',
    title: 'Security Incident Notification Log, H1 2026',
    documentDate: '2026-07-05',
    period: { start: '2026-01-01', end: '2026-06-30' },
    author: 'Security Officer',
    client: 'Northwind Logistics',
    personalData: true,
    summary:
      'Log of security incidents that required customer notification, with the notification date and the channel used. Rows name the customer contacts who were called.',
    expectedControls: ['CONT-09']
  }),
  ev({
    id: 'EV-019',
    fileName: 'problem-records-export-q3-2026.csv',
    type: 'EXPORT',
    title: 'Problem Records Export, Q3 2026',
    documentDate: '2026-10-05',
    period: { start: '2026-07-01', end: '2026-09-30' },
    author: 'Service Desk Manager',
    summary:
      'Export of the problem records opened in the quarter, with the linked incidents and the root cause analysis.',
    expectedControls: ['CONT-10'],
    missingElements: [gap('CONT-10', 'Permanent fix')]
  }),
  ev({
    id: 'EV-020',
    fileName: 'customer-notification-attestation-northwind.pdf',
    type: 'ATTESTATION',
    title: 'Customer Notification Attestation, Northwind',
    documentDate: '2026-05-14',
    author: 'Security Officer',
    approver: 'Managing Director',
    approvalDate: '2026-05-15',
    client: 'Northwind Logistics',
    summary:
      'Attestation that Northwind Logistics was notified of a security incident within the agreed delay, naming the channel and the notification owner.',
    expectedControls: ['CONT-09']
  }),
  ev({
    id: 'EV-021',
    fileName: 'major-incident-log-h1-2026.csv',
    type: 'EXPORT',
    title: 'Major Incident Log, H1 2026',
    documentDate: '2026-07-04',
    period: { start: '2026-01-01', end: '2026-06-30' },
    author: 'Service Desk Manager',
    summary:
      'Log of major incidents for the first half of 2026 with root cause and review date. The log is produced from the ticket tool and carries no signature.',
    expectedControls: ['CONT-07', 'CONT-06'],
    missingElements: [gap('CONT-07', 'Signatory name')]
  }),
  ev({
    id: 'EV-022',
    fileName: 'incident-management-policy-v3.pdf',
    type: 'POLICY',
    title: 'Incident Management Policy',
    documentDate: '2026-02-02',
    version: '3.0',
    author: 'Service Desk Manager',
    approver: 'Managing Director',
    approvalDate: '2026-02-09',
    summary:
      'Policy setting incident severity levels, review duties and the notification path for major incidents.',
    expectedControls: ['CONT-06', 'CONT-07']
  }),

  /* -------------------------------------------------- change management */
  ev({
    id: 'EV-023',
    fileName: 'change-register-export-sep-2026.csv',
    type: 'EXPORT',
    title: 'Change Register Export, September 2026',
    documentDate: '2026-10-02',
    period: { start: '2026-09-01', end: '2026-09-30' },
    author: 'Change Manager',
    summary:
      'Monthly export of the change register with approval date, approver and implementation date for each change.',
    expectedControls: ['CONT-11']
  }),
  ev({
    id: 'EV-024',
    fileName: 'emergency-change-review-chg-2026-118.docx',
    type: 'MINUTES',
    title: 'Emergency Change Review CHG-2026-118',
    documentDate: '2026-08-11',
    author: 'Change Manager',
    approver: 'Platform Lead',
    approvalDate: '2026-08-14',
    summary:
      'Post-implementation review of an emergency firewall change with its justification and review date. The minutes do not name the reviewer.',
    expectedControls: ['CONT-12'],
    missingElements: [gap('CONT-12', 'Reviewer name')]
  }),
  ev({
    id: 'EV-025',
    fileName: 'change-success-report-q2-2026.pdf',
    type: 'REPORT',
    title: 'Change Success Report, Q2 2026',
    documentDate: '2026-07-10',
    period: { start: '2026-04-01', end: '2026-06-30' },
    author: 'Change Manager',
    summary:
      'Quarterly report of change volume and failed changes. Rollbacks are mentioned in the narrative but not counted in the tables.',
    expectedControls: ['CONT-13'],
    missingElements: [gap('CONT-13', 'Rollback count')]
  }),
  ev({
    id: 'EV-026',
    fileName: 'configuration-baseline-inventory.xlsx',
    type: 'LIST',
    title: 'Configuration Baseline Inventory',
    documentDate: '2026-07-15',
    author: 'Platform Lead',
    approver: 'Operations Lead',
    approvalDate: '2026-07-20',
    summary:
      'Inventory of the configuration items of the managed environments, with the baseline date and the systems covered.',
    expectedControls: ['CONT-14']
  }),
  ev({
    id: 'EV-027',
    fileName: 'production-access-procedure-v1.pdf',
    type: 'PROCEDURE',
    title: 'Production Access Procedure',
    documentDate: '2026-04-20',
    version: '1.2',
    author: 'Platform Lead',
    approver: 'Security Officer',
    approvalDate: '2026-04-24',
    summary:
      'Procedure describing how production access is requested, approved and granted, and which roles are kept separate.',
    expectedControls: ['CONT-15']
  }),
  ev({
    id: 'EV-028',
    fileName: 'change-approvals-export-aug-2026.csv',
    type: 'EXPORT',
    title: 'Change Approvals Export, August 2026',
    documentDate: '2026-09-02',
    period: { start: '2026-08-01', end: '2026-08-31' },
    author: 'Change Manager',
    summary:
      'Export of approved changes for August 2026 with the approval date and the approver. The implementation date is recorded in a separate tool.',
    expectedControls: ['CONT-11', 'CONT-12'],
    missingElements: [gap('CONT-11', 'Implementation date')]
  }),
  ev({
    id: 'EV-029',
    fileName: 'change-advisory-board-minutes-sep-2026.docx',
    type: 'MINUTES',
    title: 'Change Advisory Board Minutes, September 2026',
    documentDate: '2026-09-08',
    author: 'Change Manager',
    approver: 'Platform Lead',
    approvalDate: '2026-09-09',
    summary:
      'Weekly change advisory board minutes listing the changes approved and the ones deferred. Attendees and decisions are recorded.',
    expectedControls: ['CONT-11', 'CONT-13']
  }),
  ev({
    id: 'EV-030',
    fileName: 'emergency-change-report-q1-2026.pdf',
    type: 'REPORT',
    title: 'Emergency Change Report, Q1 2026',
    documentDate: '2026-04-08',
    period: { start: '2026-01-01', end: '2026-03-31' },
    author: 'Change Manager',
    summary:
      'Quarterly report of emergency changes with their justification and the date of the post-implementation review.',
    expectedControls: ['CONT-12']
  }),
  ev({
    id: 'EV-031',
    fileName: 'access-change-log-h1-2026.csv',
    type: 'EXPORT',
    title: 'Access Change Log, H1 2026',
    documentDate: '2026-07-06',
    period: { start: '2026-01-01', end: '2026-06-30' },
    author: 'Platform Lead',
    summary:
      'Log of production access changes for the first half of 2026, with the requester and the approver of each change. The log does not state which duties are kept separate.',
    expectedControls: ['CONT-15', 'CONT-21'],
    missingElements: [gap('CONT-15', 'Roles separated')]
  }),
  ev({
    id: 'EV-032',
    fileName: 'change-calendar-screenshot.png',
    type: 'SCREENSHOT',
    title: 'Change Calendar Screenshot',
    documentDate: '2026-09-25',
    author: 'Change Manager',
    summary:
      'Screenshot of the change calendar for the last week of September, showing approved maintenance windows.',
    expectedControls: ['CONT-11']
  })
] as const;

/**
 * Evidence EV-043 … EV-052 — security domain.
 *
 * Seeds carried here: a quarterly access review filed in the continuity folder
 * although it supports a security control (R9), a personnel list holding
 * personal data (RESTRICTED), and a scanned procedure the reader cannot open
 * (EF-LEC-04).
 */

import type { CatalogueEvidence } from './types.ts';
import { ev, gap } from './build.ts';

export const SECURITY_EVIDENCE: readonly CatalogueEvidence[] = [
  ev({
    id: 'EV-043',
    fileName: 'access-review-q3-2026.xlsx',
    type: 'EXPORT',
    title: 'Access Review, Q3 2026',
    documentDate: '2026-10-04',
    period: { start: '2026-07-01', end: '2026-09-30' },
    author: 'Security Officer',
    approver: 'Managing Director',
    approvalDate: '2026-10-07',
    summary:
      'Quarterly review of privileged accounts with the review date and the accounts examined. Access removals are tracked in the ticket tool, not in this file.',
    expectedControls: ['CONT-21'],
    missingElements: [gap('CONT-21', 'Removals made')],
    seededSituation: 'MISFILED_EVIDENCE',
    filedUnder: 'continuity/'
  }),
  ev({
    id: 'EV-044',
    fileName: 'vulnerability-scan-report-sep-2026.pdf',
    type: 'REPORT',
    title: 'Vulnerability Scan Report, September 2026',
    documentDate: '2026-09-30',
    period: { start: '2026-09-01', end: '2026-09-30' },
    author: 'Security Officer',
    summary:
      'Monthly vulnerability scan of the managed environments with findings grouped by severity and their remediation deadlines.',
    expectedControls: ['CONT-23']
  }),
  ev({
    id: 'EV-045',
    fileName: 'security-awareness-training-completion-2026.xlsx',
    type: 'LIST',
    title: 'Security Awareness Training Completion 2026',
    documentDate: '2026-03-31',
    period: { start: '2026-01-01', end: '2026-03-31' },
    author: 'Security Officer',
    personalData: true,
    summary:
      'List of employees with their training completion date for the first quarter campaign. It carries names and employee numbers, so the access level is restricted. The file does not compute a completion rate.',
    expectedControls: ['CONT-22'],
    missingElements: [gap('CONT-22', 'Completion rate')],
    seededSituation: 'PERSONAL_DATA_RESTRICTED'
  }),
  ev({
    id: 'EV-046',
    fileName: 'encryption-attestation-2026.pdf',
    type: 'ATTESTATION',
    title: 'Encryption Attestation 2026',
    documentDate: '2026-06-30',
    author: 'Platform Lead',
    approver: 'Security Officer',
    approvalDate: '2026-07-03',
    summary:
      'Attestation describing encryption at rest and in transit for the managed services, the key management choice and the services covered.',
    expectedControls: ['CONT-24']
  }),
  ev({
    id: 'EV-047',
    fileName: 'access-control-policy-v2.pdf',
    type: 'POLICY',
    title: 'Access Control Policy',
    documentDate: '2026-03-18',
    version: '2.1',
    author: 'Security Officer',
    approver: 'Managing Director',
    approvalDate: '2026-03-25',
    summary:
      'Policy for account creation, privileged access, quarterly review and screening before access is granted.',
    expectedControls: ['CONT-21', 'CONT-25']
  }),
  ev({
    id: 'EV-048',
    fileName: 'privileged-account-list-sep-2026.csv',
    type: 'EXPORT',
    title: 'Privileged Account List, September 2026',
    documentDate: '2026-09-30',
    author: 'Security Officer',
    personalData: true,
    summary:
      'Export of privileged accounts at the end of September with the holder name and the system concerned. Names make the file restricted.',
    expectedControls: ['CONT-21']
  }),
  ev({
    id: 'EV-049',
    fileName: 'vulnerability-scan-report-oct-2026.pdf',
    type: 'REPORT',
    title: 'Vulnerability Scan Report, October 2026',
    documentDate: '2026-10-31',
    period: { start: '2026-10-01', end: '2026-10-31' },
    author: 'Security Officer',
    summary:
      'October vulnerability scan with findings by severity and the systems scanned. Remediation deadlines were not set for this cycle.',
    expectedControls: ['CONT-23'],
    missingElements: [gap('CONT-23', 'Remediation deadlines')]
  }),
  ev({
    id: 'EV-050',
    fileName: 'personnel-screening-records-2026.xlsx',
    type: 'LIST',
    title: 'Personnel Screening Records 2026',
    documentDate: '2026-02-28',
    author: 'HR Lead',
    personalData: true,
    summary:
      'Record of the screening checks performed before privileged access was granted, with the role covered and the completion date. It holds personal data, so the access level is restricted.',
    expectedControls: ['CONT-25'],
    seededSituation: 'PERSONAL_DATA_RESTRICTED'
  }),
  ev({
    id: 'EV-051',
    fileName: 'security-committee-minutes-oct-2026.docx',
    type: 'MINUTES',
    title: 'Security Committee Minutes, October 2026',
    documentDate: '2026-10-08',
    author: 'Security Officer',
    approver: 'Managing Director',
    approvalDate: '2026-10-09',
    summary:
      'Security committee minutes covering the policy review calendar, the open vulnerabilities and the next access review.',
    // CONT-01 deliberately not listed: see EV-008 (acceptance scenario R5).
    expectedControls: ['CONT-23']
  }),
  ev({
    id: 'EV-052',
    fileName: 'encryption-standard-scanned.pdf',
    type: 'PROCEDURE',
    title: 'Encryption Standard',
    documentDate: '2026-05-20',
    author: 'Platform Lead',
    approver: 'Security Officer',
    approvalDate: '2026-05-27',
    summary:
      'Scanned encryption standard. The scan is unreadable: the pages were fed through the scanner upside down and no text can be extracted.',
    expectedControls: ['CONT-24'],
    seededSituation: 'UNREADABLE_EVIDENCE',
    unreadable: true
  })
] as const;

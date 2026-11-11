/**
 * Evidence EV-001 … EV-012 — governance domain.
 *
 * Seeds carried here: a security policy last reviewed 18 months ago (R5), the
 * same policy filed twice under two names (R8), and an audit calendar
 * screenshot whose printed date must be confirmed.
 */

import type { CatalogueEvidence } from './types.ts';
import { ev, gap } from './build.ts';

export const GOVERNANCE_EVIDENCE: readonly CatalogueEvidence[] = [
  ev({
    id: 'EV-001',
    fileName: 'information-security-policy-v4.pdf',
    type: 'POLICY',
    title: 'Information Security Policy',
    documentDate: '2025-05-12',
    version: '4.0',
    author: 'Quality Lead',
    approver: 'Chief Executive Officer',
    approvalDate: '2025-05-20',
    summary:
      'Information security policy of the fictional managed service provider. The document sets principles for access, data handling and incident reporting.',
    expectedControls: ['CONT-01'],
    seededSituation: 'STALE_SECURITY_POLICY'
  }),
  ev({
    id: 'EV-002',
    fileName: 'security-policy-approved.pdf',
    type: 'POLICY',
    title: 'Information Security Policy (service desk copy)',
    documentDate: '2025-05-12',
    version: '4.0',
    author: 'Quality Lead',
    approver: 'Chief Executive Officer',
    approvalDate: '2025-05-20',
    summary:
      'Second upload of the information security policy, saved by the service desk under another name. Content and page count match the approved version.',
    expectedControls: ['CONT-01'],
    seededSituation: 'DUPLICATE_DOCUMENT',
    duplicateOf: 'EV-001'
  }),
  ev({
    id: 'EV-003',
    fileName: 'roles-and-responsibilities-matrix.xlsx',
    type: 'LIST',
    title: 'Roles and Responsibilities Matrix',
    documentDate: '2026-02-10',
    author: 'Quality Lead',
    approver: 'Managing Director',
    approvalDate: '2026-02-12',
    summary:
      'Matrix mapping each service activity to an accountable role. Reviewed with the management team in February.',
    expectedControls: ['CONT-02']
  }),
  ev({
    id: 'EV-004',
    fileName: 'management-review-minutes-2026-q3.docx',
    type: 'MINUTES',
    title: 'Management Review Minutes, Q3 2026',
    documentDate: '2026-09-18',
    author: 'Quality Lead',
    approver: 'Managing Director',
    approvalDate: '2026-10-02',
    summary:
      'Quarterly management review of service performance and risk. Decisions and action owners are listed at the end of the minutes.',
    expectedControls: ['CONT-03']
  }),
  ev({
    id: 'EV-005',
    fileName: 'internal-audit-report-2026.pdf',
    type: 'REPORT',
    title: 'Internal Audit Report 2026',
    documentDate: '2026-01-30',
    author: 'Internal Auditor',
    approver: 'Quality Lead',
    approvalDate: '2026-02-06',
    summary:
      'Results of the 2026 internal audit cycle with findings and owners. The report states which controls were sampled.',
    expectedControls: ['CONT-04'],
    missingElements: [gap('CONT-04', 'Scope covered')]
  }),
  ev({
    id: 'EV-006',
    fileName: 'supplier-register-export.csv',
    type: 'EXPORT',
    title: 'Supplier and Subcontractor Register',
    documentDate: '2026-08-31',
    period: { start: '2026-01-01', end: '2026-06-30' },
    author: 'Procurement Lead',
    summary:
      'Register of suppliers and subcontractors used for managed services, with the service provided and the last contract review date.',
    expectedControls: ['CONT-05']
  }),
  ev({
    id: 'EV-007',
    fileName: 'change-management-procedure-v2.pdf',
    type: 'PROCEDURE',
    title: 'Change Management Procedure',
    documentDate: '2026-04-14',
    version: '2.0',
    author: 'Change Manager',
    summary:
      'Procedure describing how changes are raised, approved, implemented and reviewed. It also states which roles may request and approve production access. The document carries no signature block.',
    expectedControls: ['CONT-11', 'CONT-15'],
    missingElements: [gap('CONT-11', 'Approver name')],
    seededSituation: 'UNSIGNED_PROCEDURE'
  }),
  ev({
    id: 'EV-008',
    fileName: 'board-attestation-internal-control.pdf',
    type: 'ATTESTATION',
    title: 'Board Attestation on Internal Control',
    documentDate: '2026-03-05',
    author: 'Managing Director',
    approver: 'Board Chair',
    approvalDate: '2026-03-05',
    summary:
      'Signed statement by the board that the internal control system is operated as described in the policy set. It references the audit plan for the year.',
    expectedControls: ['CONT-01', 'CONT-04']
  }),
  ev({
    id: 'EV-009',
    fileName: 'management-review-minutes-2026-q2.docx',
    type: 'MINUTES',
    title: 'Management Review Minutes, Q2 2026',
    documentDate: '2026-06-19',
    author: 'Quality Lead',
    approver: 'Managing Director',
    approvalDate: '2026-06-24',
    summary:
      'Quarterly management review covering incidents, change performance and open risks. Attendees and action owners are recorded.',
    expectedControls: ['CONT-03']
  }),
  ev({
    id: 'EV-010',
    fileName: 'risk-register-export-h1-2026.csv',
    type: 'EXPORT',
    title: 'Risk Register Export, H1 2026',
    documentDate: '2026-07-02',
    period: { start: '2026-01-01', end: '2026-06-30' },
    author: 'Quality Lead',
    summary:
      'Export of the risk register for the first half of 2026. Each row names the supplier or internal owner concerned and the mitigation in place.',
    expectedControls: ['CONT-05', 'CONT-04'],
    missingElements: [gap('CONT-05', 'Risk rating')]
  }),
  ev({
    id: 'EV-011',
    fileName: 'audit-calendar-screenshot.png',
    type: 'SCREENSHOT',
    title: 'Audit Calendar Screenshot',
    documentDate: '2026-09-02',
    author: 'Quality Lead',
    summary:
      'Screenshot of the shared audit calendar showing the internal audit slots of the year. The date displayed on screen differs from the file timestamp.',
    expectedControls: ['CONT-04'],
    seededSituation: 'SCREENSHOT_DATE_TO_CONFIRM',
    dateToConfirm: true
  }),
  ev({
    id: 'EV-012',
    fileName: 'internal-audit-plan-2026.pdf',
    type: 'REPORT',
    title: 'Internal Audit Plan 2026',
    documentDate: '2026-01-08',
    author: 'Quality Lead',
    approver: 'Managing Director',
    approvalDate: '2026-01-12',
    summary:
      'Plan for the 2026 internal audit cycle: audited domains, planned weeks and the named auditor. The plan is approved before the first audit starts.',
    expectedControls: ['CONT-04'],
    missingElements: [gap('CONT-04', 'Findings')]
  })
] as const;

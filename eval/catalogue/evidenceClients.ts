/**
 * Evidence EV-053 … EV-060 — client relationship, plus the R10 document that
 * supports no control at all.
 */

import type { CatalogueEvidence } from './types.ts';
import { ev, gap } from './build.ts';

export const CLIENT_EVIDENCE: readonly CatalogueEvidence[] = [
  ev({
    id: 'EV-053',
    fileName: 'customer-satisfaction-survey-h1-2026.pdf',
    type: 'REPORT',
    title: 'Customer Satisfaction Survey, H1 2026',
    documentDate: '2026-07-08',
    period: { start: '2026-01-01', end: '2026-06-30' },
    author: 'Account Manager',
    summary:
      'Results of the half-year satisfaction survey: response count, score per customer and the actions opened after the survey.',
    expectedControls: ['CONT-26']
  }),
  ev({
    id: 'EV-054',
    fileName: 'service-review-minutes-northwind-aug-2026.docx',
    type: 'MINUTES',
    title: 'Service Review Minutes, Northwind, August 2026',
    documentDate: '2026-08-20',
    author: 'Account Manager',
    approver: 'Managing Director',
    approvalDate: '2026-08-21',
    client: 'Northwind Logistics',
    summary:
      'Quarterly service review with Northwind Logistics: attendees, service performance and the actions agreed with the customer.',
    expectedControls: ['CONT-27']
  }),
  ev({
    id: 'EV-055',
    fileName: 'service-level-report-northwind-sep-2026.pdf',
    type: 'REPORT',
    title: 'Service Level Report, Northwind, September 2026',
    documentDate: '2026-10-02',
    period: { start: '2026-09-01', end: '2026-09-30' },
    author: 'Account Manager',
    client: 'Northwind Logistics',
    summary:
      'Monthly service level report for Northwind Logistics with the measured availability and response levels. The delivery date is not printed on the document.',
    expectedControls: ['CONT-28'],
    missingElements: [gap('CONT-28', 'Delivery date')]
  }),
  ev({
    id: 'EV-056',
    fileName: 'customer-complaint-log-h1-2026.csv',
    type: 'EXPORT',
    title: 'Customer Complaint Log, H1 2026',
    documentDate: '2026-07-03',
    period: { start: '2026-01-01', end: '2026-06-30' },
    author: 'Account Manager',
    client: 'Cobalt Retail',
    summary:
      'Log of customer complaints with receipt date, resolution date and the owner of the resolution for each case.',
    expectedControls: ['CONT-29']
  }),
  ev({
    id: 'EV-057',
    fileName: 'data-processing-agreement-register.xlsx',
    type: 'LIST',
    title: 'Data Processing Agreement Register',
    documentDate: '2026-02-11',
    author: 'Account Manager',
    approver: 'Managing Director',
    approvalDate: '2026-02-16',
    summary:
      'Register of the data handling agreements signed with each customer, with the agreement reference, the signature date and the next review date.',
    expectedControls: ['CONT-30']
  }),
  ev({
    id: 'EV-058',
    fileName: 'service-review-minutes-cobalt-sep-2026.docx',
    type: 'MINUTES',
    title: 'Service Review Minutes, Cobalt, September 2026',
    documentDate: '2026-09-04',
    author: 'Account Manager',
    approver: 'Managing Director',
    approvalDate: '2026-09-07',
    client: 'Cobalt Retail',
    summary:
      'Quarterly service review with Cobalt Retail: attendees, open complaints and the actions agreed with the customer.',
    expectedControls: ['CONT-27']
  }),
  ev({
    id: 'EV-059',
    fileName: 'service-level-report-cobalt-aug-2026.pdf',
    type: 'REPORT',
    title: 'Service Level Report, Cobalt, August 2026',
    documentDate: '2026-09-01',
    period: { start: '2026-08-01', end: '2026-08-31' },
    author: 'Account Manager',
    client: 'Cobalt Retail',
    summary:
      'Monthly service level report for Cobalt Retail with the measured levels and the delivery date. It also lists the complaint raised in August and its resolution.',
    expectedControls: ['CONT-28', 'CONT-29']
  }),
  ev({
    id: 'EV-060',
    fileName: 'office-relocation-plan-2027.pdf',
    type: 'REPORT',
    title: 'Office Relocation Plan 2027',
    documentDate: '2026-10-12',
    author: 'Office Manager',
    approver: 'Managing Director',
    approvalDate: '2026-10-15',
    summary:
      'Plan for moving the head office to another building next year: floor plans, moving schedule and furniture budget. The document has no link to any control of the framework.',
    expectedControls: [],
    seededSituation: 'UNRELATED_EVIDENCE'
  })
] as const;

/**
 * Curated evidence of the offline mock (spec chapter 18.1).
 *
 * Every seeded situation of the demonstration is here: a security policy not
 * reviewed for eighteen months, no restore test this quarter, a rehearsal
 * minute without a recovery time, an unsigned procedure, a document filed in
 * the wrong place, and one document stored twice under two names.
 */

import type {
  AccessLevel,
  AttachmentStatus,
  CollectorKind,
  EvidenceType,
  ReadFlags
} from '../api/types.ts';

/** Instant the demo is frozen at, so every recording looks the same. */
export const DEMO_NOW = '2026-11-11T09:00:00.000Z';

export interface EvidenceSpec {
  id: string;
  /** Controls this document supports. */
  controlIds: string[];
  type: EvidenceType;
  title: string;
  /** Document date, YYYY-MM-DD. */
  date: string;
  author: string | null;
  approver: string | null;
  access: AccessLevel;
  pages: string[];
  /** Covered period, for exports and reports. */
  period?: { start: string | null; end: string | null };
  /** Expected elements the document really contains (defaults to all). */
  missing?: string[];
  /** Attachment status, defaults to APPLIED. */
  status?: AttachmentStatus;
  /** Attachment confidence, defaults to 0.93 when applied, 0.6 when proposed. */
  confidence?: number;
  /** Set to false to seed an attachment whose quote is not in the document. */
  citationOk?: boolean;
  flags?: Partial<ReadFlags>;
  locationKind?: CollectorKind;
  /** Same content stored under another name: points at the first evidence. */
  duplicateOf?: string;
  personalData?: boolean;
  /** Cost of the Bedrock read, in USD. */
  costUsd?: number;
  /** Human note attached to the attachment (why it is proposed, etc.). */
  note?: string;
  /** Older issues kept in the vault but attached to no control (EF-RAT-05). */
  unattached?: boolean;
}

function ev(
  id: string,
  controlIds: string[],
  type: EvidenceType,
  title: string,
  date: string,
  author: string | null,
  approver: string | null,
  pages: string[],
  extra: Partial<EvidenceSpec> = {}
): EvidenceSpec {
  return {
    id,
    controlIds,
    type,
    title,
    date,
    author,
    approver,
    access: 'INTERNAL',
    pages,
    ...extra
  };
}

export const FEATURED_SPECS: EvidenceSpec[] = [
  ev('ev-001', ['GV-01'], 'POLICY', 'Quality policy 2026', '2026-02-10', 'Amina Diallo', 'Claire Fontaine', [
    'Quality policy — Northwind Managed Services. This policy states the commitments of the service organisation: measurable service levels, documented procedures, evidence kept for every commitment, and a management review twice a year.',
    'Scope: all managed services delivered from the Paris and Lyon regions. Document owner: Quality lead. Approved on 10 February 2026 by the managing director. Next review: February 2028. Acknowledgement list attached as ev-002.'
  ]),
  ev('ev-002', ['GV-01'], 'LIST', 'Policy acknowledgement register', '2026-02-20', 'Amina Diallo', 'Claire Fontaine', [
    'Acknowledgement register for the quality policy 2026. Forty-one of forty-three employees acknowledged the policy between 12 and 20 February 2026; the two remaining acknowledgements are scheduled for the March onboarding session.'
  ]),
  ev('ev-003', ['GV-02'], 'REPORT', 'Quality objectives and indicators 2025', '2026-01-20', 'Amina Diallo', 'Claire Fontaine', [
    'Quality objectives 2025 and their measured results. Indicator 1: incident resolution within the agreed service level — 96.4 % over the year, measured monthly from the incident register export.',
    'Indicator 2: change success rate — 98.1 %. Indicator 3: evidence completeness at audit time — 88 %. The measurement method and the reporting period are described in annex 1; the objectives for 2026 were set in the same review.'
  ]),
  ev('ev-004', ['GV-03'], 'LIST', 'Roles and responsibilities matrix v4', '2026-03-02', 'Amina Diallo', 'Claire Fontaine', [
    'Roles and responsibilities matrix, version 4, updated on 2 March 2026. It names the quality lead, the control owners, the service desk manager and the security officer, with the decisions each of them may take.'
  ]),
  ev('ev-005', ['GV-04'], 'MINUTES', 'Management review minutes 2026-05-12', '2026-05-12', 'Amina Diallo', 'Claire Fontaine', [
    'Management review of 12 May 2026. Attendees: managing director, quality lead, service desk manager, security officer. Decisions: renew the backup monitoring collector, fund the disaster recovery rehearsal, and close the two corrective actions of the March incident.',
    'Action items: owner and due date for each of the five actions. The minutes were signed by the managing director on 13 May 2026.'
  ]),
  ev('ev-006', ['GV-04'], 'MINUTES', 'Management review minutes 2025-11-18', '2025-11-18', 'Amina Diallo', 'Claire Fontaine', [
    'Management review of 18 November 2025. Decisions: import the partner framework into the register, appoint control owners per domain, and schedule the first quarterly restore test.'
  ]),
  ev('ev-007', ['GV-05'], 'EXPORT', 'Corrective action tracker export', '2026-09-20', 'Tomás Rivera', 'Amina Diallo', [
    'Corrective action tracker exported on 20 September 2026. Eleven actions, each with an owner, a due date and the closure evidence reference. Nine are closed; two are in progress with a revised due date of 30 November 2026.'
  ]),
  ev('ev-008', ['INC-01'], 'PROCEDURE', 'Incident management procedure v7', '2026-06-01', 'Tomás Rivera', 'Claire Fontaine', [
    'Incident management procedure, version 7. It defines the severity matrix (S1 to S4), the escalation path with the on-call rotation, and the closure rules including the customer communication step.',
    'Approved on 1 June 2026 by the managing director. The procedure applies to every managed service and is referenced by the service desk runbook.'
  ]),
  ev('ev-009', ['INC-02'], 'EXPORT', 'Incident register export October 2026', '2026-11-02', 'Tomás Rivera', 'Claire Fontaine', [
    'Incident register export covering 1 to 31 October 2026. Two hundred and fourteen incidents: eleven S1, forty-two S2, the rest S3 and S4. Each row carries the incident identifier, the severity, the resolution date and the resolution duration.',
    'Median resolution duration for S1 incidents: 2 h 14. Two S1 incidents exceeded the agreed service level; both are covered by a post-incident review.'
  ], { period: { start: '2026-10-01', end: '2026-10-31' }, costUsd: 0.041 }),
  ev('ev-010', ['INC-02'], 'EXPORT', 'Incident register export September 2026', '2026-10-02', 'Tomás Rivera', 'Claire Fontaine', [
    'Incident register export covering 1 to 30 September 2026. One hundred and ninety-eight incidents with severity, resolution date and resolution duration.'
  ], { period: { start: '2026-09-01', end: '2026-09-30' }, costUsd: 0.039 }),
  ev('ev-011', ['INC-03'], 'LIST', 'On-call roster November 2026', '2026-11-01', 'Tomás Rivera', 'Claire Fontaine', [
    'On-call roster for November 2026. Coverage is 24/7 including public holidays; each week names a primary and a secondary engineer with their mobile number and the escalation contacts for the service desk.',
    'Roster compiled by the service desk manager on 1 November 2026.'
  ], { personalData: true, access: 'RESTRICTED' }),
  ev('ev-012', ['INC-04'], 'REPORT', 'Post-incident review INC-2291', '2026-09-18', 'Tomás Rivera', 'Claire Fontaine', [
    'Post-incident review for INC-2291, a database failover that lasted 47 minutes on 12 September 2026. Root cause: a certificate rotation applied outside the change window.',
    'Corrective actions: rotate certificates through the change process, add a monitoring alert on certificate expiry, rehearse the failover in the next continuity test. Reviewed and signed by the service desk manager.'
  ], { status: 'PROPOSED', confidence: 0.74, note: 'Confidence below the review threshold: the control owner must confirm the target control.' }),
  ev('ev-013', ['INC-05'], 'EXPORT', 'Customer incident communications Q3 2026', '2026-10-20', 'Tomás Rivera', 'Claire Fontaine', [
    'Communication log for customer-impacting incidents in Q3 2026. Each row gives the incident reference, the communication timestamps, the channel used and the recipient group. Nine customers were notified within the contractual delay.'
  ], { period: { start: '2026-07-01', end: '2026-09-30' } }),
  ev('ev-014', ['CHG-01'], 'PROCEDURE', 'Change management procedure v5', '2026-04-14', 'Chloé Marchand', 'Claire Fontaine', [
    'Change management procedure, version 5. It defines the change classification (standard, normal, emergency), the approval workflow with the change advisory board, and the emergency path with a post-implementation review.',
    'Approved on 14 April 2026 by the managing director.'
  ]),
  ev('ev-015', ['CHG-02'], 'MINUTES', 'Change advisory board minutes 2026-10-06', '2026-10-06', 'Chloé Marchand', 'Claire Fontaine', [
    'Change advisory board of 6 October 2026. Attendees: change manager, service desk manager, security officer, two customer representatives. Twenty-three changes reviewed, twenty-one approved, two postponed pending a rollback plan.',
    'Decisions and sign-off are recorded at the end of the minutes.'
  ]),
  ev('ev-016', ['CHG-02'], 'MINUTES', 'Change advisory board minutes 2026-09-08', '2026-09-08', 'Chloé Marchand', 'Claire Fontaine', [
    'Change advisory board of 8 September 2026. Nineteen changes reviewed and approved, including the certificate rotation backlog.'
  ]),
  ev('ev-017', ['CHG-04'], 'LIST', 'Configuration baseline v12', '2026-07-01', 'Chloé Marchand', 'Claire Fontaine', [
    'Configuration baseline version 12 for the managed service platforms. Scope: 38 production servers, the backup appliances and the network segments. The change history of the baseline is kept in the configuration management database.',
    'The baseline was approved at the July change advisory board; the printed date is a scan artefact and must be confirmed.'
  ], { flags: { dateToConfirm: true } }),
  ev('ev-018', ['CHG-05'], 'REPORT', 'Release notes 2026.09', '2026-09-30', 'Chloé Marchand', 'Claire Fontaine', [
    'Release notes for version 2026.09, delivered on 30 September 2026. The release fixes the failover regression and ships the new backup dashboard. Test results: 214 automated tests, 2 known defects, no blocker.',
    'Approved by the change manager before deployment.'
  ], { status: 'PROPOSED', confidence: 0.71, note: 'The release notes cite a test report that is not attached yet.' }),
  ev('ev-019', ['BCP-01'], 'POLICY', 'Business continuity plan v3', '2026-01-15', 'Kwame Mensah', 'Claire Fontaine', [
    'Business continuity plan, version 3. Scope: all managed services. The business impact analysis identifies four critical services with a recovery time objective of four hours and a recovery point objective of fifteen minutes.',
    'Approved on 15 January 2026 by the managing director; next review January 2027.'
  ]),
  ev('ev-020', ['BCP-02'], 'REPORT', 'Backup restore test report Q1 2026', '2026-02-10', 'Kwame Mensah', 'Claire Fontaine', [
    'Backup restore test of 10 February 2026 on the customer portal database. Restored system: portal-prod-01. Measured recovery time: 3 h 05, within the four-hour objective. Result: successful, no data loss beyond the fifteen-minute window.',
    'Signed by the continuity owner and countersigned by the managing director.'
  ]),
  ev('ev-021', ['BCP-02'], 'REPORT', 'Backup restore test report Q4 2025', '2025-11-28', 'Kwame Mensah', 'Claire Fontaine', [
    'Backup restore test of 28 November 2025 on the file server cluster. Measured recovery time: 2 h 40. Result: successful.'
  ]),
  ev('ev-022', ['BCP-03'], 'MINUTES', 'Disaster recovery rehearsal minutes 2026-10-28', '2026-10-28', 'Kwame Mensah', 'Claire Fontaine', [
    'Disaster recovery rehearsal of 28 October 2026. Scenarios exercised: loss of the primary region, corruption of the backup catalogue, loss of the identity provider. The team failed over the portal to the secondary region and restored the catalogue from the vault.',
    'Result: the portal was available again after the failover. The minutes record the actions taken and the participants, and were signed by the continuity owner.'
  ], { missing: ['measured recovery time'], note: 'The rehearsal minute does not state a measured recovery time.' }),
  ev('ev-023', ['BCP-04'], 'EXPORT', 'Backup monitoring report October 2026', '2026-11-01', 'Kwame Mensah', 'Claire Fontaine', [
    'Backup monitoring report for October 2026. Four hundred and twelve jobs, three failures, all re-run successfully. Success rate: 99.3 %. Alerting is enabled on every job and on the catalogue integrity check.'
  ], { period: { start: '2026-10-01', end: '2026-10-31' }, costUsd: 0.033 }),
  ev('ev-024', ['SEC-01'], 'POLICY', 'Information security policy v2', '2025-05-04', 'Sofia Novak', 'Claire Fontaine', [
    'Information security policy, version 2. It states the security commitments: least privilege, encryption of data at rest and in transit, yearly awareness training, and a documented review of the policy.',
    'Approved on 4 May 2025 by the managing director. Next review was due in May 2026 and has not been recorded yet.'
  ]),
  ev('ev-025', ['SEC-02'], 'LIST', 'Access control matrix review', '2026-06-15', 'Sofia Novak', 'Claire Fontaine', [
    'Access control matrix reviewed on 15 June 2026. The matrix lists the systems, the roles and their permissions, and the outcome of the six-monthly review: twelve accounts removed, three privileges reduced.',
    'Approved by the security officer.'
  ]),
  ev('ev-026', ['SEC-03'], 'PROCEDURE', 'Privileged access procedure v4', '2026-03-11', 'Sofia Novak', null, [
    'Privileged access procedure, version 4. It defines the approval workflow for administrative accounts, the session recording on production systems, and the quarterly review of the privileged accounts.'
  ], { missing: ['approver'], note: 'The procedure carries no signature: the approver line is empty.' }),
  ev('ev-027', ['SEC-04'], 'EXPORT', 'Security monitoring report October 2026', '2026-10-15', 'Sofia Novak', 'Claire Fontaine', [
    'Security monitoring report for October 2026. Two hundred and thirty alerts raised, forty-one blocked events, eleven false positives after triage. No confirmed intrusion. The report covers the period from 1 to 15 October 2026.'
  ], { period: { start: '2026-10-01', end: '2026-10-15' } }),
  ev('ev-028', ['SEC-05'], 'POLICY', 'Encryption and key management standard', '2026-01-02', 'Sofia Novak', 'Claire Fontaine', [
    'Encryption and key management standard. Data at rest is encrypted with KMS customer managed keys, rotated every twelve months. The custodian of each key is named in annex 1. Approved on 2 January 2026.'
  ]),
  ev('ev-029', ['CSM-01'], 'REPORT', 'Customer satisfaction survey H1 2026', '2026-09-01', 'Julien Perrin', 'Claire Fontaine', [
    'Customer satisfaction survey for the first half of 2026. Survey period: 1 March to 30 June 2026. Forty-one respondents out of sixty-two customers. Overall satisfaction score: 8.4 out of 10, measured with the annual questionnaire.'
  ], { period: { start: '2026-03-01', end: '2026-06-30' } }),
  ev('ev-030', ['CSM-02'], 'REPORT', 'Service level review Q2 2026', '2026-06-30', 'Julien Perrin', 'Claire Fontaine', [
    'Service level review for the second quarter of 2026. Agreement version 4. Measured indicators: availability 99.96 %, incident resolution 95.2 %, change success 98.7 %. The review was held with the customer and the minutes are signed by both parties.'
  ]),
  ev('ev-031', ['CSM-03'], 'EXPORT', 'Complaint handling log Q3 2026', '2026-10-05', 'Julien Perrin', 'Claire Fontaine', [
    'Complaint handling log for Q3 2026. Seven complaints received, each with its identifier, the received date, the resolution date and the documented outcome. Six were closed within the agreed delay; one is waiting for the customer answer.'
  ], { period: { start: '2026-07-01', end: '2026-09-30' }, personalData: true }),
  ev('ev-032', ['INC-05'], 'EXPORT', 'Emergency change register September 2026', '2026-09-30', 'Chloé Marchand', 'Claire Fontaine', [
    'Emergency change register for September 2026. Four emergency changes, each with its identifier, the approval timestamp and the post-implementation review reference. The register was filed in the incident exports folder by mistake.'
  ], {
    status: 'PROPOSED',
    confidence: 0.58,
    locationKind: 'MANUAL',
    note: 'Filed under the incident exports although it is a change record: the target control is probably wrong.'
  }),
  ev('ev-033', ['SEC-02'], 'LIST', 'Access control matrix review (scanned copy)', '2026-06-15', 'Sofia Novak', 'Claire Fontaine', [
    'Access control matrix reviewed on 15 June 2026. The matrix lists the systems, the roles and their permissions, and the outcome of the six-monthly review: twelve accounts removed, three privileges reduced.'
  ], { duplicateOf: 'ev-025' }),
  ev('ev-034', ['INC-02'], 'SCREENSHOT', 'Backup console screenshot 2026-10-30', '2026-10-30', null, null, [
    'Screenshot of the backup console. The text is too small to be read reliably; the date shown on the screen does not match the file date.'
  ], {
    status: 'REJECTED',
    citationOk: false,
    flags: { unreadable: true, missingAuthor: true, dateToConfirm: true },
    personalData: true,
    access: 'RESTRICTED',
    note: 'The quote returned by the model is not present in the document: the attachment was rejected.'
  })
];

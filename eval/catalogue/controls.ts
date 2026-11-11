/**
 * The 30 controls of the demonstration framework, five per domain.
 *
 * Written for the hackathon from common service-management and security
 * practice: no protected framework text is reproduced here (spec 16.1).
 * Shaped after Annex A, so the demo can import it as-is with `POST /v1/frameworks`.
 */

import type { CatalogueControl, DomainId, Periodicity } from './types.ts';
import { controlId } from './types.ts';

function c(
  n: number,
  domain: DomainId,
  title: string,
  requirement: string,
  expectedEvidence: string[],
  periodicity: Periodicity,
  owner: string,
  mandatory: boolean
): CatalogueControl {
  return {
    id: controlId(n),
    domain,
    title,
    requirement,
    expectedEvidence,
    periodicity,
    owner,
    mandatory
  };
}

export const CONTROLS: readonly CatalogueControl[] = [
  /* ---------------------------------------------------------- governance */
  c(
    1,
    'governance',
    'Information security policy reviewed annually',
    'The information security policy is reviewed, updated where needed and approved at least once a year.',
    ['Policy title', 'Review date', 'Approver name', 'Version'],
    'P1Y',
    'quality.lead',
    true
  ),
  c(
    2,
    'governance',
    'Roles and responsibilities defined and reviewed',
    'Roles and responsibilities for service delivery and security are documented, assigned and reviewed at least once a year.',
    ['Document title', 'Role list', 'Review date', 'Approver name'],
    'P1Y',
    'quality.lead',
    true
  ),
  c(
    3,
    'governance',
    'Management review of the service management system',
    'Management reviews service performance, risks and improvements at least every quarter and records its decisions.',
    ['Meeting date', 'Attendees', 'Decisions recorded', 'Action owners'],
    'P3M',
    'managing.director',
    true
  ),
  c(
    4,
    'governance',
    'Internal audit programme executed',
    'An internal audit programme covers the framework scope every year and records findings and their owners.',
    ['Audit plan', 'Scope covered', 'Findings', 'Auditor name'],
    'P1Y',
    'quality.lead',
    true
  ),
  c(
    5,
    'governance',
    'Supplier and subcontractor register maintained',
    'Suppliers and subcontractors are listed, assessed for risk and their contract is reviewed twice a year.',
    ['Supplier name', 'Service provided', 'Contract review date', 'Risk rating'],
    'P6M',
    'procurement.lead',
    false
  ),

  /* ------------------------------------------------ incident management */
  c(
    6,
    'incident_management',
    'Incident register maintained and reviewed',
    'Every incident is recorded in a register that is reviewed monthly, with its severity and its closure date.',
    ['Reporting period', 'Incident count', 'Severity breakdown', 'Closure dates'],
    'P1M',
    'service.desk.manager',
    true
  ),
  c(
    7,
    'incident_management',
    'Major incidents have a post-incident review',
    'Every major incident is reviewed after resolution: root cause, corrective actions and a named signatory.',
    ['Incident reference', 'Root cause', 'Corrective actions', 'Review date', 'Signatory name'],
    'P3M',
    'service.desk.manager',
    true
  ),
  c(
    8,
    'incident_management',
    'Incident response times measured against targets',
    'Response times are measured monthly against the committed targets and breaches are counted.',
    ['Reporting period', 'Target response time', 'Measured response time', 'Breach count'],
    'P1M',
    'service.desk.manager',
    false
  ),
  c(
    9,
    'incident_management',
    'Security incidents notified to the customer',
    'Security incidents affecting a customer are notified through the agreed channel within the agreed delay.',
    ['Incident reference', 'Customer notified date', 'Notification channel', 'Notification owner'],
    'P6M',
    'security.officer',
    true
  ),
  c(
    10,
    'incident_management',
    'Recurring incidents analysed as problems',
    'Recurring incidents are grouped into problem records with a root cause and a permanent fix.',
    ['Problem record', 'Recurrence evidence', 'Root cause', 'Permanent fix'],
    'P3M',
    'service.desk.manager',
    false
  ),

  /* -------------------------------------------------- change management */
  c(
    11,
    'change_management',
    'Changes approved before implementation',
    'Every production change is approved by a named approver before it is implemented.',
    ['Change reference', 'Approval date', 'Approver name', 'Implementation date'],
    'P1M',
    'change.manager',
    true
  ),
  c(
    12,
    'change_management',
    'Emergency changes reviewed afterwards',
    'Emergency changes are justified when raised and reviewed by a second person after implementation.',
    ['Emergency change reference', 'Justification', 'Post-implementation review date', 'Reviewer name'],
    'P3M',
    'change.manager',
    true
  ),
  c(
    13,
    'change_management',
    'Change success measured',
    'The share of successful changes and the number of rollbacks are measured every quarter.',
    ['Reporting period', 'Change count', 'Failed change count', 'Rollback count'],
    'P3M',
    'change.manager',
    false
  ),
  c(
    14,
    'change_management',
    'Configuration baseline of managed environments',
    'A configuration baseline of the managed environments is approved and refreshed twice a year.',
    ['Baseline date', 'Systems covered', 'Configuration items', 'Approver name'],
    'P6M',
    'platform.lead',
    true
  ),
  c(
    15,
    'change_management',
    'Segregation of duties on production access',
    'Requesting, approving and granting production access are performed by different roles.',
    ['Process description', 'Roles separated', 'Review date', 'Approver name'],
    'P1Y',
    'platform.lead',
    true
  ),

  /* --------------------------------------------------------- continuity */
  c(
    16,
    'continuity',
    'Backup restoration tested',
    'Backups of the managed environments are tested by a real restore at a defined interval.',
    ['Test date', 'System or dataset restored', 'Measured recovery time', 'Test result', 'Signatory name'],
    'P3M',
    'operations.lead',
    true
  ),
  c(
    17,
    'continuity',
    'Business continuity plan reviewed',
    'The business continuity plan is reviewed and approved once a year and covers every managed service.',
    ['Plan title', 'Review date', 'Approver name', 'Services covered'],
    'P1Y',
    'operations.lead',
    true
  ),
  c(
    18,
    'continuity',
    'Recovery objectives defined per service',
    'Every managed service has an approved recovery time objective and recovery point objective.',
    ['Service name', 'Recovery time objective', 'Recovery point objective', 'Approval date'],
    'P1Y',
    'operations.lead',
    true
  ),
  c(
    19,
    'continuity',
    'Backup jobs complete and are monitored',
    'Backup jobs are monitored monthly and failed jobs are counted and followed up.',
    ['Reporting period', 'Backup job count', 'Failed job count', 'Monitoring evidence'],
    'P1M',
    'operations.lead',
    true
  ),
  c(
    20,
    'continuity',
    'Continuity exercise run with a customer scenario',
    'A continuity exercise based on a customer scenario is run once a year and its lessons are recorded.',
    ['Exercise date', 'Scenario described', 'Participants', 'Lessons recorded'],
    'P1Y',
    'operations.lead',
    false
  ),

  /* ----------------------------------------------------------- security */
  c(
    21,
    'security',
    'Privileged access reviewed quarterly',
    'Privileged accounts are reviewed every quarter and unnecessary access is removed.',
    ['Review date', 'Accounts reviewed', 'Removals made', 'Reviewer name'],
    'P3M',
    'security.officer',
    true
  ),
  c(
    22,
    'security',
    'Security awareness training completed',
    'Every employee completes security awareness training once a year and completion is tracked.',
    ['Training period', 'Participant count', 'Completion rate', 'Training owner'],
    'P1Y',
    'security.officer',
    true
  ),
  c(
    23,
    'security',
    'Vulnerability scans run and findings tracked',
    'Managed systems are scanned monthly and findings carry severity and remediation deadlines.',
    ['Scan date', 'Systems scanned', 'Findings by severity', 'Remediation deadlines'],
    'P1M',
    'security.officer',
    true
  ),
  c(
    24,
    'security',
    'Data encrypted at rest and in transit',
    'Data at rest and in transit is encrypted with managed keys, and the control is described and approved.',
    ['Control description', 'Services covered', 'Key management detail', 'Approver name'],
    'P1Y',
    'platform.lead',
    true
  ),
  c(
    25,
    'security',
    'Personnel screened before privileged access',
    'Personnel granted privileged access are screened before the access is granted.',
    ['Screening type', 'Role covered', 'Completion date', 'Record owner'],
    'P1Y',
    'hr.lead',
    false
  ),

  /* ------------------------------------------------ client relationship */
  c(
    26,
    'client_relationship',
    'Customer satisfaction measured',
    'Customer satisfaction is measured twice a year and the results lead to recorded actions.',
    ['Survey period', 'Response count', 'Satisfaction score', 'Actions taken'],
    'P6M',
    'account.manager',
    false
  ),
  c(
    27,
    'client_relationship',
    'Service reviews held with each customer',
    'Each customer has a service review every quarter with minutes and agreed actions.',
    ['Customer name', 'Review date', 'Attendees', 'Agreed actions'],
    'P3M',
    'account.manager',
    true
  ),
  c(
    28,
    'client_relationship',
    'Service level reports delivered',
    'A service level report is delivered to each customer every month with the measured levels.',
    ['Reporting period', 'Customer name', 'Service levels reported', 'Delivery date'],
    'P1M',
    'account.manager',
    true
  ),
  c(
    29,
    'client_relationship',
    'Customer complaints handled within the agreed delay',
    'Customer complaints are recorded and resolved within the agreed delay by a named owner.',
    ['Complaint reference', 'Receipt date', 'Resolution date', 'Resolution owner'],
    'P6M',
    'account.manager',
    true
  ),
  c(
    30,
    'client_relationship',
    'Customer data handling agreement on file',
    'Every customer has a signed data handling agreement that is reviewed once a year.',
    ['Customer name', 'Agreement reference', 'Signature date', 'Review date'],
    'P1Y',
    'account.manager',
    true
  )
] as const;

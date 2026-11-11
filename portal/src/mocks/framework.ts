/**
 * Demo framework for the offline mock: 30 controls spread over six domains.
 *
 * The text is written for the demonstration (spec chapter 16.1): no protected
 * reference material, no real customer data. The portal imports the partner's
 * own framework in production.
 */

import type { Control } from '../api/types.ts';

export const DEMO_FRAMEWORK_ID = 'fw-msp-demo';

export const DOMAINS = [
  'Governance',
  'Incident management',
  'Change management',
  'Continuity',
  'Security',
  'Customer relationship'
] as const;

export const OWNERS = [
  'Amina Diallo',
  'Tomás Rivera',
  'Chloé Marchand',
  'Kwame Mensah',
  'Sofia Novak',
  'Julien Perrin'
] as const;

export interface ControlSpec {
  id: string;
  domain: string;
  title: string;
  requirement: string;
  expected: string[];
  periodicity: string;
  owner: string;
  mandatory: boolean;
}

function ctl(
  id: string,
  domain: string,
  title: string,
  requirement: string,
  expected: string[],
  periodicity: string,
  owner: string,
  mandatory = false
): ControlSpec {
  return { id, domain, title, requirement, expected, periodicity, owner, mandatory };
}

/** The 30 demo controls, five per domain. */
export const CONTROL_SPECS: ControlSpec[] = [
  ctl(
    'GV-01',
    'Governance',
    'Quality policy',
    'A quality policy states the commitments of the service organisation and is reviewed by the management.',
    ['policy statement', 'document owner', 'approval date', 'review date', 'acknowledgement list'],
    'P2Y',
    OWNERS[0],
    true
  ),
  ctl(
    'GV-02',
    'Governance',
    'Quality objectives and indicators',
    'Quality objectives are measured, published and reviewed at least yearly.',
    ['objective statement', 'measurement method', 'reporting period', 'measured results'],
    'P1Y',
    OWNERS[0],
    true
  ),
  ctl(
    'GV-03',
    'Governance',
    'Roles and responsibilities matrix',
    'The responsibilities of every quality role are written down and kept current.',
    ['role matrix', 'update date', 'approval'],
    'P1Y',
    OWNERS[0]
  ),
  ctl(
    'GV-04',
    'Governance',
    'Management review minutes',
    'Management reviews the quality system at least twice a year and records the decisions.',
    ['review date', 'attendees', 'decisions', 'action items', 'sign-off'],
    'P6M',
    OWNERS[0],
    true
  ),
  ctl(
    'GV-05',
    'Governance',
    'Corrective action tracking',
    'Corrective actions are tracked until their closure is evidenced.',
    ['action list', 'owner per action', 'due date', 'closure evidence'],
    'P3M',
    OWNERS[0]
  ),
  ctl(
    'INC-01',
    'Incident management',
    'Incident management procedure',
    'Incidents are triaged, escalated and closed following a written procedure.',
    ['procedure', 'severity matrix', 'escalation path', 'approver'],
    'P1Y',
    OWNERS[1],
    true
  ),
  ctl(
    'INC-02',
    'Incident management',
    'Incident register export',
    'The incident register is exported every month with resolution times.',
    ['period covered', 'incident identifiers', 'severity', 'resolution date', 'resolution duration'],
    'P1M',
    OWNERS[1],
    true
  ),
  ctl(
    'INC-03',
    'Incident management',
    'On-call roster',
    'The on-call roster covers every period, including holidays and leave.',
    ['roster period', 'coverage hours', 'escalation contacts'],
    'P1M',
    OWNERS[1]
  ),
  ctl(
    'INC-04',
    'Incident management',
    'Post-incident review report',
    'Significant incidents produce a review with root cause and corrective actions.',
    ['incident reference', 'root cause', 'corrective actions', 'sign-off'],
    'P3M',
    OWNERS[1]
  ),
  ctl(
    'INC-05',
    'Incident management',
    'Customer communication log',
    'Customers affected by an incident receive a documented communication.',
    ['incident reference', 'communication timestamps', 'channel', 'recipient group'],
    'P3M',
    OWNERS[1]
  ),
  ctl(
    'CHG-01',
    'Change management',
    'Change management procedure',
    'Changes follow a written procedure with classification and approval.',
    ['procedure', 'change classification', 'approval workflow', 'approver'],
    'P1Y',
    OWNERS[2],
    true
  ),
  ctl(
    'CHG-02',
    'Change management',
    'Change advisory board minutes',
    'The change advisory board records every change it reviews.',
    ['meeting date', 'attendees', 'changes reviewed', 'decisions', 'sign-off'],
    'P1M',
    OWNERS[2],
    true
  ),
  ctl(
    'CHG-03',
    'Change management',
    'Emergency change register',
    'Emergency changes are registered, approved and reviewed after the fact.',
    ['change identifiers', 'approval timestamps', 'post-implementation review', 'period covered'],
    'P1M',
    OWNERS[2]
  ),
  ctl(
    'CHG-04',
    'Change management',
    'Configuration management baseline',
    'The configuration baseline of the managed services is versioned and approved.',
    ['baseline version', 'scope', 'approval date', 'change history'],
    'P6M',
    OWNERS[2]
  ),
  ctl(
    'CHG-05',
    'Change management',
    'Release notes and test evidence',
    'Each release ships with release notes and the evidence of its tests.',
    ['release version', 'test results', 'release date', 'approver'],
    'P3M',
    OWNERS[2]
  ),
  ctl(
    'BCP-01',
    'Continuity',
    'Business continuity plan',
    'The continuity plan states the recovery objectives and is approved by the management.',
    ['plan scope', 'business impact analysis', 'recovery objectives', 'approver', 'review date'],
    'P1Y',
    OWNERS[3],
    true
  ),
  ctl(
    'BCP-02',
    'Continuity',
    'Backup restore test',
    'A restore test is run every quarter and reports the measured recovery time.',
    ['test date', 'restored system', 'measured recovery time', 'result', 'signatory'],
    'P3M',
    OWNERS[3],
    true
  ),
  ctl(
    'BCP-03',
    'Continuity',
    'Disaster recovery rehearsal',
    'A disaster recovery rehearsal exercises the plan and measures the recovery time.',
    ['rehearsal date', 'scenarios exercised', 'measured recovery time', 'result', 'sign-off'],
    'P6M',
    OWNERS[3]
  ),
  ctl(
    'BCP-04',
    'Continuity',
    'Backup monitoring report',
    'Backup jobs are monitored and failures are reported every month.',
    ['period covered', 'backup job failures', 'success rate', 'alerting status'],
    'P1M',
    OWNERS[3]
  ),
  ctl(
    'BCP-05',
    'Continuity',
    'Crisis communication plan',
    'The crisis communication plan lists the recipients and the approved wording.',
    ['plan scope', 'contact list', 'approval date'],
    'P1Y',
    OWNERS[3]
  ),
  ctl(
    'SEC-01',
    'Security',
    'Information security policy',
    'The information security policy is approved, acknowledged and reviewed at least yearly.',
    ['policy statement', 'scope', 'approver', 'review date', 'employee acknowledgement'],
    'P1Y',
    OWNERS[4],
    true
  ),
  ctl(
    'SEC-02',
    'Security',
    'Access control matrix',
    'Access rights are reviewed every six months against a written matrix.',
    ['system list', 'roles and permissions', 'review date', 'approver'],
    'P6M',
    OWNERS[4],
    true
  ),
  ctl(
    'SEC-03',
    'Security',
    'Privileged access procedure',
    'Privileged access is granted through a written procedure with recorded sessions.',
    ['procedure', 'approval workflow', 'session recording', 'approver'],
    'P1Y',
    OWNERS[4]
  ),
  ctl(
    'SEC-04',
    'Security',
    'Security monitoring report',
    'Security monitoring results are reviewed every month.',
    ['period covered', 'alerts raised', 'blocked events', 'false positives'],
    'P1M',
    OWNERS[4]
  ),
  ctl(
    'SEC-05',
    'Security',
    'Encryption and key management standard',
    'Encryption keys are rotated and custodians are named in a written standard.',
    ['standard', 'key rotation period', 'custodian', 'approval date'],
    'P1Y',
    OWNERS[4]
  ),
  ctl(
    'CSM-01',
    'Customer relationship',
    'Customer satisfaction survey',
    'Customer satisfaction is measured by survey every six months.',
    ['survey period', 'respondent count', 'satisfaction score', 'method'],
    'P6M',
    OWNERS[5]
  ),
  ctl(
    'CSM-02',
    'Customer relationship',
    'Service level agreement and review',
    'Service levels are measured and reviewed with the customer.',
    ['agreement version', 'measured indicators', 'review date', 'customer sign-off'],
    'P1Y',
    OWNERS[5],
    true
  ),
  ctl(
    'CSM-03',
    'Customer relationship',
    'Complaint handling log',
    'Complaints are logged and closed with a documented outcome.',
    ['complaint identifiers', 'received date', 'resolution date', 'outcome'],
    'P3M',
    OWNERS[5]
  ),
  ctl(
    'CSM-04',
    'Customer relationship',
    'Customer onboarding checklist',
    'Each new customer goes through a signed onboarding checklist.',
    ['customer list', 'checklist template', 'signed checklist'],
    'P1Y',
    OWNERS[5]
  ),
  ctl(
    'CSM-05',
    'Customer relationship',
    'Continuous improvement backlog',
    'Improvement actions are tracked with an owner and a target date.',
    ['improvement items', 'owner per item', 'target date', 'status'],
    'P6M',
    OWNERS[5]
  )
];

/** Turns the specs into the `Control` entity of the API. */
export function buildControls(frameworkId: string): Control[] {
  return CONTROL_SPECS.map((spec) => ({
    id: spec.id,
    frameworkId,
    domain: spec.domain,
    title: spec.title,
    requirement: spec.requirement,
    expectedEvidence: spec.expected,
    periodicity: spec.periodicity,
    owner: spec.owner,
    mandatory: spec.mandatory
  }));
}

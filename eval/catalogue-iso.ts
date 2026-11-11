/**
 * A second, fictional management-system framework — `demo-iso`.
 *
 * Why a second framework: an MSP passes several audits a year and hunts the same
 * evidence each time. This set exists so the cross-framework mapping (axis 2)
 * can be demonstrated on data that ships with the repository.
 *
 * **No normative text is reproduced here.** The titles and requirements below
 * were written for this project, in the same spirit as `demo-msp`, and describe
 * a fictional managed service provider. A partner imports their own framework
 * from a file; the tool never embeds one (spec 7 and 16.1).
 */

import type { ControlInput, FrameworkImport } from '../src/domain/types.ts';

/** Domains of the second demonstration framework. */
export const ISO_DOMAINS = ['policy', 'operations', 'security', 'interested-parties'] as const;

export type IsoDomain = (typeof ISO_DOMAINS)[number];

/** A control of the second framework, plus the `demo-msp` controls it echoes. */
export interface IsoControl {
  id: string;
  domain: IsoDomain;
  title: string;
  requirement: string;
  expectedEvidence: string[];
  periodicity: string;
  owner: string;
  mandatory: boolean;
  /** Controls of `demo-msp` this one is expected to correspond to. */
  equivalents: string[];
}

export const ISO_FRAMEWORK = {
  id: 'demo-iso',
  name: 'Demonstration management-system framework',
  version: '1.0'
} as const;

function c(
  n: number,
  domain: IsoDomain,
  title: string,
  requirement: string,
  expectedEvidence: string[],
  periodicity: string,
  owner: string,
  mandatory: boolean,
  equivalents: string[]
): IsoControl {
  return {
    id: `ISO-${String(n).padStart(2, '0')}`,
    domain,
    title,
    requirement,
    expectedEvidence,
    periodicity,
    owner,
    mandatory,
    equivalents
  };
}

export const ISO_CONTROLS: readonly IsoControl[] = [
  /* ---------------------------------------------------------------- policy */
  c(
    1,
    'policy',
    'Documented information of the management system is controlled',
    'The documented information that supports the management system is reviewed, approved and kept current at a planned frequency.',
    ['Document title', 'Review date', 'Approver name', 'Version'],
    'P1Y',
    'quality.lead',
    true,
    ['CONT-01', 'CONT-02']
  ),
  c(
    2,
    'policy',
    'Leadership reviews the management system at planned intervals',
    'Top management reviews the management system at planned intervals and records the decisions taken.',
    ['Review date', 'Attendees', 'Decisions recorded', 'Next review date'],
    'P3M',
    'managing.director',
    true,
    ['CONT-03']
  ),
  c(
    3,
    'policy',
    'An internal audit programme is planned and carried out',
    'An internal audit programme covering the management system is planned, carried out and its findings tracked to closure.',
    ['Audit plan', 'Audit date', 'Auditor name', 'Findings', 'Remediation deadlines'],
    'P1Y',
    'quality.lead',
    true,
    ['CONT-04']
  ),

  /* ------------------------------------------------------------ operations */
  c(
    4,
    'operations',
    'Operational incidents are recorded, classified and reviewed',
    'Incidents affecting delivered services are recorded, classified by severity and reviewed periodically for recurring causes.',
    ['Period covered', 'Incident count', 'Severity breakdown', 'Reviewer name'],
    'P1M',
    'service.desk.manager',
    true,
    ['CONT-06', 'CONT-10']
  ),
  c(
    5,
    'operations',
    'Changes to production are authorised before implementation',
    'Changes to production environments are authorised before implementation, and emergency changes are reviewed afterwards.',
    ['Change identifier', 'Authoriser name', 'Implementation date', 'Review date for emergency changes'],
    'P1M',
    'change.manager',
    true,
    ['CONT-11', 'CONT-12']
  ),
  c(
    6,
    'operations',
    'Business continuity arrangements are exercised',
    'Business continuity arrangements, including restoration of backups, are exercised with a realistic scenario and the results recorded.',
    ['Exercise date', 'Scenario described', 'Measured recovery time', 'Result', 'Signatory name'],
    'P3M',
    'operations.lead',
    true,
    ['CONT-16', 'CONT-20']
  ),

  /* -------------------------------------------------------------- security */
  c(
    7,
    'security',
    'Access to information and systems is restricted and reviewed',
    'Access to information and to production systems is restricted to those who need it, and privileged access is reviewed periodically.',
    ['Review period', 'Accounts reviewed', 'Reviewer name', 'Removals performed'],
    'P3M',
    'security.officer',
    true,
    ['CONT-21', 'CONT-15']
  ),
  c(
    8,
    'security',
    'Information is protected against loss and unauthorised disclosure',
    'Information held for customers is protected against loss and against unauthorised disclosure, in storage and in transit.',
    ['Encryption scope', 'Standard or algorithm', 'Verification date', 'Owner name'],
    'P1Y',
    'platform.lead',
    true,
    ['CONT-24', 'CONT-19']
  ),
  c(
    9,
    'security',
    'Personnel handling sensitive information are vetted and trained',
    'Personnel with access to sensitive information are screened before access is granted and complete awareness training each year.',
    ['Population covered', 'Completion rate', 'Training date', 'Signatory name'],
    'P1Y',
    'hr.lead',
    true,
    ['CONT-22', 'CONT-25']
  ),

  /* -------------------------------------------------- interested parties */
  c(
    10,
    'interested-parties',
    'The needs of interested parties are monitored',
    'The needs and expectations of customers and other interested parties are collected, monitored and acted upon.',
    ['Period covered', 'Method used', 'Result or score', 'Actions decided'],
    'P6M',
    'account.manager',
    false,
    ['CONT-26', 'CONT-27']
  ),
  c(
    11,
    'interested-parties',
    'External providers are evaluated before and during the relationship',
    'External providers that affect delivered services are evaluated before engagement and monitored afterwards.',
    ['Provider name', 'Evaluation date', 'Criteria applied', 'Decision'],
    'P6M',
    'procurement.lead',
    true,
    ['CONT-05']
  ),
  c(
    12,
    'interested-parties',
    'Contractual and legal obligations are identified and met',
    'Contractual and legal obligations towards customers are identified, tracked and reported on at the agreed frequency.',
    ['Obligation identified', 'Reporting period', 'Delivery date', 'Recipient'],
    'P1M',
    'account.manager',
    true,
    ['CONT-30', 'CONT-28']
  )
];

const ISO_BY_ID = new Map(ISO_CONTROLS.map((control) => [control.id, control]));

/** Looks a control up by id; `undefined` when unknown. */
export function findIsoControl(id: string): IsoControl | undefined {
  return ISO_BY_ID.get(id);
}

function toControlInput(control: IsoControl): ControlInput {
  return {
    id: control.id,
    domain: control.domain,
    title: control.title,
    requirement: control.requirement,
    expectedEvidence: [...control.expectedEvidence],
    periodicity: control.periodicity,
    owner: control.owner,
    mandatory: control.mandatory
  };
}

/** The second framework as an import payload (Annex A shape). */
export function toIsoFrameworkImport(): FrameworkImport {
  return {
    framework: {
      ...ISO_FRAMEWORK,
      confidentiality: 'INTERNAL',
      source: 'second demonstration set written for the hackathon'
    },
    controls: ISO_CONTROLS.map(toControlInput)
  };
}

/** Every equivalence declared by the catalogue, as (source, target) pairs. */
export function declaredEquivalences(): Array<{ iso: string; msp: string }> {
  const out: Array<{ iso: string; msp: string }> = [];
  for (const control of ISO_CONTROLS) {
    for (const equivalent of control.equivalents) out.push({ iso: control.id, msp: equivalent });
  }
  return out;
}

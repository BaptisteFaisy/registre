/**
 * Builds the mock evidence set: the curated documents of `evidenceSpecs.ts`
 * plus one superseded issue per covered control, so the register holds about
 * sixty files with varied shapes (spec chapter 18.1).
 */

import type { Evidence, EvidenceType, TextPage } from '../api/types.ts';
import { CONTROL_SPECS } from './framework.ts';
import { FEATURED_SPECS } from './evidenceSpecs.ts';
import type { EvidenceSpec } from './evidenceSpecs.ts';
import { hexDigest, seededInt } from './deterministic.ts';

const CONTENT_TYPES: Record<EvidenceType, string> = {
  POLICY: 'application/pdf',
  PROCEDURE: 'application/pdf',
  MINUTES: 'application/pdf',
  REPORT: 'application/pdf',
  EXPORT: 'text/csv',
  SCREENSHOT: 'image/png',
  LIST: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ATTESTATION: 'application/pdf'
};

/** Months covered by a periodicity token, used to date the previous issue. */
function monthsOf(periodicity: string): number {
  const match = /^P(\d+)([DWMY])$/.exec(periodicity);
  if (!match) return 12;
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit === 'D') return Math.max(1, Math.round(amount / 30));
  if (unit === 'W') return Math.max(1, Math.round((amount * 7) / 30));
  if (unit === 'M') return amount;
  return amount * 12;
}

/** Shifts a YYYY-MM-DD date back by a number of months. */
function monthsBack(dateIso: string, months: number): string {
  const date = new Date(`${dateIso.slice(0, 10)}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.toISOString().slice(0, 10);
}

/** A superseded issue of the control's main document, kept in the vault. */
function previousIssue(spec: EvidenceSpec, controlId: string, index: number): EvidenceSpec {
  const control = CONTROL_SPECS.find((item) => item.id === controlId);
  const periodicity = control?.periodicity ?? 'P1Y';
  const date = monthsBack(spec.date, monthsOf(periodicity) + 1);
  return {
    id: `ev-${String(35 + index).padStart(3, '0')}`,
    controlIds: [controlId],
    type: spec.type,
    title: `${spec.title} (superseded issue)`,
    date,
    author: spec.author,
    approver: spec.approver,
    access: spec.access,
    pages: [
      `${spec.title}, superseded issue dated ${date}. The document states ${(control?.expected ?? []).join(', ')} for the ${control?.domain ?? 'service'} process.`,
      `Approved by ${spec.approver ?? 'the quality lead'}. Kept in the vault for the retention period and replaced by a newer issue.`
    ],
    locationKind: spec.locationKind ?? 'S3',
    // A superseded issue of a document that is still under review stays in the
    // vault without being attached: it supports no control on its own (EF-RAT-05).
    unattached: spec.status === 'PROPOSED'
  };
}

/** Curated documents plus one superseded issue per covered control. */
export function buildSpecs(): EvidenceSpec[] {
  const covered = new Set<string>();
  for (const spec of FEATURED_SPECS) for (const id of spec.controlIds) covered.add(id);

  const older: EvidenceSpec[] = [];
  for (const controlId of covered) {
    const reference = FEATURED_SPECS.find((spec) => spec.controlIds.includes(controlId));
    if (!reference) continue;
    older.push(previousIssue(reference, controlId, older.length));
  }
  return [...FEATURED_SPECS, ...older];
}

/** Turns a spec into the `Evidence` entity returned by the API. */
export function evidenceFromSpec(spec: EvidenceSpec, all: readonly EvidenceSpec[] = []): Evidence {
  const original = spec.duplicateOf ? all.find((item) => item.id === spec.duplicateOf) : undefined;
  const textPages: TextPage[] = spec.pages.map((text, position) => ({
    page: position + 1,
    text
  }));
  return {
    id: spec.id,
    sha256: hexDigest(original ? `${original.id}-content` : `${spec.id}-content`),
    revision: original ? 2 : 1,
    fields: {
      type: spec.type,
      title: spec.title,
      documentDate: spec.date,
      period: spec.period ?? { start: null, end: null },
      version: null,
      author: spec.author,
      approver: spec.approver,
      approvalDate: spec.approver ? spec.date : null,
      client: 'Northwind Managed Services',
      summary: spec.pages[0]?.slice(0, 180) ?? null,
      personalData: spec.personalData ?? false
    },
    flags: {
      unreadable: false,
      missingDate: false,
      missingAuthor: false,
      dateToConfirm: false,
      ...spec.flags
    },
    accessLevel: spec.access,
    locations: locations(spec),
    textPages,
    sizeBytes: seededInt(`${spec.id}-size`, 42_000, 1_800_000),
    contentType: CONTENT_TYPES[spec.type],
    ingestedAt: `${spec.date}T06:15:00.000Z`,
    reader: 'bedrock-data-automation',
    cost: {
      usd: spec.costUsd ?? 0.031,
      tokensIn: seededInt(`${spec.id}-in`, 1_800, 9_000),
      tokensOut: seededInt(`${spec.id}-out`, 240, 1_400),
      source: 'bedrock-data-automation'
    }
  };
}

/** Storage locations of a document; a duplicate carries both objects. */
function locations(spec: EvidenceSpec) {
  const kind = spec.locationKind ?? 'S3';
  const month = spec.date.slice(0, 7);
  const primary = {
    kind,
    uri: `s3://northwind-evidence-vault/${month}/${spec.id}.pdf`,
    collectedAt: `${spec.date}T06:12:00.000Z`
  };
  if (!spec.duplicateOf) return [primary];
  return [
    primary,
    {
      kind: 'MANUAL' as const,
      uri: `s3://northwind-evidence-vault/manual-upload/${spec.id}-scan.pdf`,
      collectedAt: `${spec.date}T14:41:00.000Z`,
      duplicate: true
    }
  ];
}

/** The full mock evidence list, built once at import time. */
export const MOCK_EVIDENCE: Evidence[] = (() => {
  const specs = buildSpecs();
  return specs.map((spec) => evidenceFromSpec(spec, specs));
})();

/** Instant the demo is frozen at. */
export const NOW = '2026-11-11T09:00:00.000Z';

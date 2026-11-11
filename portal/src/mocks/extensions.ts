/**
 * Mock data of the extension axes (docs/CONTRACTS-EXT.md): verification and
 * sharing, cross-framework mappings, drift, drafts and measured quality.
 *
 * Everything is deterministic: fixed instants derived from `NOW`, digests
 * derived from seeds — the demonstration looks the same on every machine.
 */

import type {
  Attachment,
  ControlMapping,
  Draft,
  DraftSection,
  DriftEvent,
  Evidence,
  Pack,
  QualityMetric,
  QualityReport,
  QualitySubjectRow,
  QualityTrendPoint,
  QualityVerdict,
  ReuseMetric,
  ShareGrant,
  Sufficiency,
  VerificationResult
} from '../api/types.ts';
import { DRAFT_WATERMARK } from '../api/types.ts';
import type { MockDb } from './dataset.ts';
import { hexDigest } from './deterministic.ts';
import { NOW } from './evidence.ts';
import { DEMO_FRAMEWORK_ID } from './framework.ts';
import { expiryFromTtl, watermarkOf } from '../lib/verify.ts';
import { METRIC_META } from '../lib/quality.ts';

/** The second frozen pack, whose archive was altered after the freeze. */
export const TAMPERED_PACK_ID = 'pk-002';
export const TAMPERED_PACK_FROZEN_AT = '2026-10-15T18:00:00.000Z';

/** The fictional second framework the mappings point at (CONTRACTS-EXT §3). */
export const ISO_FRAMEWORK_ID = 'demo-iso';

/* ------------------------------------------------- axis 1: verify and share */

/** Verification of one pack: pk-002 is the seeded altered archive. */
export function verificationOf(pack: Pack, now: string = NOW): VerificationResult {
  const evidenceCount = pack.index.reduce((sum, entry) => sum + entry.evidence.length, 0);
  return {
    packId: pack.id,
    frameworkId: pack.frameworkId,
    verifiedAt: now,
    frozenAt: pack.frozenAt,
    rootHash: hexDigest(`root-${pack.id}`),
    controlCount: pack.index.length,
    evidenceCount,
    knownGapCount: pack.knownGaps.length,
    checksumsOk: pack.id !== TAMPERED_PACK_ID,
    chainOk: true,
    signatureOk: true,
    signerKeyId: 'local-key-ed25519-01',
    algorithm: 'ED25519-LOCAL'
  };
}

function share(
  seed: string,
  label: string,
  createdAt: string,
  ttlHours: number,
  patch: Partial<ShareGrant> = {}
): ShareGrant {
  const expiresAt = expiryFromTtl(createdAt, ttlHours);
  return {
    token: hexDigest(seed, 43),
    packId: 'pk-001',
    frameworkId: DEMO_FRAMEWORK_ID,
    scope: 'PACK',
    createdBy: 'Amina Diallo',
    createdAt,
    expiresAt,
    revokedAt: null,
    revokedBy: null,
    watermark: watermarkOf(label, expiresAt),
    useCount: 0,
    lastUsedAt: null,
    ...patch
  };
}

/** Three seeded grants: one active, one expired, one revoked. */
export function buildShares(): ShareGrant[] {
  return [
    share('share-kpmg', 'KPMG external audit', '2026-11-08T10:00:00.000Z', 96, {
      useCount: 4,
      lastUsedAt: '2026-11-10T16:20:00.000Z'
    }),
    share('share-isaca', 'ISACA peer review', '2026-10-01T09:00:00.000Z', 168, {
      useCount: 12,
      lastUsedAt: '2026-10-07T17:00:00.000Z'
    }),
    share('share-due-diligence', 'Prospect due diligence', '2026-11-02T14:00:00.000Z', 168, {
      packId: null,
      scope: 'FRAMEWORK',
      revokedAt: '2026-11-05T09:30:00.000Z',
      revokedBy: 'Amina Diallo',
      useCount: 1,
      lastUsedAt: '2026-11-03T11:00:00.000Z'
    })
  ];
}

/* ------------------------------------------------------- axis 2: cross-maps */

function mapping(
  sourceControlId: string,
  targetControlId: string,
  confidence: number,
  status: ControlMapping['status'],
  sourceQuote: string,
  targetQuote: string,
  reason: string,
  patch: Partial<ControlMapping> = {}
): ControlMapping {
  return {
    id: `mp-${[DEMO_FRAMEWORK_ID, sourceControlId, ISO_FRAMEWORK_ID, targetControlId].join('|')}`,
    sourceFrameworkId: DEMO_FRAMEWORK_ID,
    sourceControlId,
    targetFrameworkId: ISO_FRAMEWORK_ID,
    targetControlId,
    direction: 'SOURCE_TO_TARGET',
    confidence,
    sourceQuote,
    targetQuote,
    reason,
    status,
    citationVerified: true,
    proposedBy: 'pipeline',
    proposedAt: '2026-11-04T02:00:00.000Z',
    ...patch
  };
}

/**
 * Six seeded correspondences: three validated, two waiting for a human
 * decision, one rejected with its reason. Quotes are passages of the demo
 * requirement texts (source) and of the fictional second framework (target).
 */
export function buildMappings(): ControlMapping[] {
  return [
    mapping(
      'SEC-01', 'ISO-04', 0.91, 'VALIDATED',
      'reviewed at least yearly',
      'The information security policy shall be reviewed at defined intervals.',
      'Both require a periodic review of the information security policy.',
      { validatedBy: 'Amina Diallo', validatedAt: '2026-11-05T10:00:00.000Z' }
    ),
    mapping(
      'GV-02', 'ISO-01', 0.88, 'VALIDATED',
      'Quality objectives are measured, published and reviewed at least yearly.',
      'Quality objectives shall be measured and reviewed at planned intervals.',
      'Same obligation: measured objectives, published and reviewed yearly.',
      { validatedBy: 'Amina Diallo', validatedAt: '2026-11-05T10:12:00.000Z' }
    ),
    mapping(
      'BCP-02', 'ISO-09', 0.86, 'VALIDATED',
      'A restore test is run every quarter and reports the measured recovery time.',
      'Backups shall be restored periodically and the recovery time measured.',
      'Both demand periodic restore tests with a measured recovery time.',
      { validatedBy: 'Sofia Novak', validatedAt: '2026-11-06T14:30:00.000Z' }
    ),
    mapping(
      'INC-01', 'ISO-06', 0.83, 'PROPOSED',
      'Incidents are triaged, escalated and closed following a written procedure.',
      'Incidents shall be managed under a documented procedure.',
      'The two procedures cover the same incident lifecycle.'
    ),
    mapping(
      'CHG-01', 'ISO-07', 0.77, 'PROPOSED',
      'Changes follow a written procedure with classification and approval.',
      'Changes shall be classified, approved and recorded.',
      'Classification and approval appear on both sides; the recording differs.'
    ),
    mapping(
      'CSM-02', 'ISO-11', 0.64, 'REJECTED',
      'Service levels are measured and reviewed with the customer.',
      'Customer billing shall be reviewed for correctness.',
      'Lexical similarity on "reviewed with the customer", different subjects.',
      {
        validatedBy: 'Amina Diallo',
        validatedAt: '2026-11-06T15:00:00.000Z',
        note: 'The target control is about billing accuracy, not service levels.'
      }
    )
  ];
}

/** Reuse metric of the demo framework, live-counted from the mappings. */
export function buildReuse(
  mappings: readonly ControlMapping[],
  now: string = NOW
): ReuseMetric {
  const evidenceCount = 42;
  const attachmentCount = 61;
  const touching = mappings.filter(
    (item) =>
      item.sourceFrameworkId === DEMO_FRAMEWORK_ID ||
      item.targetFrameworkId === DEMO_FRAMEWORK_ID
  );
  return {
    frameworkId: DEMO_FRAMEWORK_ID,
    computedAt: now,
    evidenceCount,
    attachmentCount,
    carriedAttachments: 12,
    avoidedDeposits: 9,
    reuseFactor: Math.round((attachmentCount / evidenceCount) * 100) / 100,
    validatedMappings: touching.filter((item) => item.status === 'VALIDATED').length,
    pendingMappings: touching.filter((item) => item.status === 'PROPOSED').length
  };
}

/* ----------------------------------------------------------- axis 3: drift */

function drift(
  id: string,
  controlId: string,
  kind: DriftEvent['kind'],
  detectedAt: string,
  detail: string,
  previous: string | null,
  current: string | null,
  patch: Partial<DriftEvent> = {}
): DriftEvent {
  return {
    id,
    controlId,
    frameworkId: DEMO_FRAMEWORK_ID,
    evidenceId: null,
    detectedAt,
    kind,
    previous,
    current,
    detail,
    reminderId: null,
    acknowledgedAt: null,
    acknowledgedBy: null,
    ...patch
  };
}

/** Five seeded drifts: three open, two acknowledged. */
export function buildDrifts(): DriftEvent[] {
  return [
    drift(
      'dr-sec-02-state-changed-2026-11-09', 'SEC-02', 'STATE_CHANGED',
      '2026-11-09T04:12:00.000Z',
      'The nightly access scan found two administrative accounts without multi-factor authentication.',
      'all admin accounts MFA-enabled', '2 admin accounts without MFA'
    ),
    drift(
      'dr-bcp-04-missing-run-2026-11-10', 'BCP-04', 'MISSING_RUN',
      '2026-11-10T06:00:00.000Z',
      'The backup monitoring collector did not report within its 24 h cadence plus the 6 h grace.',
      'daily report at 04:00', null
    ),
    drift(
      'dr-sec-04-threshold-2026-11-08', 'SEC-04', 'THRESHOLD_CROSSED',
      '2026-11-08T04:05:00.000Z',
      'The monitoring attestation names a failed detection run on the primary region.',
      '41 blocked events, 0 failed run', 'failed detection run'
    ),
    drift(
      'dr-inc-03-recovered-2026-11-05', 'INC-03', 'RECOVERED',
      '2026-11-05T04:00:00.000Z',
      'The on-call roster collector reports full coverage again for the coming weeks.',
      'weekend coverage gap', 'full coverage',
      { acknowledgedAt: '2026-11-06T09:00:00.000Z', acknowledgedBy: 'Amina Diallo' }
    ),
    drift(
      'dr-sec-05-state-changed-2026-11-01', 'SEC-05', 'STATE_CHANGED',
      '2026-11-01T04:00:00.000Z',
      'The key inventory reports one customer managed key past its twelve-month rotation.',
      'all keys rotated within 12 months', '1 key overdue rotation',
      { acknowledgedAt: '2026-11-02T10:30:00.000Z', acknowledgedBy: 'Sofia Novak' }
    )
  ];
}

/* ----------------------------------------------------------- axis 3: draft */

interface CarriedVersion {
  evidence: Evidence;
  sufficiency: Sufficiency | null;
}

/** The partner's previous version: its most recent applied evidence. */
function carriedVersion(db: MockDb, controlId: string, evidenceId: string | null): CarriedVersion | null {
  if (!evidenceId) return null;
  const evidence = db.evidence.find((item) => item.id === evidenceId);
  const attachment: Attachment | undefined = db.attachments.find(
    (item) => item.evidenceId === evidenceId && item.controlId === controlId && item.status === 'APPLIED'
  );
  if (!evidence || !attachment) return null;
  const sufficiency =
    db.sufficiencies.find((item) => item.attachmentId === attachment.id) ?? null;
  return { evidence, sufficiency };
}

/** Sections built from the expected elements; missing ones stay to complete. */
export function draftSections(
  expected: readonly string[],
  carried: CarriedVersion | null
): DraftSection[] {
  return expected.map((element) => {
    const found = carried?.sufficiency?.elements.find((item) => item.expected === element);
    const complete = found?.present === true && found.quote !== null;
    return {
      expected: element,
      body: complete ? (found?.quote ?? '') : '',
      toComplete: !complete
    };
  });
}

/** Renders the markdown document, mirroring the API `renderDraft()`. */
export function renderDraftMarkdown(requirement: string, draft: Draft): string {
  const lines = [
    `<!-- ${draft.watermark} -->`,
    `# ${draft.title}`,
    '',
    `> ${draft.watermark}`,
    '',
    '## Requirement this document must satisfy',
    '',
    requirement,
    ''
  ];
  for (const section of draft.sections) {
    lines.push(`## ${section.expected}`, '');
    lines.push(section.toComplete ? `_To complete: ${section.expected}._` : section.body, '');
  }
  if (draft.basedOn.length > 0) {
    lines.push('## Carried over from', '');
    for (const id of draft.basedOn) lines.push(`- ${id}`);
    lines.push('');
  }
  lines.push('## Signature', '', 'Name: ____  Role: ____  Date: ____', '');
  return lines.join('\n');
}

/** Builds the draft of one control; `null` when the control is unknown. */
export function buildDraft(db: MockDb, controlId: string, now: string = NOW): Draft | null {
  const control = db.controls.find((item) => item.id === controlId);
  const status = db.statuses.find((item) => item.controlId === controlId);
  if (!control || !status) return null;
  const carried = carriedVersion(db, controlId, status.bestEvidenceId);
  const sections = draftSections(control.expectedEvidence, carried);
  const draft: Draft = {
    id: `df-${controlId}-${now.replace(/[:.]/g, '-')}`,
    controlId,
    frameworkId: control.frameworkId,
    createdAt: now,
    format: 'MARKDOWN',
    title: `Draft — ${control.title}`,
    watermark: DRAFT_WATERMARK,
    status: 'DRAFT',
    sections,
    basedOn: carried ? [carried.evidence.id] : [],
    missing: sections.filter((section) => section.toComplete).map((section) => section.expected),
    content: '',
    attachable: false
  };
  draft.content = renderDraftMarkdown(control.requirement, draft);
  return draft;
}

/* ------------------------------------------------------- bonus: self-grading */

const MEASURED_AT = [
  '2026-09-14T02:00:00.000Z',
  '2026-10-12T02:00:00.000Z',
  '2026-11-10T02:00:00.000Z'
];

/** Verdict computed by code from the value, the target and the direction. */
export function verdictOf(metric: QualityMetric, value: number, target: number): QualityVerdict {
  const meta = METRIC_META[metric];
  if (!meta) return 'UNKNOWN';
  return (meta.higherIsBetter ? value >= target : value <= target) ? 'PASS' : 'FAIL';
}

function qrow(
  subject: QualitySubjectRow['subject'],
  metric: QualityMetric,
  target: number,
  trend: number[]
): QualitySubjectRow {
  const value = trend[trend.length - 1] ?? 0;
  return {
    subject,
    metric,
    value,
    target,
    verdict: verdictOf(metric, value, target),
    trend,
    measuredAt: MEASURED_AT[trend.length - 1] ?? MEASURED_AT[0]!
  };
}

const READER = { kind: 'READING', modelId: 'bedrock-data-automation', promptVersion: 'v7' } as const;
const ATTACHER = { kind: 'ATTACHMENT', modelId: 'claude-sonnet-4', promptVersion: 'v3' } as const;
const SUFFICIENCY_SUBJECT = { kind: 'SUFFICIENCY', modelId: 'claude-sonnet-4', promptVersion: 'v2' } as const;
const ANSWERER = { kind: 'QA', modelId: 'claude-sonnet-4', promptVersion: 'v4' } as const;

/**
 * Threshold actually applied, mirroring the API rule: a failing attachment
 * measurement pushes it above 1 — nothing can be auto-applied any more.
 */
export function thresholdInEffectOf(configured: number, rows: readonly QualitySubjectRow[]): number {
  const relevant = rows
    .filter((row) => row.metric === 'ACCEPTED_WITHOUT_CORRECTION')
    .sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));
  const latest = relevant[0];
  if (!latest) return configured;
  return latest.verdict === 'PASS' ? configured : 1.01;
}

/** The seeded report: five metrics on target, the attachment accuracy below. */
export function buildQuality(configured: number, now: string = NOW): QualityReport {
  const subjects: QualitySubjectRow[] = [
    qrow(READER, 'FIELD_ACCURACY', 0.95, [0.941, 0.955, 0.962]),
    qrow(ATTACHER, 'ACCEPTED_WITHOUT_CORRECTION', 0.9, [0.921, 0.884, 0.812]),
    qrow(ATTACHER, 'WRONG_HIGH_CONFIDENCE', 0, [0, 0, 0]),
    qrow(SUFFICIENCY_SUBJECT, 'GAPS_DETECTED', 0.9, [0.9, 0.912, 0.93]),
    qrow(ANSWERER, 'CITATION_ACCURACY', 0.95, [0.96, 0.966, 0.974]),
    qrow(ANSWERER, 'INVENTED_ANSWERS', 0, [0, 0, 0])
  ];
  const trend: QualityTrendPoint[] = subjects.flatMap((row) =>
    row.trend.map((value, index) => ({
      measuredAt: MEASURED_AT[index] ?? now,
      subjectKey: `${row.subject.kind}:${row.subject.modelId}:${row.subject.promptVersion}`,
      metric: row.metric,
      value,
      verdict: verdictOf(row.metric, value, row.target)
    }))
  );
  return { subjects, thresholdInEffect: thresholdInEffectOf(configured, subjects), trend };
}

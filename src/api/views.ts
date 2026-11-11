/**
 * Serialisation: how each entity leaves the API (docs/API.md).
 *
 * Two rules drive this file.
 *  - ENF-IA-01: a control is described by its `ControlState` only. No response
 *    field, no message and no excerpt ever qualifies a control with the
 *    forbidden wording; `src/domain/vocabulary.ts` is the guard.
 *  - ENF-CONF-01/02: excerpts are masked. Personal data is always redacted in
 *    an excerpt, and an excerpt of RESTRICTED evidence is fully masked for a
 *    principal without that clearance (EF-QR-03).
 */

import { isLevelAllowed, maxLevel } from '../domain/access.ts';
import { redactText } from '../domain/redaction.ts';
import type {
  Answer,
  Attachment,
  AuditEvent,
  Control,
  ControlState,
  ControlStatus,
  Evidence,
  Framework,
  Pack,
  Principal,
  ReadinessSnapshot,
  ReadinessTrendPoint,
  Reminder,
  Settings,
  Sufficiency,
  ValidationItem
} from '../domain/types.ts';

/** Marker replacing a whole excerpt the caller may not read (EF-QR-03). */
export const MASKED_EXCERPT = '[restricted: excerpt not available at this clearance]';

/** Truncates an excerpt to keep a list response readable. */
function truncate(text: string, max = 400): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}

/**
 * Excerpt of a document as the caller may see it: personal data masked
 * (ENF-CONF-02), and fully masked above the caller's clearance (EF-QR-03).
 */
export function excerptFor(
  text: string,
  principal: Principal,
  accessLevel: Evidence['accessLevel'],
  max = 400
): string {
  if (!isLevelAllowed(accessLevel, maxLevel(principal))) return MASKED_EXCERPT;
  return truncate(redactText(text).text, max);
}

/** True when the principal may read excerpts of this access level. */
export function mayReadExcerpt(principal: Principal, accessLevel: Evidence['accessLevel']): boolean {
  return isLevelAllowed(accessLevel, maxLevel(principal));
}

/** Framework header — EF-REF-02. */
export function frameworkView(framework: Framework): Record<string, unknown> {
  return {
    id: framework.id,
    name: framework.name,
    version: framework.version,
    importedAt: framework.importedAt,
    confidentiality: framework.confidentiality,
    source: framework.source ?? null
  };
}

/** Control with its current state, if computed — EF-REF-01, EF-FRA-02. */
export function controlView(control: Control, status: ControlStatus | null): Record<string, unknown> {
  return {
    id: control.id,
    frameworkId: control.frameworkId,
    domain: control.domain,
    title: control.title,
    requirement: control.requirement,
    expectedEvidence: control.expectedEvidence,
    periodicity: control.periodicity,
    owner: control.owner,
    mandatory: control.mandatory,
    state: status?.state ?? null,
    freshness: status?.freshness ?? null,
    sufficiencyClass: status?.sufficiencyClass ?? null,
    bestEvidenceId: status?.bestEvidenceId ?? null,
    expiresAt: status?.expiresAt ?? null,
    pendingProposals: status?.pendingProposals ?? 0,
    notes: status?.notes ?? []
  };
}

/** Readiness snapshot plus its history — EF-FRA-03, EF-FRA-04. */
export function readinessView(
  snapshot: ReadinessSnapshot,
  trend: readonly ReadinessTrendPoint[]
): Record<string, unknown> {
  return {
    frameworkId: snapshot.frameworkId,
    computedAt: snapshot.computedAt,
    total: snapshot.total,
    counts: snapshot.counts,
    shares: snapshot.shares,
    trend: trend.map((point) => ({ at: point.at, counts: point.counts }))
  };
}

/** Evidence detail; `textPages` are masked excerpts — EF-LEC-03, EF-QR-03. */
export function evidenceView(
  evidence: Evidence,
  principal: Principal,
  options: { includeText?: boolean } = {}
): Record<string, unknown> {
  const view: Record<string, unknown> = {
    id: evidence.id,
    sha256: evidence.sha256,
    revision: evidence.revision,
    fields: maskedFields(evidence, principal),
    flags: evidence.flags,
    accessLevel: evidence.accessLevel,
    locations: evidence.locations,
    sizeBytes: evidence.sizeBytes,
    contentType: evidence.contentType,
    ingestedAt: evidence.ingestedAt,
    reader: evidence.reader,
    cost: evidence.cost ?? null
  };
  // The portal's `Evidence` always carries `textPages`: a list shows short
  // excerpts, the detail view shows long ones, and both are masked above the
  // caller's clearance (ENF-CONF-01/02, EF-QR-03).
  const max = options.includeText === true ? 2000 : 400;
  view.textPages = evidence.textPages.map((page) => ({
    page: page.page,
    text: excerptFor(page.text, principal, evidence.accessLevel, max)
  }));
  return view;
}

/** Fields of an evidence, with the summary masked like any other excerpt. */
function maskedFields(evidence: Evidence, principal: Principal): Record<string, unknown> {
  const summary = evidence.fields.summary;
  return {
    ...evidence.fields,
    summary:
      summary === null ? null : excerptFor(summary, principal, evidence.accessLevel, 600)
  };
}

/** One attachment row of a control, with its sufficiency — docs/API.md §8. */
export function attachmentView(
  attachment: Attachment,
  evidence: Evidence | null,
  sufficiency: Sufficiency | null,
  principal: Principal
): Record<string, unknown> {
  const level = evidence?.accessLevel ?? 'INTERNAL';
  return {
    attachmentId: attachment.id,
    evidenceId: attachment.evidenceId,
    controlId: attachment.controlId,
    frameworkId: attachment.frameworkId,
    status: attachment.status,
    supports: attachment.supports,
    confidence: attachment.confidence,
    quote: excerptFor(attachment.quote, principal, level),
    quoteLocation: attachment.quoteLocation,
    citationVerified: attachment.citationVerified,
    autoApplied: attachment.autoApplied,
    reason: attachment.reason,
    rejectionReason: attachment.rejectionReason ?? null,
    createdAt: attachment.createdAt,
    decidedBy: attachment.decidedBy ?? null,
    decidedAt: attachment.decidedAt ?? null,
    sufficiency:
      sufficiency === null
        ? null
        : { class: sufficiency.class, missing: sufficiency.missing, elements: sufficiency.elements },
    title: evidence?.fields.title ?? null,
    documentDate: evidence?.fields.documentDate ?? null
  };
}

/** Validation queue item; author, date and note are kept once decided — EF-VAL-02. */
export function validationView(item: ValidationItem): Record<string, unknown> {
  return {
    id: item.id,
    kind: item.kind,
    attachmentId: item.attachmentId ?? null,
    evidenceId: item.evidenceId ?? null,
    controlId: item.controlId ?? null,
    reason: item.reason,
    createdAt: item.createdAt,
    status: item.status,
    decision: item.decision ?? null,
    decidedBy: item.decidedBy ?? null,
    decidedAt: item.decidedAt ?? null,
    note: item.note ?? null
  };
}

/** Answer with its citations, redaction flag and grounding verdict — EF-QR-01/02. */
export function answerView(answer: Answer): Record<string, unknown> {
  return {
    question: answer.question,
    text: answer.text,
    citations: answer.citations,
    noEvidence: answer.noEvidence,
    redacted: answer.redacted,
    passagesUsed: answer.passagesUsed,
    cost: answer.cost ?? null
  };
}

/** Audit pack with a short-lived download URL when one was issued — EF-DOS-01..03. */
export function packView(pack: Pack, downloadUrl: string | null = null): Record<string, unknown> {
  return {
    id: pack.id,
    frameworkId: pack.frameworkId,
    frozenAt: pack.frozenAt,
    index: pack.index,
    knownGaps: pack.knownGaps,
    archive: pack.archive,
    checksumsVerified: pack.checksumsVerified,
    downloadUrl
  };
}

/** Reminder — EF-REL-01..03. */
export function reminderView(reminder: Reminder): Record<string, unknown> {
  return {
    id: reminder.id,
    controlId: reminder.controlId,
    frameworkId: reminder.frameworkId,
    recipient: reminder.recipient,
    reason: reminder.reason,
    missing: reminder.missing,
    message: reminder.message,
    createdAt: reminder.createdAt,
    expiresAt: reminder.expiresAt,
    status: reminder.status,
    channel: reminder.channel
  };
}

/** Audit event — EF-ADM-02. */
export function auditEventView(event: AuditEvent): Record<string, unknown> {
  return {
    seq: event.seq,
    id: event.id,
    at: event.at,
    actor: event.actor,
    action: event.action,
    objectType: event.objectType,
    objectId: event.objectId,
    detail: event.detail,
    prevHash: event.prevHash,
    hash: event.hash
  };
}

/** Settings — EF-ADM-01. */
export function settingsView(settings: Settings): Record<string, unknown> {
  return {
    confidenceThreshold: settings.confidenceThreshold,
    reminderLeadDays: settings.reminderLeadDays,
    defaultPeriodicity: settings.defaultPeriodicity,
    region: settings.region,
    retentionMonths: settings.retentionMonths,
    readerModel: settings.readerModel,
    reasoningModel: settings.reasoningModel,
    answerModel: settings.answerModel,
    guardrailId: settings.guardrailId,
    nightlyServiceTier: settings.nightlyServiceTier
  };
}

/* ------------------------------------------------------- portal contract */

/** Control alone, in the domain shape the portal lists — EF-REF-01. */
export function controlOnlyView(control: Control): Record<string, unknown> {
  return {
    id: control.id,
    frameworkId: control.frameworkId,
    domain: control.domain,
    title: control.title,
    requirement: control.requirement,
    expectedEvidence: [...control.expectedEvidence],
    periodicity: control.periodicity,
    owner: control.owner,
    mandatory: control.mandatory
  };
}

/** Attachment in its domain shape; only the quote is masked — EF-RAT-02. */
export function attachmentDomainView(
  attachment: Attachment,
  principal: Principal,
  level: Evidence['accessLevel']
): Record<string, unknown> {
  const view: Record<string, unknown> = {
    id: attachment.id,
    evidenceId: attachment.evidenceId,
    controlId: attachment.controlId,
    frameworkId: attachment.frameworkId,
    supports: attachment.supports,
    confidence: attachment.confidence,
    quote: excerptFor(attachment.quote, principal, level),
    quoteLocation: attachment.quoteLocation,
    reason: attachment.reason,
    status: attachment.status,
    citationVerified: attachment.citationVerified,
    autoApplied: attachment.autoApplied,
    model: attachment.model,
    createdAt: attachment.createdAt
  };
  if (attachment.rejectionReason !== undefined) view.rejectionReason = attachment.rejectionReason;
  if (attachment.decidedBy !== undefined) view.decidedBy = attachment.decidedBy;
  if (attachment.decidedAt !== undefined) view.decidedAt = attachment.decidedAt;
  if (attachment.decidedNote !== undefined) view.decidedNote = attachment.decidedNote;
  return view;
}

/** Sufficiency in its domain shape — EF-SUF-01/02. */
export function sufficiencyView(sufficiency: Sufficiency): Record<string, unknown> {
  return {
    id: sufficiency.id,
    attachmentId: sufficiency.attachmentId,
    evidenceId: sufficiency.evidenceId,
    controlId: sufficiency.controlId,
    elements: sufficiency.elements,
    class: sufficiency.class,
    missing: sufficiency.missing,
    computedAt: sufficiency.computedAt
  };
}

/** Full control detail: what the control screen renders in one call. */
export function controlWithRelationsView(input: {
  control: Control;
  status: ControlStatus | null;
  attachments: readonly Attachment[];
  sufficiencies: readonly Sufficiency[];
  evidence: readonly Evidence[];
  principal: Principal;
  levelOf: (evidenceId: string) => Evidence['accessLevel'];
}): Record<string, unknown> {
  return {
    control: controlOnlyView(input.control),
    status: input.status,
    attachments: input.attachments.map((attachment) =>
      attachmentDomainView(attachment, input.principal, input.levelOf(attachment.evidenceId))
    ),
    sufficiencies: input.sufficiencies.map(sufficiencyView),
    evidence: input.evidence.map((evidence) => evidenceView(evidence, input.principal))
  };
}

/** Cost report as the portal reads it (ENF-COUT-01). */
export function costReportView(
  report: { totalUsd: number; bySource: Record<string, number>; count: number },
  evidenceCount: number
): Record<string, unknown> {
  return {
    totalUsd: report.totalUsd,
    perEvidenceUsd: evidenceCount === 0 ? 0 : report.totalUsd / evidenceCount,
    evidenceCount,
    bySource: report.bySource
  };
}

/** Per-domain breakdown of the states (EF-FRA-03). */
export function byDomainView(
  controls: readonly Control[],
  statuses: readonly ControlStatus[]
): Record<string, { total: number; counts: Record<ControlState, number> }> {
  const stateOf = new Map(statuses.map((status) => [status.controlId, status.state]));
  const out: Record<string, { total: number; counts: Record<ControlState, number> }> = {};
  for (const control of controls) {
    const domain = out[control.domain] ?? emptyDomain();
    domain.total += 1;
    domain.counts[stateOf.get(control.id) ?? 'NO_EVIDENCE'] += 1;
    out[control.domain] = domain;
  }
  return out;
}

function emptyDomain(): { total: number; counts: Record<ControlState, number> } {
  return {
    total: 0,
    counts: { COVERED: 0, TO_RENEW: 0, TO_VERIFY: 0, EXPIRED: 0, NO_EVIDENCE: 0 }
  };
}

/** One dashboard call: framework, snapshot, trend, states, domains, costs. */
export function readinessOverviewView(input: {
  framework: Framework;
  snapshot: ReadinessSnapshot;
  trend: readonly ReadinessTrendPoint[];
  statuses: readonly ControlStatus[];
  byDomain: Record<string, { total: number; counts: Record<ControlState, number> }>;
  costs: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    framework: frameworkView(input.framework),
    snapshot: readinessView(input.snapshot, input.trend),
    trend: input.trend.map((point) => ({ frameworkId: point.frameworkId, at: point.at, counts: point.counts })),
    statuses: [...input.statuses],
    byDomain: input.byDomain,
    costs: input.costs
  };
}

/** Principal as the session endpoint returns it (EF-ADM-03). */
export function principalView(principal: Principal): Record<string, unknown> {
  return {
    id: principal.id,
    name: principal.name,
    email: principal.email,
    role: principal.role,
    clearance: principal.clearance,
    ownedControls: [...principal.ownedControls]
  };
}

/**
 * Cross-framework mappings — one evidence serves every framework (axis 2).
 *
 * An MSP passes several audits a year and hunts the same evidence each time. A
 * mapping says that a control of one framework is answered by the same evidence
 * as a control of another, so an attachment accepted once is **proposed** on the
 * other framework.
 *
 * The discipline is the same as for attachments, and for the same reason:
 *   - a mapping is never applied automatically — a human validates it
 *     (EF-REF-04);
 *   - both quoted passages are verified in the two requirement texts by code, so
 *     a plausible-sounding equivalence with no textual basis is refused;
 *   - a validated mapping only ever creates `PROPOSED` attachments on the other
 *     framework. It never changes a state by itself.
 */

import type { Attachment, Control, ControlId, FrameworkId } from '../domain/types.ts';
import type { ControlMapping, MappingDirection, ReuseMetric } from '../domain/mapping.ts';
import { mappingId } from '../domain/mapping.ts';
import { verifyQuoteInPages } from '../domain/citation.ts';
import type { Services } from '../ports/index.ts';
import { containsNormalized, excerpt } from '../support/normalize.ts';
import { badRequest, notFound } from '../support/errors.ts';
import { record } from '../audit/log.ts';

/** Below this similarity two controls are not worth comparing. */
export const MAPPING_MIN_SCORE = 0.25;

/** Model name stamped on attachments created by a mapping. */
export const PROPAGATION_MODEL = 'cross-framework-mapping';

export interface ProposeInput {
  sourceFrameworkId: FrameworkId;
  targetFrameworkId: FrameworkId;
  actor: string;
  /** Maximum number of proposals to keep per source control. */
  limit?: number;
}

export interface MappingDecisionInput {
  decision: 'VALIDATE' | 'REJECT';
  by: string;
  note?: string;
}

/** Text that represents a control when two controls are compared. */
export function controlSignature(control: Control): string {
  return `${control.title} ${control.requirement} ${control.expectedEvidence.join(' ')}`;
}

/** Token-overlap score between two controls, 0..1. */
export function controlSimilarity(left: Control, right: Control): number {
  return jaccard(controlSignature(left), controlSignature(right));
}

/** Jaccard similarity over lowercase word tokens; one implementation only. */
function jaccard(left: string, right: string): number {
  const a = new Set(tokenize(left));
  const b = new Set(tokenize(right));
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token.length >= 3);
}

/** The sentence of a requirement text that best represents it, as a quote. */
export function requirementQuote(requirement: string): string {
  const sentence = requirement
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .find((part) => part.length >= 20);
  return excerpt(sentence ?? requirement, 240);
}

/**
 * Proposes mappings between two frameworks. Idempotent: proposing twice for the
 * same pair updates nothing that a human already decided.
 */
export async function proposeMappings(
  services: Services,
  input: ProposeInput
): Promise<ControlMapping[]> {
  if (input.sourceFrameworkId === input.targetFrameworkId) {
    throw badRequest('a framework cannot be mapped to itself', { frameworkId: input.sourceFrameworkId });
  }
  const sources = await services.state.listControls(input.sourceFrameworkId);
  const targets = await services.state.listControls(input.targetFrameworkId);
  if (sources.length === 0) throw notFound(`framework ${input.sourceFrameworkId} has no controls`);
  if (targets.length === 0) throw notFound(`framework ${input.targetFrameworkId} has no controls`);

  const created: ControlMapping[] = [];
  for (const source of sources) {
    const best = bestTarget(source, targets, input.limit ?? 1);
    for (const candidate of best) {
      const mapping = buildMapping(services, source, candidate.control, candidate.score);
      if (mapping === null) continue;
      // Idempotent: an existing pair is left alone, whatever its status, so a
      // second proposal run can never overwrite a human decision.
      if ((await services.extensions.getMapping(mapping.id)) !== null) continue;
      await services.extensions.putMapping(mapping);
      created.push(mapping);
    }
  }
  if (created.length > 0) {
    await record(services, input.actor, 'MAPPING_PROPOSED', 'mapping', `${input.sourceFrameworkId}>${input.targetFrameworkId}`, {
      proposed: created.length
    });
  }
  return created;
}

/** Best target controls for one source control, above the floor. */
function bestTarget(
  source: Control,
  targets: readonly Control[],
  limit: number
): Array<{ control: Control; score: number }> {
  return targets
    .map((control) => ({ control, score: round3(controlSimilarity(source, control)) }))
    .filter((candidate) => candidate.score >= MAPPING_MIN_SCORE)
    .sort((left, right) => right.score - left.score || left.control.id.localeCompare(right.control.id))
    .slice(0, limit);
}

/** Builds one mapping, refusing it when a quote cannot be verified by code. */
function buildMapping(
  services: Services,
  source: Control,
  target: Control,
  score: number
): ControlMapping | null {
  const sourceQuote = requirementQuote(source.requirement);
  const targetQuote = requirementQuote(target.requirement);
  const verified =
    containsNormalized(source.requirement, sourceQuote) && containsNormalized(target.requirement, targetQuote);
  if (!verified) return null;
  return {
    id: mappingId(source.frameworkId, source.id, target.frameworkId, target.id),
    sourceFrameworkId: source.frameworkId,
    sourceControlId: source.id,
    targetFrameworkId: target.frameworkId,
    targetControlId: target.id,
    direction: 'SOURCE_TO_TARGET' as MappingDirection,
    confidence: score,
    sourceQuote,
    targetQuote,
    reason: `Requirement texts share ${Math.round(score * 100)}% of their vocabulary.`,
    status: 'PROPOSED',
    citationVerified: true,
    proposedBy: 'cross-framework-proposer',
    proposedAt: services.clock.now()
  };
}

/** Validates or rejects one mapping; keeps author, instant and reason. */
export async function decideMapping(
  services: Services,
  id: string,
  input: MappingDecisionInput
): Promise<ControlMapping> {
  const mapping = await services.extensions.getMapping(id);
  if (mapping === null) throw notFound(`mapping ${id} does not exist`);
  const at = services.clock.now();
  const decided: ControlMapping = {
    ...mapping,
    status: input.decision === 'VALIDATE' ? 'VALIDATED' : 'REJECTED',
    validatedBy: input.by,
    validatedAt: at,
    ...(input.note === undefined ? {} : { note: input.note })
  };
  await services.extensions.putMapping(decided);
  await record(services, input.by, 'MAPPING_DECIDED', 'mapping', id, {
    decision: decided.status,
    source: `${mapping.sourceFrameworkId}:${mapping.sourceControlId}`,
    target: `${mapping.targetFrameworkId}:${mapping.targetControlId}`,
    note: input.note ?? null
  });
  return decided;
}

/**
 * Carries one applied attachment across validated mappings. The result is always
 * a `PROPOSED` attachment on the other framework: a mapping never decides on its
 * own, and never changes a state by itself.
 */
export async function propagateAttachment(services: Services, attachment: Attachment): Promise<string[]> {
  if (attachment.status !== 'APPLIED' || !attachment.supports) return [];
  const mappings = await validatedMappingsFor(services, attachment.frameworkId, attachment.controlId);
  const used: string[] = [];
  for (const mapping of mappings) {
    const targetControlId: ControlId =
      mapping.sourceControlId === attachment.controlId ? mapping.targetControlId : mapping.sourceControlId;
    const targetFrameworkId: FrameworkId =
      mapping.sourceControlId === attachment.controlId ? mapping.targetFrameworkId : mapping.sourceFrameworkId;
    const evidence = await services.state.getEvidence(attachment.evidenceId);
    if (evidence === null) continue;
    const check = verifyQuoteInPages(evidence.textPages, attachment.quote);
    if (!check.found) continue;
    const carried = await carryOver(services, attachment, mapping, targetFrameworkId, targetControlId, check.page);
    if (carried !== null) used.push(mapping.id);
  }
  return used;
}

/** Validated mappings touching one control, in either direction. */
export async function validatedMappingsFor(
  services: Services,
  frameworkId: FrameworkId,
  controlId: ControlId
): Promise<ControlMapping[]> {
  const all = await services.extensions.listMappings({ status: 'VALIDATED', controlId: controlId });
  return all.filter(
    (mapping) =>
      (mapping.sourceFrameworkId === frameworkId && mapping.sourceControlId === controlId) ||
      (mapping.targetFrameworkId === frameworkId && mapping.targetControlId === controlId)
  );
}

/** Creates the proposed attachment on the mapped control, once. */
async function carryOver(
  services: Services,
  attachment: Attachment,
  mapping: ControlMapping,
  targetFrameworkId: FrameworkId,
  targetControlId: ControlId,
  page: number | null
): Promise<Attachment | null> {
  const id = `${attachment.id}-${targetControlId}`;
  if ((await services.state.getAttachment(id)) !== null) return null;
  const carried: Attachment = {
    ...attachment,
    id,
    controlId: targetControlId,
    frameworkId: targetFrameworkId,
    status: 'PROPOSED',
    autoApplied: false,
    confidence: mapping.confidence,
    citationVerified: true,
    quoteLocation: { page },
    model: PROPAGATION_MODEL,
    reason: `Carried over from ${attachment.controlId} through a validated mapping with ${
      mapping.sourceControlId === attachment.controlId ? mapping.targetControlId : mapping.sourceControlId
    }.`,
    createdAt: services.clock.now(),
    decidedBy: undefined,
    decidedAt: undefined,
    decidedNote: undefined
  };
  await services.state.putAttachment(carried);
  await record(services, 'cross-framework', 'ATTACHMENT_PROPOSED', 'attachment', id, {
    controlId: targetControlId,
    frameworkId: targetFrameworkId,
    evidenceId: attachment.evidenceId,
    mappingId: mapping.id
  });
  return carried;
}

/** How much one deposited evidence is worth across frameworks. */
export async function reuseMetric(services: Services, frameworkId: FrameworkId): Promise<ReuseMetric> {
  const controls = await services.state.listControls(frameworkId);
  let attachmentCount = 0;
  let carried = 0;
  const evidenceIds = new Set<string>();
  const carriedEvidence = new Set<string>();
  for (const control of controls) {
    // Applied attachments are what covers the control; carried ones are counted
    // whatever their status, because a proposal created by a mapping is already
    // a deposit the partner did not have to make.
    const applied = (await services.state.listAttachments({ controlId: control.id, status: 'APPLIED' })).filter(
      (item) => item.supports
    );
    const proposed = (await services.state.listAttachments({ controlId: control.id, status: 'PROPOSED' })).filter(
      (item) => item.supports && item.model === PROPAGATION_MODEL
    );
    attachmentCount += applied.length;
    for (const attachment of applied) {
      evidenceIds.add(attachment.evidenceId);
      if (attachment.model === PROPAGATION_MODEL) {
        carried += 1;
        carriedEvidence.add(attachment.evidenceId);
      }
    }
    for (const attachment of proposed) {
      carried += 1;
      carriedEvidence.add(attachment.evidenceId);
    }
  }
  const mappings = [
    ...(await services.extensions.listMappings({ sourceFrameworkId: frameworkId })),
    ...(await services.extensions.listMappings({ targetFrameworkId: frameworkId }))
  ];
  const deduped = new Map(mappings.map((mapping) => [mapping.id, mapping]));
  const validated = [...deduped.values()].filter((mapping) => mapping.status === 'VALIDATED').length;
  const pending = [...deduped.values()].filter((mapping) => mapping.status === 'PROPOSED').length;
  return {
    frameworkId,
    computedAt: services.clock.now(),
    evidenceCount: evidenceIds.size,
    attachmentCount,
    carriedAttachments: carried,
    avoidedDeposits: carriedEvidence.size,
    reuseFactor: evidenceIds.size === 0 ? 0 : round2((attachmentCount + carried) / evidenceIds.size),
    validatedMappings: validated,
    pendingMappings: pending
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

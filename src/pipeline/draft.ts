/**
 * Pre-filled draft of a missing human document (axis 3b).
 *
 * The gap this closes: an owner who has to write a procedure from a blank page
 * does not do it, and the control stays uncovered. Starting from the control's
 * expected elements and the partner's own previous version turns an hour of
 * writing into ten minutes of review.
 *
 * The guard rail is absolute and lives in the types, not in a convention:
 *   - a draft is NOT evidence — no fingerprint, nothing written to the vault,
 *     no `Evidence`, no `Attachment`, never in a pack;
 *   - every element with nothing to carry over stays an explicit placeholder;
 *   - the document is watermarked and `attachable` is the literal `false`;
 *   - it becomes evidence only through the normal deposit path, which
 *     fingerprints, reads and attaches it like any other document.
 *
 * Source text comes from the partner's own store only, and passes the guardrail
 * redaction before it is shown (ENF-CONF-02).
 */

import type { Control, Evidence } from '../domain/types.ts';
import type { Draft, DraftSection } from '../domain/draft.ts';
import { DRAFT_WATERMARK, draftId, renderDraft } from '../domain/draft.ts';
import type { Services } from '../ports/index.ts';
import { notFound } from '../support/errors.ts';
import { excerpt } from '../support/normalize.ts';
import { bestSentence } from '../ai/textMatch.ts';
import { redactText } from '../domain/redaction.ts';
import { record } from '../audit/log.ts';

/** Longest carried-over excerpt, so a draft stays a starting point. */
export const MAX_CARRIED_CHARS = 320;

/** Minimum similarity for a sentence of the previous version to be carried. */
export const CARRY_MIN_SCORE = 0.2;

/** Generates one draft for one control. */
export async function generateDraft(services: Services, controlId: string, actor: string): Promise<Draft> {
  const control = await services.state.getControl(controlId);
  if (control === null) throw notFound(`control ${controlId} does not exist`);
  const source = await previousVersion(services, control.id);
  const sourceText = source === null ? '' : source.textPages.map((page) => page.text).join('\n');
  const sections = buildSections(control, sourceText);
  const createdAt = services.clock.now();
  const draft: Draft = {
    id: draftId(control.id, createdAt),
    controlId: control.id,
    frameworkId: control.frameworkId,
    createdAt,
    format: 'MARKDOWN',
    title: control.title,
    watermark: DRAFT_WATERMARK,
    status: 'DRAFT',
    sections,
    basedOn: source === null ? [] : [source.id],
    missing: sections.filter((section) => section.toComplete).map((section) => section.expected),
    content: renderDraft({
      title: control.title,
      watermark: DRAFT_WATERMARK,
      requirement: control.requirement,
      sections,
      basedOn: source === null ? [] : [source.id]
    }),
    attachable: false
  };
  await record(services, actor, 'DRAFT_GENERATED', 'draft', draft.id, {
    controlId: control.id,
    frameworkId: control.frameworkId,
    basedOn: draft.basedOn,
    toComplete: draft.missing.length
  });
  return draft;
}

/** The partner's own most recent applied evidence for this control, if any. */
export async function previousVersion(services: Services, controlId: string): Promise<Evidence | null> {
  const attachments = await services.state.listAttachments({ controlId, status: 'APPLIED' });
  let best: Evidence | null = null;
  for (const attachment of attachments.filter((item) => item.supports)) {
    const evidence = await services.state.getEvidence(attachment.evidenceId);
    if (evidence === null) continue;
    if (best === null || isNewer(evidence, best)) best = evidence;
  }
  return best;
}

/** True when `candidate` is more recent than `current`, by document date. */
function isNewer(candidate: Evidence, current: Evidence): boolean {
  const left = candidate.fields.documentDate ?? candidate.ingestedAt;
  const right = current.fields.documentDate ?? current.ingestedAt;
  return left > right;
}

/** One section per expected element, carried over or left to complete. */
function buildSections(control: Control, sourceText: string): DraftSection[] {
  const out: DraftSection[] = [];
  for (const expected of control.expectedEvidence) {
    const carried = carryOver(sourceText, expected);
    out.push(
      carried === null
        ? { expected, body: '', toComplete: true }
        : { expected, body: carried, toComplete: false }
    );
  }
  return out;
}

/**
 * Finds the sentence of the previous version about one element and masks any
 * personal data before it is handed back (ENF-CONF-02). Below the similarity
 * floor nothing is carried over: a vague excerpt would read as a claim.
 */
function carryOver(sourceText: string, expected: string): string | null {
  if (sourceText.trim().length === 0) return null;
  const match = bestSentence(sourceText, expected);
  if (match === null || match.score < CARRY_MIN_SCORE) return null;
  return excerpt(redactText(match.sentence).text, MAX_CARRIED_CHARS);
}

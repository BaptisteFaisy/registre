/**
 * Attachment — EF-RAT-01 to EF-RAT-05 (spec 13.2).
 *
 * 13.2: "1. La chaîne interroge la base des référentiels avec le résumé et le
 * type de la preuve. 2. Le modèle reçoit la preuve et ces candidats. 3. Le code
 * vérifie que chaque passage cité existe bien dans la preuve. Une citation
 * introuvable annule le rattachement. 4. Les rattachements sûrs sont appliqués.
 * Les autres vont en validation."
 *
 * The model only returns quotes and confidences (ENF-IA-04): the page, the
 * status and the decision to apply are computed here.
 */

import type {
  Attachment,
  AttachmentStatus,
  Control,
  ControlId,
  Evidence,
  FrameworkId,
  ValidationItem
} from '../domain/types.ts';
import { evidenceText } from '../domain/types.ts';
import type { ControlCandidate, ProposedAttachment, Services } from '../ports/index.ts';
import { attachmentId } from '../support/ids.ts';
import { verifyQuoteInPages } from '../domain/citation.ts';
import { record } from '../audit/log.ts';
import { attachmentItem } from './queue.ts';

/** What the attachment step produced for one evidence — EF-RAT-01..05. */
export interface AttachOutcome {
  attachments: Attachment[];
  validationItems: ValidationItem[];
  /** Number of controls the knowledge base returned (spec 13.2 step 1). */
  candidateCount: number;
}

/** Only the fields of an evidence the reasoner and the quote check need. */
type EvidenceView = Pick<Evidence, 'id' | 'fields' | 'textPages' | 'accessLevel'>;

/** Candidate controls for one evidence, retrieval only — EF-RAT-01. */
export async function retrieveCandidates(
  services: Services,
  evidence: EvidenceView,
  frameworkId?: FrameworkId,
  suggestedControlId?: ControlId | null
): Promise<ControlCandidate[]> {
  const candidates = await services.controlRetriever.candidates({
    type: evidence.fields.type,
    title: evidence.fields.title,
    summary: evidence.fields.summary,
    text: evidenceText(evidence as Evidence),
    ...(frameworkId === undefined ? {} : { frameworkId })
  });
  return withSuggested(services, candidates, suggestedControlId);
}

/**
 * Adds the control the depositor targeted when retrieval missed it — EF-COL-02.
 * A hint never creates a support on its own: the model still has to say so and
 * the quote still has to be in the document.
 */
async function withSuggested(
  services: Services,
  candidates: readonly ControlCandidate[],
  suggestedControlId: ControlId | null | undefined
): Promise<ControlCandidate[]> {
  if (!suggestedControlId) return [...candidates];
  if (candidates.some((candidate) => candidate.control.id === suggestedControlId)) return [...candidates];
  const control = await services.state.getControl(suggestedControlId);
  if (!control) return [...candidates];
  return [...candidates, { control, score: 1, matchedOn: 'deposit-target' }];
}

/**
 * Proposes, verifies and records the attachments of one evidence — EF-RAT-01..05.
 * An evidence that supports no control is attached to nothing (EF-RAT-05).
 */
export async function proposeAttachments(
  services: Services,
  evidence: Evidence,
  actor: string,
  options: {
    frameworkId?: FrameworkId;
    suggestedControlId?: ControlId | null;
    /** Candidates already retrieved by the previous step, to spare one query. */
    candidates?: ControlCandidate[];
  } = {}
): Promise<AttachOutcome> {
  const candidates =
    options.candidates ??
    (await retrieveCandidates(services, evidence, options.frameworkId, options.suggestedControlId));
  if (candidates.length === 0) return { attachments: [], validationItems: [], candidateCount: 0 };
  const proposals = await services.reasoner.proposeAttachments({ evidence, candidates });
  const now = services.clock.now();
  const outcome: AttachOutcome = { attachments: [], validationItems: [], candidateCount: candidates.length };

  for (const proposal of proposals) {
    const candidate = candidates.find((item) => item.control.id === proposal.controlId);
    if (!candidate || !proposal.supports) continue;
    const attachment = buildAttachment(services, evidence, candidate.control, proposal, now);
    await services.state.putAttachment(attachment);
    outcome.attachments.push(attachment);
    const item = await journal(services, actor, attachment);
    if (item) outcome.validationItems.push(item);
  }
  return outcome;
}

/** One attachment, with the status and the page computed by code — EF-RAT-02/03. */
function buildAttachment(
  services: Services,
  evidence: Evidence,
  control: Control,
  proposal: ProposedAttachment,
  now: string
): Attachment {
  const check = verifyQuoteInPages(evidence.textPages, proposal.quote);
  const autoApplied = check.found && proposal.confidence >= services.settings.confidenceThreshold;
  return {
    id: attachmentId(evidence.id, control.id),
    evidenceId: evidence.id,
    controlId: control.id,
    frameworkId: control.frameworkId,
    supports: proposal.supports,
    confidence: proposal.confidence,
    quote: proposal.quote,
    quoteLocation: { page: check.page },
    reason: proposal.reason,
    status: statusOf(check.found, autoApplied),
    citationVerified: check.found,
    ...(check.found ? {} : { rejectionReason: 'CITATION_NOT_FOUND' as const }),
    autoApplied,
    model: services.reasoner.id,
    createdAt: now
  };
}

/** APPLIED above the threshold, PROPOSED below it, REJECTED without a quote — EF-RAT-03. */
function statusOf(citationFound: boolean, autoApplied: boolean): AttachmentStatus {
  if (!citationFound) return 'REJECTED';
  return autoApplied ? 'APPLIED' : 'PROPOSED';
}

/** Journals the outcome and queues the review a proposal needs — EF-RAT-03, EF-ADM-02. */
async function journal(services: Services, actor: string, attachment: Attachment): Promise<ValidationItem | null> {
  const detail = { controlId: attachment.controlId, confidence: attachment.confidence, page: attachment.quoteLocation.page };
  if (attachment.status === 'REJECTED') {
    await record(services, actor, 'ATTACHMENT_REJECTED', 'attachment', attachment.id, {
      ...detail,
      reason: attachment.rejectionReason
    });
    return null;
  }
  if (attachment.status === 'APPLIED') {
    await record(services, actor, 'ATTACHMENT_APPLIED', 'attachment', attachment.id, detail);
    return null;
  }
  await record(services, actor, 'ATTACHMENT_PROPOSED', 'attachment', attachment.id, {
    ...detail,
    threshold: services.settings.confidenceThreshold
  });
  const item = attachmentItem(attachment, services.settings.confidenceThreshold, attachment.createdAt);
  await services.state.putValidation(item);
  return item;
}

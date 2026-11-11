/**
 * Natural-language questions — EF-QR-01 ("répondre avec le document, la page et
 * la date cités"), EF-QR-02 ("dire qu'aucune preuve ne répond, plutôt que d'en
 * déduire une") and EF-QR-03 ("une preuve réservée n'est pas citée à qui n'y a
 * pas accès").
 *
 * Spec 13.4: search, compose, then a guardrail checks the anchoring; an answer
 * that is not anchored is replaced by "no evidence answers this question". The
 * search is deliberately widened to every access level so that a refusal can be
 * journalled: the filter below is the access boundary and runs before anything
 * is composed or rendered (ENF-CONF-01).
 */

import type {
  Answer,
  AnswerCitation,
  EvidenceId,
  Passage,
  Principal,
  TextPage
} from '../domain/types.ts';
import { ACCESS_ORDER, NO_EVIDENCE_ANSWER } from '../domain/types.ts';
import type { Services } from '../ports/index.ts';
import { canReadEvidence, filterPassagesWithDenials, maxLevel } from '../domain/access.ts';
import { verifyQuoteInPages } from '../domain/citation.ts';
import { badRequest } from '../support/errors.ts';
import { auditAccessDenied, record } from '../audit/log.ts';

/** A citation the code re-checked against the passages it names — ENF-IA-02. */
interface VerifiedCitation {
  evidenceId: EvidenceId;
  quote: string;
  page: number | null;
  passage: Passage;
}

/** What the filtered search returned, refusals included — EF-QR-03. */
interface SearchResult {
  allowed: Passage[];
  denied: EvidenceId[];
}

/**
 * Answers a question from the evidence the principal may read — EF-QR-01/02/03
 * (acceptance R11, R12, R13).
 */
export async function askQuestion(services: Services, principal: Principal, question: string): Promise<Answer> {
  const asked = question.trim();
  if (asked.length === 0) throw badRequest('the question is empty');
  const found = await search(services, principal, asked);
  const answer =
    found.allowed.length === 0 ? noEvidence(asked, 0) : await answerFrom(services, asked, found.allowed);
  await journal(services, principal, answer, found);
  return answer;
}

/** Searches every level, then keeps what the principal may read — EF-QR-03. */
async function search(services: Services, principal: Principal, question: string): Promise<SearchResult> {
  // The retriever owns its own limit (the number of excerpts a search may
  // return); the pipeline does not duplicate that default.
  const passages = await services.evidenceRetriever.search({
    query: question,
    allowedLevels: ACCESS_ORDER
  });
  const { allowed, denied } = filterPassagesWithDenials(principal, passages);
  const owned = await keepOwnedOnly(services, principal, allowed);
  for (const evidenceId of denied) await logDenial(services, principal, passages, evidenceId);
  for (const evidenceId of deniedByOwnership(allowed, owned)) {
    await logDenial(services, principal, passages, evidenceId);
  }
  return { allowed: owned, denied: [...denied, ...deniedByOwnership(allowed, owned)] };
}

/**
 * A control owner only reads the evidence of the controls they own — ENF-CONF-01.
 * Every other role reads everything its clearance allows.
 */
async function keepOwnedOnly(
  services: Services,
  principal: Principal,
  passages: Passage[]
): Promise<Passage[]> {
  if (principal.role !== 'CONTROL_OWNER') return passages;
  const kept: Passage[] = [];
  for (const passage of passages) {
    const supported = await supportedControls(services, passage.evidenceId);
    if (supported.some((controlId) => principal.ownedControls.includes(controlId))) kept.push(passage);
  }
  return kept;
}

/** The evidences dropped because the principal owns none of their controls. */
function deniedByOwnership(before: readonly Passage[], after: readonly Passage[]): EvidenceId[] {
  const kept = new Set(after.map((passage) => passage.evidenceId));
  return [...new Set(before.filter((passage) => !kept.has(passage.evidenceId)).map((passage) => passage.evidenceId))];
}

/**
 * One `ACCESS_DENIED` event per refused evidence, reason included — EF-ADM-02.
 * The reason comes from the domain, so the code of the refusal is the same in
 * the log as in the HTTP response.
 */
async function logDenial(
  services: Services,
  principal: Principal,
  passages: readonly Passage[],
  evidenceId: EvidenceId
): Promise<void> {
  const passage = passages.find((item) => item.evidenceId === evidenceId);
  if (!passage) return;
  const supported = await supportedControls(services, evidenceId);
  const decision = canReadEvidence(principal, { id: evidenceId, accessLevel: passage.accessLevel }, supported);
  await auditAccessDenied(services, principal, decision, 'evidence', evidenceId);
}

/**
 * Controls an evidence supports — a control owner only reads the evidence of the
 * controls they own (ENF-CONF-01, chapter 6).
 */
async function supportedControls(services: Services, evidenceId: EvidenceId): Promise<string[]> {
  const attachments = await services.state.listAttachments({ evidenceId });
  return [...new Set(attachments.map((attachment) => attachment.controlId))];
}

/** Composes, checks the anchoring, then masks — spec 13.4, ENF-CONF-02. */
async function answerFrom(services: Services, question: string, passages: Passage[]): Promise<Answer> {
  const draft = await services.composer.compose({ question, passages });
  if (draft.cost !== undefined) services.costs.record(draft.cost);
  const anchoring = await services.guardrail.verifyAnchoring({ answer: draft.text, passages });
  const verified = verifiedCitations(draft.citations, passages);
  if (!anchoring.anchored || verified.length === 0) {
    return withCost(noEvidence(question, passages.length), draft.cost);
  }
  const rendered = await services.guardrail.redact(draft.text);
  const citations = await citeAll(services, verified);
  return {
    question,
    text: rendered.text,
    citations,
    noEvidence: false,
    redacted: rendered.redacted,
    passagesUsed: passages.length,
    ...(draft.cost === undefined ? {} : { cost: draft.cost })
  };
}

/** Re-checks every citation against the passages of the evidence it names — ENF-IA-02. */
function verifiedCitations(
  citations: readonly { evidenceId: EvidenceId; quote: string; page: number | null }[],
  passages: readonly Passage[]
): VerifiedCitation[] {
  const out: VerifiedCitation[] = [];
  for (const citation of citations) {
    const passage = passages.find((item) => item.evidenceId === citation.evidenceId);
    if (!passage) continue;
    const check = verifyQuoteInPages(pagesOf(citation.evidenceId, passages), citation.quote);
    if (check.found) out.push({ evidenceId: citation.evidenceId, quote: citation.quote, page: check.page, passage });
  }
  return out;
}

/** The retrieved excerpts of one evidence, as pages the quote check can read. */
function pagesOf(evidenceId: EvidenceId, passages: readonly Passage[]): TextPage[] {
  return passages
    .filter((passage) => passage.evidenceId === evidenceId)
    .map((passage) => ({ page: passage.page ?? 0, text: passage.text }));
}

/** Citations with the document, the page and the date, quotes masked — EF-QR-01. */
async function citeAll(services: Services, verified: readonly VerifiedCitation[]): Promise<AnswerCitation[]> {
  const out: AnswerCitation[] = [];
  for (const item of verified) {
    const quote = await services.guardrail.redact(item.quote);
    out.push({
      evidenceId: item.evidenceId,
      title: item.passage.title,
      page: item.page,
      documentDate: item.passage.documentDate,
      quote: quote.text
    });
  }
  return out;
}

/** The honest answer when nothing grounds the question — EF-QR-02, R12. */
function noEvidence(question: string, passagesUsed: number): Answer {
  return {
    question,
    text: NO_EVIDENCE_ANSWER,
    citations: [],
    noEvidence: true,
    redacted: false,
    passagesUsed
  };
}

function withCost(answer: Answer, cost: Answer['cost']): Answer {
  return cost === undefined ? answer : { ...answer, cost };
}

/** One `QUESTION_ASKED` event, refusals counted — EF-ADM-02. */
async function journal(
  services: Services,
  principal: Principal,
  answer: Answer,
  found: SearchResult
): Promise<void> {
  await record(services, principal.id, 'QUESTION_ASKED', 'answer', answer.question, {
    citations: answer.citations.length,
    passagesUsed: answer.passagesUsed,
    noEvidence: answer.noEvidence,
    redacted: answer.redacted,
    deniedEvidence: found.denied.length,
    accessLevel: maxLevel(principal)
  });
}

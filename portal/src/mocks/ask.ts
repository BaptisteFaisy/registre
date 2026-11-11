/**
 * Mock question answering (EF-QR-01, EF-QR-02, EF-QR-03).
 *
 * Retrieval is a keyword search over the extracted pages, filtered by the
 * caller's clearance. When nothing scores, the answer says so instead of
 * inventing one — that is the behaviour the demonstration must show.
 */

import type { AccessLevel, Answer, AnswerCitation, Evidence, TextPage } from '../api/types.ts';
import { NO_EVIDENCE_ANSWER } from '../api/types.ts';
import { maskPersonalData } from '../lib/redact.ts';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'and', 'or', 'to', 'for', 'in', 'on', 'at', 'is', 'are', 'was',
  'were', 'do', 'does', 'did', 'we', 'our', 'you', 'it', 'this', 'that', 'with', 'from',
  'what', 'when', 'which', 'who', 'how', 'show', 'me', 'last', 'latest', 'most', 'recent',
  'there', 'any', 'have', 'has', 'been', 'by', 'be', 'as', 'please', 'give', 'tell'
]);

/** Words of the question that carry meaning. */
export function keywords(question: string): string[] {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

/** Access levels a principal may read, from its clearance. */
export function allowedLevels(clearance: AccessLevel): AccessLevel[] {
  if (clearance === 'RESTRICTED') return ['PUBLIC', 'INTERNAL', 'RESTRICTED'];
  if (clearance === 'INTERNAL') return ['PUBLIC', 'INTERNAL'];
  return ['PUBLIC'];
}

/** Masks names, e-mails and phone numbers of a passage (ENF-CONF-02). */
export function redact(text: string): string {
  return maskPersonalData(text);
}

interface Hit {
  evidence: Evidence;
  page: TextPage;
  score: number;
}

/** Scores every allowed page against the question keywords. */
function score(evidence: readonly Evidence[], words: readonly string[], clearance: AccessLevel): Hit[] {
  const levels = new Set(allowedLevels(clearance));
  const hits: Hit[] = [];
  for (const item of evidence) {
    if (!levels.has(item.accessLevel) || item.flags.unreadable) continue;
    for (const page of item.textPages) {
      const text = page.text.toLowerCase();
      let points = 0;
      for (const word of words) if (text.includes(word)) points += 1;
      if (points === 0) continue;
      const title = (item.fields.title ?? '').toLowerCase();
      for (const word of words) if (title.includes(word)) points += 1;
      hits.push({ evidence: item, page, score: points });
    }
  }
  return hits.sort((a, b) => b.score - a.score);
}

/** Builds a grounded citation from a hit. */
function citationOf(hit: Hit): AnswerCitation {
  const text = hit.evidence.fields.personalData ? redact(hit.page.text) : hit.page.text;
  return {
    evidenceId: hit.evidence.id,
    title: hit.evidence.fields.title,
    page: hit.page.page,
    documentDate: hit.evidence.fields.documentDate,
    quote: firstSentences(text, 2)
  };
}

/** Keeps the first `count` sentences of a passage. */
function firstSentences(text: string, count: number): string {
  const sentences = text.split(/(?<=\.)\s/);
  return sentences.slice(0, count).join(' ').slice(0, 320);
}

/** Answers a question from the mock evidence, or says nothing matches. */
export function answerQuestion(
  question: string,
  evidence: readonly Evidence[],
  clearance: AccessLevel
): Answer {
  const words = keywords(question);
  const hits = words.length === 0 ? [] : score(evidence, words, clearance);
  const best = hits.filter((hit) => hit.score >= Math.min(2, words.length)).slice(0, 3);

  if (best.length === 0) {
    return {
      question,
      text: NO_EVIDENCE_ANSWER,
      citations: [],
      noEvidence: true,
      redacted: false,
      passagesUsed: 0
    };
  }

  const citations = best.map(citationOf);
  const redacted = best.some((hit) => hit.evidence.fields.personalData);
  const lead = citations[0];
  return {
    question,
    text: `${lead?.quote ?? ''} The register holds this statement in ${lead?.title ?? 'the cited evidence'}${
      lead?.documentDate ? ` dated ${lead.documentDate.slice(0, 10)}` : ''
    }${citations.length > 1 ? `, and in ${citations.length - 1} further document(s)` : ''}.`,
    citations,
    noEvidence: false,
    redacted,
    passagesUsed: best.length
  };
}

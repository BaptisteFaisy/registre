/**
 * The 25 questions of the question-answering set (spec 13.5).
 *
 * Twenty questions have an answer in the evidence set; five are traps whose
 * only acceptable answer is the refusal of `NO_EVIDENCE_ANSWER` (EF-QR-02,
 * R12). Trap questions are phrased so that a plausible-looking answer could be
 * invented: a penetration test, a headcount, a certification, a hosting region,
 * an uptime that no document records.
 */

import type { CatalogueQuestion } from './types.ts';
import { questionId } from './types.ts';

interface QuestionInput {
  id: string;
  question: string;
  expectedEvidenceIds: string[];
  expectedAnswerKind: 'EVIDENCE' | 'NO_EVIDENCE';
  intent: string;
}

function q(n: number, question: string, expectedEvidenceIds: string[], intent: string): CatalogueQuestion {
  return {
    id: questionId(n),
    question,
    expectedEvidenceIds,
    expectedAnswerKind: expectedEvidenceIds.length > 0 ? 'EVIDENCE' : 'NO_EVIDENCE',
    intent
  };
}

function trap(n: number, question: string, intent: string): CatalogueQuestion {
  return { id: questionId(n), question, expectedEvidenceIds: [], expectedAnswerKind: 'NO_EVIDENCE', intent };
}

export const QUESTIONS: readonly CatalogueQuestion[] = [
  q(1, 'When was the information security policy last reviewed and who approved it?', ['EV-001'], 'policy review date and approver'),
  q(2, 'What recovery time was measured during the last restore test that recorded one?', ['EV-038'], 'measured recovery time'),
  q(3, 'Which system was restored during the Q1 2026 restore test?', ['EV-038'], 'restored system'),
  q(4, 'How many incidents were recorded in the third quarter of 2026?', ['EV-013'], 'incident count for the quarter'),
  q(5, 'What severity levels do the incidents of August 2026 carry?', ['EV-014'], 'severity breakdown'),
  q(6, 'What root cause was identified for incident INC-2026-014?', ['EV-015'], 'root cause of a major incident'),
  q(7, 'Which emergency change was reviewed in August 2026?', ['EV-024', 'EV-028'], 'emergency change review'),
  q(8, 'How many changes failed in the second quarter of 2026?', ['EV-025'], 'failed change count'),
  q(9, 'When was the configuration baseline approved and by whom?', ['EV-026'], 'baseline approval'),
  q(10, 'Who approved the business continuity plan?', ['EV-034'], 'continuity plan approver'),
  q(11, 'What recovery point objective applies to the managed database service?', ['EV-035'], 'recovery objectives per service'),
  q(12, 'How many backup jobs failed in September 2026?', ['EV-036'], 'failed backup jobs'),
  q(13, 'Who took part in the 2026 continuity exercise?', ['EV-037'], 'exercise participants'),
  q(14, 'Which privileged accounts were reviewed at the end of the third quarter?', ['EV-043', 'EV-048'], 'privileged access review'),
  q(15, 'How many employees completed the security awareness training in 2026?', ['EV-045'], 'training completion'),
  q(16, 'Which findings did the October 2026 vulnerability scan report?', ['EV-049'], 'scan findings'),
  q(17, 'How is customer data encrypted at rest in the managed environments?', ['EV-046'], 'encryption at rest'),
  q(18, 'What satisfaction score did the customers give in the first half of 2026?', ['EV-053'], 'satisfaction score'),
  q(19, 'When was the last service review held with Northwind Logistics?', ['EV-054'], 'service review date'),
  q(20, 'Which data handling agreements are on file with the customers?', ['EV-057'], 'agreement register'),

  trap(21, 'What was the result of the penetration test of the production cluster?', 'no penetration test exists in the evidence set'),
  trap(22, 'How many employees left the company in October 2026?', 'no headcount document exists in the evidence set'),
  trap(23, 'When does the ISO 27001 certificate expire?', 'no certificate is part of the evidence set'),
  trap(24, 'Which customers are hosted in the Frankfurt region?', 'no hosting inventory exists in the evidence set'),
  trap(25, 'What was the availability of the billing platform in 2025?', 'no 2025 availability report exists in the evidence set')
] as const;

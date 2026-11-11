/**
 * Question answering — chapter 15, EF-QR-01/02/03, ENF-IA-02.
 *
 * `POST /v1/ask` forwards the question to the pipeline, which retrieves the
 * passages the caller may read (EF-QR-03), composes an answer and verifies its
 * anchoring. The route only validates the body and serialises the answer: an
 * answer without support comes back with `noEvidence: true` (EF-QR-02, R12),
 * never as an invented fact.
 */

import type { Role } from '../../domain/types.ts';
import { json } from '../http.ts';
import type { ApiResponse } from '../http.ts';
import type { ApiContext, RouteDefinition } from '../types.ts';
import { optionalString, requiredString } from '../validate.ts';
import { answerView } from '../views.ts';
import { bodyObject, requireFramework } from './shared.ts';

/** Every role may ask a question, subject to its clearance (spec chapter 6). */
const ASK_ROLES: readonly Role[] = ['QUALITY_LEAD', 'ADMIN', 'EXECUTIVE', 'INTERNAL_AUDITOR', 'CONTROL_OWNER'];

/** Shortest accepted question, to refuse an empty click-through. */
const MIN_QUESTION_LENGTH = 3;

/** `POST /v1/ask` — natural-language question answered from the evidence. */
async function ask(context: ApiContext): Promise<ApiResponse> {
  const body = bodyObject(context);
  const question = requiredString(body, 'question', MIN_QUESTION_LENGTH);
  const frameworkId = optionalString(body, 'frameworkId');
  if (frameworkId !== undefined) await requireFramework(context.services, frameworkId);
  const answer = await context.pipeline.askQuestion(context.services, context.principal, question);
  return json(200, answerView(answer));
}

/** The ask route. */
export const askRoutes: readonly RouteDefinition[] = [
  {
    method: 'POST',
    path: '/v1/ask',
    handler: ask,
    meta: {
      operationId: 'askQuestion',
      summary: 'Answer a question from the stored evidence, with citations',
      tag: 'ask',
      requirement: 'EF-QR-01',
      roles: ASK_ROLES,
      requestSchema: 'AskRequest',
      responseSchema: 'Answer',
      errors: [400, 401, 403, 404, 502],
      notes:
        'Citations carry evidence id, title, page and document date. ' +
        'When nothing grounds the answer, text is "No evidence answers this question." and noEvidence is true.'
    }
  }
];

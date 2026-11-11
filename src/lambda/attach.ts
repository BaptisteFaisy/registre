/**
 * `attach` handler — Step Functions task 4 (EF-RAT-01..05, spec 13.2).
 *
 * Sends the evidence and its candidates to the model with structured output,
 * verifies every quoted passage exists in the document, applies the confident
 * attachments and queues the rest for a human (EF-VAL-01). `attachStep` owns
 * the rules; this file is transport only.
 */

import { attachStep } from '../pipeline/index.ts';
import { defineStepHandler } from './shared.ts';

export const handler = defineStepHandler(
  (services, payload, actor) => attachStep(services, payload, actor),
  'lambda-attach'
);

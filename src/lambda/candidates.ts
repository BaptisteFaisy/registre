/**
 * `candidates` handler — Step Functions task 3 (EF-RAT-01, spec 13.2 step 1).
 *
 * Retrieves the candidate controls from the frameworks knowledge base for the
 * evidence the previous step produced. No model call, no judgement: retrieval
 * only, exactly as `candidatesStep` implements it.
 */

import { candidatesStep } from '../pipeline/index.ts';
import { defineStepHandler } from './shared.ts';

export const handler = defineStepHandler(
  (services, payload) => candidatesStep(services, payload),
  'lambda-candidates'
);

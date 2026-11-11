/**
 * `read` handler — Step Functions task 2 of the chain (EF-LEC-01..04).
 *
 * Reads the document with Bedrock Data Automation (or the multimodal model
 * fallback), assembles the `Evidence` and journals the reading with its cost
 * (ENF-COUT-01). The rules live in `readStep`; this file is transport only.
 */

import { readStep } from '../pipeline/index.ts';
import { defineStepHandler } from './shared.ts';

export const handler = defineStepHandler(
  (services, payload, actor) => readStep(services, payload, actor),
  'lambda-read'
);

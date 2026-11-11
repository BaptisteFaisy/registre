/**
 * `states` handler — Step Functions task 6 (EF-FRA-02..04).
 *
 * Recomputes the state of every control the evidence touches, records the
 * readiness point and journals the recomputation. Pure code, no model
 * (ENF-IA-04): `statesStep` owns the matrix and the prudence rules.
 */

import { statesStep } from '../pipeline/index.ts';
import { defineStepHandler } from './shared.ts';

export const handler = defineStepHandler(
  (services, payload) => statesStep(services, payload),
  'lambda-states'
);

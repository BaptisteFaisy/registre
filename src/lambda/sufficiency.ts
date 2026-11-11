/**
 * `sufficiency` handler — Step Functions task 5 (EF-SUF-01/02).
 *
 * Compares every supporting attachment with the expected evidence of its
 * control, element by element, and classes the sufficiency. The class and the
 * list of what is missing are computed by the domain, never by the model
 * (ENF-IA-04); `sufficiencyStep` owns the rules.
 */

import { sufficiencyStep } from '../pipeline/index.ts';
import { defineStepHandler } from './shared.ts';

export const handler = defineStepHandler(
  (services, payload) => sufficiencyStep(services, payload),
  'lambda-sufficiency'
);

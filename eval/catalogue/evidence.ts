/**
 * The 60 evidence of the demonstration set, assembled from the five domain
 * files, plus the lookups every consumer needs.
 *
 * Order is stable (EV-001 … EV-060), so generated datasets are reproducible.
 */

import type { CatalogueEvidence } from './types.ts';
import { GOVERNANCE_EVIDENCE } from './evidenceGovernance.ts';
import { OPERATIONS_EVIDENCE } from './evidenceOperations.ts';
import { CONTINUITY_EVIDENCE } from './evidenceContinuity.ts';
import { SECURITY_EVIDENCE } from './evidenceSecurity.ts';
import { CLIENT_EVIDENCE } from './evidenceClients.ts';

export const EVIDENCE: readonly CatalogueEvidence[] = [
  ...GOVERNANCE_EVIDENCE,
  ...OPERATIONS_EVIDENCE,
  ...CONTINUITY_EVIDENCE,
  ...SECURITY_EVIDENCE,
  ...CLIENT_EVIDENCE
] as const;

const EVIDENCE_BY_ID = new Map(EVIDENCE.map((item) => [item.id, item]));

/** Returns the evidence or `undefined`; never throws, so callers can validate. */
export function findEvidence(id: string): CatalogueEvidence | undefined {
  return EVIDENCE_BY_ID.get(id);
}

/** Evidence that carry at least one expected sufficiency gap. */
export function incompleteEvidence(): CatalogueEvidence[] {
  return EVIDENCE.filter((item) => item.missingElements.length > 0);
}

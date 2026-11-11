/**
 * Sufficiency — EF-SUF-01 ("comparer la preuve à la liste des preuves attendues
 * du contrôle et lister ce qui manque") and EF-SUF-02 ("classer la suffisance :
 * complète, partielle, à vérifier. Jamais « conforme »").
 *
 * The model only says, element by element, whether the element is present and
 * with which quote (ENF-IA-04). The class and the list of missing elements are
 * computed by `src/domain/sufficiency.ts`, never by the model.
 */

import type { Attachment, Evidence, Sufficiency, ValidationItem } from '../domain/types.ts';
import type { Services } from '../ports/index.ts';
import { buildSufficiency } from '../domain/sufficiency.ts';
import { sufficiencyItem } from './queue.ts';

/** What the sufficiency step produced for one evidence — EF-SUF-01/02. */
export interface SufficiencyOutcome {
  sufficiencies: Sufficiency[];
  validationItems: ValidationItem[];
}

/** Attachments worth a sufficiency check: supported and not rejected — EF-SUF-01. */
export function assessableAttachments(attachments: readonly Attachment[]): Attachment[] {
  return attachments.filter((attachment) => attachment.status !== 'REJECTED' && attachment.supports);
}

/**
 * Assesses every attachment of one evidence against its control's expected
 * evidence, then queues the partial ones for review — EF-SUF-01/02, R7.
 */
export async function assessAttachments(
  services: Services,
  evidence: Evidence,
  attachments: readonly Attachment[]
): Promise<SufficiencyOutcome> {
  const outcome: SufficiencyOutcome = { sufficiencies: [], validationItems: [] };
  for (const attachment of assessableAttachments(attachments)) {
    const control = await services.state.getControl(attachment.controlId);
    if (!control) continue;
    const elements = await services.reasoner.assessSufficiency({ evidence, control });
    const sufficiency = buildSufficiency({ attachment, elements, now: services.clock.now() });
    await services.state.putSufficiency(sufficiency);
    outcome.sufficiencies.push(sufficiency);
    const item = await queuePartial(services, sufficiency);
    if (item) outcome.validationItems.push(item);
  }
  return outcome;
}

/** A partial sufficiency waits for a human; a complete one does not — EF-VAL-01. */
async function queuePartial(services: Services, sufficiency: Sufficiency): Promise<ValidationItem | null> {
  if (sufficiency.class !== 'PARTIAL') return null;
  const item = sufficiencyItem(sufficiency, services.clock.now());
  await services.state.putValidation(item);
  return item;
}

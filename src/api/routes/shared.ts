/**
 * Helpers shared by the route files: loading an entity or failing with 404,
 * reading an optional JSON body, and the write-side ownership check.
 *
 * One implementation per behaviour — every route loads its framework, control,
 * evidence, pack or validation item through these functions, so the 404 body
 * and the audit trail of a refusal are identical everywhere.
 */

import { canReadControl } from '../../domain/access.ts';
import type {
  Control,
  ControlId,
  ControlStatus,
  Evidence,
  EvidenceId,
  Framework,
  FrameworkId,
  Pack,
  PackId,
  Principal,
  ValidationItem
} from '../../domain/types.ts';
import type { StateStore } from '../../ports/index.ts';
import { notFound } from '../../support/errors.ts';
import { accessDenied } from '../errors.ts';
import { recordDenial } from '../access.ts';
import type { AccessDeps } from '../access.ts';
import { objectBody } from '../validate.ts';
import type { ApiContext } from '../types.ts';

/** Services slice the loaders need. */
export interface LoaderDeps {
  state: StateStore;
}

/** Loads a framework or throws 404. */
export async function requireFramework(deps: LoaderDeps, id: FrameworkId): Promise<Framework> {
  const framework = await deps.state.getFramework(id);
  if (framework === null) throw notFound(`framework ${id} does not exist`, { frameworkId: id });
  return framework;
}

/** Loads a control or throws 404. */
export async function requireControl(deps: LoaderDeps, id: ControlId): Promise<Control> {
  const control = await deps.state.getControl(id);
  if (control === null) throw notFound(`control ${id} does not exist`, { controlId: id });
  return control;
}

/** Loads an evidence or throws 404. */
export async function requireEvidence(deps: LoaderDeps, id: EvidenceId): Promise<Evidence> {
  const evidence = await deps.state.getEvidence(id);
  if (evidence === null) throw notFound(`evidence ${id} does not exist`, { evidenceId: id });
  return evidence;
}

/** Loads a pack or throws 404. */
export async function requirePack(deps: LoaderDeps, id: PackId): Promise<Pack> {
  const pack = await deps.state.getPack(id);
  if (pack === null) throw notFound(`pack ${id} does not exist`, { packId: id });
  return pack;
}

/** Loads a validation item or throws 404. */
export async function requireValidation(deps: LoaderDeps, id: string): Promise<ValidationItem> {
  const item = await deps.state.getValidation(id);
  if (item === null) throw notFound(`validation ${id} does not exist`, { validationId: id });
  return item;
}

/** Current status of one control, from its framework recomputation (EF-FRA-02). */
export async function statusOf(context: ApiContext, control: Control): Promise<ControlStatus | null> {
  const { statuses } = await context.pipeline.recomputeFramework(context.services, control.frameworkId);
  return statuses.find((status) => status.controlId === control.id) ?? null;
}

/** JSON body of a write request; an empty body yields `{}` when optional. */
export function bodyObject(context: ApiContext, optional = false): Record<string, unknown> {
  if (optional && context.request.body.byteLength === 0) return {};
  return objectBody(context.json());
}

/**
 * Write-side ownership: a control owner may only act on its own controls,
 * every other role allowed here acts on all of them — spec chapter 6.
 */
export async function requireControlOwnership(
  deps: AccessDeps,
  principal: Principal,
  controlId: ControlId
): Promise<void> {
  if (principal.role !== 'CONTROL_OWNER') return;
  const decision = canReadControl(principal, controlId);
  if (decision.allowed) return;
  await recordDenial(deps, principal, decision, 'control', controlId);
  throw accessDenied(`control ${controlId} is not owned by this principal`, {
    role: principal.role,
    controlId
  });
}

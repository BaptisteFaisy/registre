/**
 * Framework import — EF-REF-01 ("importer un référentiel depuis un fichier"),
 * EF-REF-02 (several frameworks, several versions of one framework) and
 * EF-REF-05 ("lors d'un changement de version, signaler les contrôles ajoutés,
 * modifiés ou retirés").
 *
 * Validation, normalisation and version diffing live in
 * `src/domain/frameworks.ts`; this module persists the result, refuses a version
 * that is already imported, and recomputes the states of the new controls.
 */

import type { Control, Framework, FrameworkImport } from '../domain/types.ts';
import type { ImportResult, Services } from '../ports/index.ts';
import { diffVersions, normaliseFrameworkImport } from '../domain/frameworks.ts';
import { conflict } from '../support/errors.ts';
import { record } from '../audit/log.ts';
import { recomputeFramework } from './states.ts';

/** What the store already holds for a framework id — EF-REF-05. */
interface StoredVersion {
  framework: Framework;
  controls: Control[];
}

/**
 * Imports one framework version and recomputes its states — EF-REF-01/02/05
 * (acceptance R1: the demonstration framework lands with all its controls).
 */
export async function importFramework(
  services: Services,
  input: FrameworkImport,
  actor: string
): Promise<ImportResult> {
  const stored = await storedVersion(services, input);
  const normalised = normaliseFrameworkImport(input, services.clock.now());
  assertVersionIsNew(stored, normalised.framework);
  const diff = stored === null ? null : diffVersions(stored.controls, normalised.controls);
  await services.state.putFramework(normalised.framework);
  await services.state.putControls(normalised.controls);
  await record(services, actor, 'FRAMEWORK_IMPORTED', 'framework', normalised.framework.id, {
    version: normalised.framework.version,
    controls: normalised.controls.length,
    confidentiality: normalised.framework.confidentiality,
    ...(diff === null ? {} : { added: diff.added.length, changed: diff.changed.length, removed: diff.removed.length })
  });
  await recomputeFramework(services, normalised.framework.id);
  return { framework: normalised.framework, controls: normalised.controls, diff };
}

/** The version currently stored for this framework id, `null` on a first import — EF-REF-05. */
async function storedVersion(services: Services, input: FrameworkImport): Promise<StoredVersion | null> {
  const id = input.framework?.id;
  if (typeof id !== 'string' || id.trim().length === 0) return null;
  const framework = await services.state.getFramework(id);
  if (!framework) return null;
  return { framework, controls: await services.state.listControls(id) };
}

/**
 * The same version cannot be imported twice — EF-REF-02 (docs/API.md §1: a
 * duplicate version is a `CONFLICT`, a new version is a normal import).
 */
function assertVersionIsNew(stored: StoredVersion | null, incoming: Framework): void {
  if (stored === null) return;
  if (stored.framework.version !== incoming.version) return;
  throw conflict(`framework ${incoming.id} version ${incoming.version} is already imported`, {
    frameworkId: incoming.id,
    version: incoming.version
  });
}

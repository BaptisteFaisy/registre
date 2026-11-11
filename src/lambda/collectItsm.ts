/**
 * `collectItsm` handler — EF-COL-03: export incidents, changes and problems.
 *
 * Scheduled nightly. The export is read from an HTTP endpoint
 * (`ITSM_SOURCE_URL`) or from a file the ITSM scheduler drops
 * (`ITSM_SOURCE_FILE`); one of the two must be configured, otherwise the run
 * fails loudly with a `CONFIG` error instead of producing an empty export.
 */

import { ItsmCollector, fileTextSource, httpTextSource } from '../collectors/index.ts';
import type { TextSource } from '../collectors/index.ts';
import type { Services } from '../ports/index.ts';
import { defineCollectorHandler, requiredEnv } from './collectors.ts';

/** The export source of this deployment: an endpoint, or a dropped file. */
function sourceOf(env: NodeJS.ProcessEnv): TextSource {
  const url = env.ITSM_SOURCE_URL;
  if (url !== undefined && url.trim().length > 0) return httpTextSource(url.trim());
  const path = requiredEnv(env, ['ITSM_SOURCE_FILE'], 'the ITSM export source');
  return fileTextSource(path);
}

/** Builds the ticket collector of this deployment. */
function buildCollector(services: Services, env: NodeJS.ProcessEnv): ItsmCollector {
  return new ItsmCollector({
    source: sourceOf(env),
    clock: services.clock,
    system: env.ITSM_SYSTEM ?? 'tickets',
    ...(env.ITSM_FORMAT === 'JSON' ? { format: 'JSON' as const } : {})
  });
}

export const handler = defineCollectorHandler('collectItsm', buildCollector);

/**
 * `collectS3` handler — EF-COL-01: scan the partner document bucket.
 *
 * Scheduled nightly by the collectors stack. The bucket, the prefix and the
 * bound of one run come from the deployment environment; `S3Collector` reaches
 * the SDK lazily, so importing this module never opens a connection.
 */

import { S3Collector } from '../collectors/index.ts';
import type { Services } from '../ports/index.ts';
import { defineCollectorHandler, requiredEnv } from './collectors.ts';

/** Builds the S3 collector of this deployment. */
function buildCollector(services: Services, env: NodeJS.ProcessEnv): S3Collector {
  const maxObjects = Number(env.SOURCE_MAX_OBJECTS ?? 100);
  return new S3Collector({
    bucket: requiredEnv(env, ['SOURCE_BUCKET', 'REGISTRE_SOURCE_BUCKET'], 'the partner document bucket'),
    prefix: env.SOURCE_PREFIX ?? '',
    clock: services.clock,
    region: env.REGISTRE_REGION ?? services.settings.region,
    ...(Number.isFinite(maxObjects) && maxObjects > 0 ? { maxObjects } : {})
  });
}

export const handler = defineCollectorHandler('collectS3', buildCollector);

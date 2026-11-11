/**
 * `collectAwsReport` handler — EF-COL-04: a dated report of an AWS state.
 *
 * Scheduled monthly. The report is an inventory of an S3 prefix, the state an
 * MSP can always produce without an extra service (`s3InventoryReportFetcher`);
 * an AWS Backup report plugs into the same `ReportFetcher` port. The fetcher
 * reaches the SDK lazily, so importing this module never opens a connection.
 */

import { AwsReportCollector, s3InventoryReportFetcher } from '../collectors/index.ts';
import type { Services } from '../ports/index.ts';
import { defineCollectorHandler, requiredEnv } from './collectors.ts';

/** Builds the AWS state-report collector of this deployment. */
function buildCollector(services: Services, env: NodeJS.ProcessEnv): AwsReportCollector {
  const name = env.AWS_REPORT_NAME ?? 'state';
  return new AwsReportCollector({
    fetcher: s3InventoryReportFetcher({
      bucket: requiredEnv(env, ['AWS_REPORT_BUCKET', 'SOURCE_BUCKET'], 'the bucket the report inventories'),
      prefix: env.AWS_REPORT_PREFIX ?? '',
      region: env.REGISTRE_REGION ?? services.settings.region
    }),
    clock: services.clock,
    name
  });
}

export const handler = defineCollectorHandler('collectAwsReport', buildCollector);

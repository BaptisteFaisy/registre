/**
 * Public surface of the collectors module (EF-COL-01..05, chapter 11.2).
 *
 * A collector produces `CollectedFile`s; `runCollectors` fingerprints them,
 * detects duplicates (R8) and journals the run (ENF-OBS-01).
 */

export { collectedFile, contentTypeFor, dayOf, safeName, utf8Bytes } from './types.ts';
export type {
  CollectedFile,
  CollectedFileInput,
  Collector,
  CollectorCursor
} from './types.ts';

export { S3Collector, s3ListerFromSdk, s3ObjectKey } from './s3.ts';
export type { S3CollectorOptions, S3Lister, S3ListInput, S3ObjectPayload, S3ObjectRef, S3Page } from './s3.ts';

export { ManualCollector } from './manual.ts';
export type { ManualDeposit } from './manual.ts';

export { ItsmCollector, fileTextSource, httpTextSource } from './itsm.ts';
export type { ItsmCollectorOptions, TextFetcher, TextSource } from './itsm.ts';
export { countByKind, filterTickets, parseTickets, ticketsToCsv, ticketsToJson } from './itsmTickets.ts';
export type { TicketRecord } from './itsmTickets.ts';

export { AwsReportCollector, countRows, s3InventoryReportFetcher, startOfMonth } from './awsReport.ts';
export type {
  AwsReportCollectorOptions,
  ReportFetcher,
  ReportRow,
  ReportSection,
  ReportValue,
  ReportWindow,
  S3InventoryFetcherOptions
} from './awsReport.ts';

export { CollectorRegistry, registryOf } from './registry.ts';

export { DEFAULT_COLLECTOR_TIMEOUT_MS, runCollectors } from './runCollectors.ts';
export type {
  CollectedOutcome,
  CollectorRun,
  CollectorRunReport,
  RunCollectorsOptions
} from './runCollectors.ts';

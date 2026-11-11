/**
 * AWS state report collector — EF-COL-04: "AWS collector: dated report of a
 * state (for example the backups of the month), produced as a file".
 *
 * The AWS call itself sits behind `ReportFetcher`, a one-argument port: the
 * collector is pure formatting and date arithmetic, the fetcher owns the
 * credentials. Tests inject a fetcher that returns fixtures; production uses
 * `s3InventoryReportFetcher`, which imports the SDK lazily.
 *
 * Note for the deployment: an AWS Backup report plugs into the same port
 * (`awsBackupReportFetcher`) — the `@aws-sdk/client-backup` package is not a
 * dependency of this repository, so it is described rather than shipped here.
 */

import type { Clock } from '../ports/index.ts';
import { upstream } from '../support/errors.ts';
import type { CollectedFile, Collector, CollectorCursor } from './types.ts';
import { collectedFile, dayOf, safeName, utf8Bytes } from './types.ts';

/** One row of a report section; every value is a plain scalar. */
export type ReportValue = string | number | null;
export type ReportRow = Record<string, ReportValue>;

/** One section of a report, e.g. "Backup jobs" with its rows. */
export interface ReportSection {
  title: string;
  rows: ReportRow[];
}

/** The period the report covers. */
export interface ReportWindow {
  from: string;
  to: string;
}

/** Injected AWS reader: returns the sections of the state report. */
export type ReportFetcher = (window: ReportWindow) => Promise<ReportSection[]>;

export interface AwsReportCollectorOptions {
  fetcher: ReportFetcher;
  clock: Clock;
  id?: string;
  /** Report name, used in the key: `backups`, `configuration`, `access`. */
  name?: string;
  /** Window start when the cursor carries none; defaults to the month start. */
  since?: string;
  until?: string;
}

/** First instant of the month containing `instant` (UTC). */
export function startOfMonth(instant: string): string {
  return `${instant.slice(0, 7)}-01T00:00:00.000Z`;
}

/** Total row count of a report, journalled for supervision (ENF-OBS-01). */
export function countRows(sections: readonly ReportSection[]): number {
  return sections.reduce((total, section) => total + section.rows.length, 0);
}

export class AwsReportCollector implements Collector {
  readonly id: string;
  readonly kind = 'AWS_REPORT' as const;

  private readonly options: AwsReportCollectorOptions;

  /** Builds a report collector over an injected AWS reader. */
  constructor(options: AwsReportCollectorOptions) {
    this.options = options;
    this.id = options.id ?? `collector-aws-${safeName(options.name ?? 'state')}`;
  }

  /** Fetches the state of the period and writes it as one dated JSON file. */
  async collect(cursor?: CollectorCursor): Promise<CollectedFile[]> {
    const now = this.options.clock.now();
    const to = cursor?.until ?? this.options.until ?? now;
    const from = cursor?.since ?? this.options.since ?? startOfMonth(to);
    const sections = await this.options.fetcher({ from, to });
    const name = safeName(this.options.name ?? 'state');
    const day = dayOf(to);
    const document = {
      report: name,
      period: { from, to },
      generatedAt: now,
      rowCount: countRows(sections),
      sections
    };
    return [
      collectedFile({
        key: `aws-report/${name}/${day}.json`,
        uri: `aws://${name}/${day}`,
        kind: 'AWS_REPORT',
        contentType: 'application/json',
        bytes: utf8Bytes(`${JSON.stringify(document, null, 2)}\n`),
        collectedAt: now,
        title: `${name} report ${from.slice(0, 10)} to ${day}`,
        fileDate: day,
        metadata: {
          report: name,
          since: from,
          until: to,
          rowCount: String(document.rowCount)
        }
      })
    ];
  }
}

export interface S3InventoryFetcherOptions {
  bucket: string;
  prefix?: string;
  region?: string;
  /** Hard bound so one report cannot pull a whole bucket (EF-PERF-01). */
  maxObjects?: number;
}

/**
 * Real fetcher: an inventory of an S3 prefix, the state an MSP can always
 * produce without extra services. Lazily imports `@aws-sdk/client-s3`.
 */
export function s3InventoryReportFetcher(options: S3InventoryFetcherOptions): ReportFetcher {
  return async (window) => {
    const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const client = new S3Client({ region: options.region ?? 'eu-central-1' });
    try {
      const response = await client.send(
        new ListObjectsV2Command({
          Bucket: options.bucket,
          Prefix: options.prefix ?? '',
          MaxKeys: options.maxObjects ?? 1000
        })
      );
      const rows: ReportRow[] = (response.Contents ?? []).map((item) => ({
        key: item.Key ?? '',
        sizeBytes: item.Size ?? 0,
        lastModified: item.LastModified?.toISOString() ?? null
      }));
      return [
        { title: `Objects in s3://${options.bucket}/${options.prefix ?? ''}`, rows },
        { title: 'Report window', rows: [{ from: window.from, to: window.to }] }
      ];
    } catch (error) {
      throw upstream('aws report: listing the bucket failed', {
        bucket: options.bucket,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };
}

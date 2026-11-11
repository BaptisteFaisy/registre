/**
 * AWS state report collector — EF-COL-04: a dated report of an AWS state
 * (backups of the month), produced as a file. The fetcher is injected.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AwsReportCollector,
  countRows,
  startOfMonth
} from '../../src/collectors/awsReport.ts';
import type { ReportFetcher, ReportWindow } from '../../src/collectors/awsReport.ts';
import { FixedClock } from '../../src/support/clock.ts';
import { RegistreError } from '../../src/support/errors.ts';
import { TEST_NOW } from '../fixtures/builders.ts';

const clock = new FixedClock(TEST_NOW);

/** Fetcher that records the window it was asked for. */
function fakeFetcher(): { fetcher: ReportFetcher; windows: ReportWindow[] } {
  const windows: ReportWindow[] = [];
  const fetcher: ReportFetcher = async (window) => {
    windows.push(window);
    return [
      {
        title: 'Backup jobs',
        rows: [
          { jobId: 'job-1', resource: 'db-clients', status: 'COMPLETED', completedAt: '2026-11-05T02:00:00Z' },
          { jobId: 'job-2', resource: 'fs-shared', status: 'FAILED', completedAt: '2026-11-06T02:00:00Z' }
        ]
      },
      { title: 'Restore tests', rows: [{ testId: 'rt-1', duration: 42 }] }
    ];
  };
  return { fetcher, windows };
}

test('collect: produces one dated report file (EF-COL-04)', async () => {
  const { fetcher } = fakeFetcher();
  const files = await new AwsReportCollector({ fetcher, clock, name: 'backups' }).collect();

  assert.equal(files.length, 1);
  const [file] = files;
  assert.ok(file !== undefined);
  assert.equal(file.key, 'aws-report/backups/2026-11-11.json');
  assert.equal(file.kind, 'AWS_REPORT');
  assert.equal(file.contentType, 'application/json');
  assert.equal(file.fileDate, '2026-11-11');
  assert.equal(file.uri, 'aws://backups/2026-11-11');
});

test('collect: the report carries its period, its sections and its row count', async () => {
  const { fetcher } = fakeFetcher();
  const [file] = await new AwsReportCollector({ fetcher, clock, name: 'backups' }).collect();
  const report = JSON.parse(new TextDecoder().decode(file?.bytes)) as {
    report: string;
    period: ReportWindow;
    generatedAt: string;
    rowCount: number;
    sections: Array<{ title: string; rows: unknown[] }>;
  };

  assert.equal(report.report, 'backups');
  assert.deepEqual(report.period, { from: '2026-11-01T00:00:00.000Z', to: TEST_NOW });
  assert.equal(report.generatedAt, TEST_NOW);
  assert.equal(report.rowCount, 3);
  assert.deepEqual(
    report.sections.map((section) => section.title),
    ['Backup jobs', 'Restore tests']
  );
});

test('collect: the default window starts at the beginning of the month', async () => {
  const { fetcher, windows } = fakeFetcher();
  await new AwsReportCollector({ fetcher, clock, name: 'backups' }).collect();
  assert.deepEqual(windows[0], { from: '2026-11-01T00:00:00.000Z', to: TEST_NOW });
});

test('collect: the cursor overrides the window and dates the file', async () => {
  const { fetcher, windows } = fakeFetcher();
  const [file] = await new AwsReportCollector({ fetcher, clock, name: 'backups' }).collect({
    since: '2026-10-01T00:00:00.000Z',
    until: '2026-10-31T23:59:59.000Z'
  });

  assert.deepEqual(windows[0], { from: '2026-10-01T00:00:00.000Z', to: '2026-10-31T23:59:59.000Z' });
  assert.equal(file?.key, 'aws-report/backups/2026-10-31.json');
});

test('collect: a failing fetcher surfaces as a RegistreError', async () => {
  const fetcher: ReportFetcher = async () => {
    throw new RegistreError('UPSTREAM', 'backup api unavailable');
  };
  await assert.rejects(
    new AwsReportCollector({ fetcher, clock, name: 'backups' }).collect(),
    (error: unknown) => {
      assert.ok(error instanceof RegistreError);
      assert.equal(error.code, 'UPSTREAM');
      return true;
    }
  );
});

test('collect: an empty report is still a valid, dated file', async () => {
  const [file] = await new AwsReportCollector({
    fetcher: async () => [],
    clock,
    name: 'configuration'
  }).collect();
  const report = JSON.parse(new TextDecoder().decode(file?.bytes)) as { rowCount: number; sections: unknown[] };
  assert.equal(report.rowCount, 0);
  assert.deepEqual(report.sections, []);
});

test('helpers: startOfMonth and countRows are pure and deterministic', () => {
  assert.equal(startOfMonth('2026-11-11T12:00:00.000Z'), '2026-11-01T00:00:00.000Z');
  assert.equal(startOfMonth('2026-02-28'), '2026-02-01T00:00:00.000Z');
  assert.equal(
    countRows([
      { title: 'a', rows: [{ x: 1 }, { x: 2 }] },
      { title: 'b', rows: [] }
    ]),
    2
  );
});

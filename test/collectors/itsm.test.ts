/**
 * ITSM collector — EF-COL-03: ticket exports (incidents, changes, problems) over
 * a period, produced as one dated file.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { ItsmCollector, fileTextSource, httpTextSource } from '../../src/collectors/itsm.ts';
import type { ItsmCollectorOptions } from '../../src/collectors/itsm.ts';
import { parseTickets, ticketsToCsv } from '../../src/collectors/itsmTickets.ts';
import { FixedClock } from '../../src/support/clock.ts';
import { RegistreError } from '../../src/support/errors.ts';
import { TEST_NOW } from '../fixtures/builders.ts';

const clock = new FixedClock(TEST_NOW);

const CSV_EXPORT = [
  'number,type,created_at,closed_at,state,priority,short_description',
  'INC-1,incident,2026-10-02T08:00:00Z,2026-10-02T10:00:00Z,closed,high,"Mail outage, tier 1"',
  'INC-2,incident,2026-11-01T08:00:00Z,,open,medium,Slow VPN',
  'CHG-7,change,2026-09-15T08:00:00Z,2026-09-20T08:00:00Z,closed,low,Firewall upgrade'
].join('\n');

const JSON_EXPORT = JSON.stringify({
  tickets: [
    {
      id: 'PRB-3',
      type: 'problem',
      createdAt: '2026-10-20T09:00:00Z',
      closedAt: '2026-10-25T09:00:00Z',
      status: 'closed',
      priority: 'high',
      title: 'Recurring backup failures'
    }
  ]
});

function sourceOf(text: string) {
  return { description: 'memory://export', read: async () => text };
}

/** Builds a collector over an in-memory export, with a fixed period. */
function collectorOf(text: string, overrides: Partial<ItsmCollectorOptions> = {}): ItsmCollector {
  return new ItsmCollector({
    source: sourceOf(text),
    clock,
    system: 'incidents',
    since: '2026-10-01T00:00:00.000Z',
    until: TEST_NOW,
    ...overrides
  });
}

test('collect: produces one dated CSV file for the period (EF-COL-03)', async () => {
  const files = await collectorOf(CSV_EXPORT).collect();

  assert.equal(files.length, 1);
  const [file] = files;
  assert.ok(file !== undefined);
  assert.equal(file.key, 'itsm/incidents/2026-11-11.csv');
  assert.equal(file.kind, 'ITSM');
  assert.equal(file.contentType, 'text/csv');
  assert.equal(file.fileDate, '2026-11-11');
  assert.equal(file.metadata?.ticketCount, '2');
  assert.match(new TextDecoder().decode(file.bytes), /^id,kind,createdAt,closedAt,status,priority,title/);
});

test('collect: keeps only the tickets whose lifetime overlaps the period', async () => {
  const [file] = await collectorOf(CSV_EXPORT).collect();
  const text = new TextDecoder().decode(file?.bytes);

  assert.match(text, /INC-1/);
  assert.match(text, /INC-2/);
  assert.doesNotMatch(text, /CHG-7/, 'a change closed in September is outside the period');
});

test('collect: a JSON export is parsed through its ticket array', async () => {
  const [file] = await collectorOf(JSON_EXPORT, { format: 'JSON' }).collect();
  const body = new TextDecoder().decode(file?.bytes);

  assert.equal(file?.contentType, 'application/json');
  assert.match(body, /PRB-3/);
  assert.match(body, /"count": 1/);
  assert.match(body, /"PROBLEM": 1/);
});

test('collect: the generated JSON is stamped with the end of the period', async () => {
  const [file] = await collectorOf(JSON_EXPORT, { format: 'JSON' }).collect();
  const parsed = JSON.parse(new TextDecoder().decode(file?.bytes)) as { generatedAt: string };
  assert.equal(parsed.generatedAt, TEST_NOW);
});

test('collect: the cursor overrides the configured period', async () => {
  const [file] = await collectorOf(CSV_EXPORT).collect({
    since: '2026-10-31T00:00:00.000Z',
    until: '2026-11-05T00:00:00.000Z'
  });
  const text = new TextDecoder().decode(file?.bytes);

  assert.match(text, /INC-2/);
  assert.doesNotMatch(text, /INC-1/);
  assert.equal(file?.key, 'itsm/incidents/2026-11-05.csv');
});

test('collect: the default period is the last 90 days', async () => {
  const collector = new ItsmCollector({ source: sourceOf(CSV_EXPORT), clock, system: 'incidents' });
  const [file] = await collector.collect();
  assert.equal(file?.metadata?.since, '2026-08-13T12:00:00.000Z');
  assert.equal(file?.metadata?.until, TEST_NOW);
});

test('parsing: CSV honours quoted cells containing a comma', () => {
  const tickets = parseTickets(CSV_EXPORT);
  assert.equal(tickets.length, 3);
  assert.equal(tickets[0]?.title, 'Mail outage, tier 1');
  assert.equal(tickets[0]?.closedAt, '2026-10-02T10:00:00Z');
});

test('parsing: JSON accepts a bare array or a wrapper object', () => {
  const bare = parseTickets(JSON.stringify([{ id: 'X-1', type: 'incident' }]));
  const wrapped = parseTickets(JSON.stringify({ items: [{ id: 'X-2', type: 'problem' }] }));
  assert.equal(bare[0]?.id, 'X-1');
  assert.equal(wrapped[0]?.kind, 'PROBLEM');
});

test('parsing: an empty export yields no ticket', () => {
  assert.deepEqual(parseTickets('   '), []);
});

test('serialising: a title with a comma is quoted back', () => {
  const csv = ticketsToCsv(parseTickets(CSV_EXPORT));
  assert.match(csv, /"Mail outage, tier 1"/);
});

test('sources: a missing file surfaces as UPSTREAM', async () => {
  const collector = new ItsmCollector({
    source: fileTextSource('/nonexistent/export.csv'),
    clock,
    system: 'incidents'
  });
  await assert.rejects(collector.collect(), (error: unknown) => {
    assert.ok(error instanceof RegistreError);
    assert.equal(error.code, 'UPSTREAM');
    return true;
  });
});

test('sources: an HTTP failure surfaces as UPSTREAM, without opening a socket', async () => {
  const collector = new ItsmCollector({
    source: httpTextSource('https://itsm.example/export', async () => {
      throw new Error('503 from upstream');
    }),
    clock,
    system: 'incidents'
  });
  await assert.rejects(collector.collect(), (error: unknown) => {
    assert.ok(error instanceof RegistreError);
    assert.equal(error.code, 'UPSTREAM');
    assert.equal(error.detail.url, 'https://itsm.example/export');
    return true;
  });
});

test('sources: an injected fetcher is used for the HTTP source', async () => {
  const collector = new ItsmCollector({
    source: httpTextSource('https://itsm.example/export', async () => CSV_EXPORT),
    clock,
    system: 'incidents',
    since: '2026-10-01T00:00:00.000Z'
  });
  const [file] = await collector.collect();
  assert.match(new TextDecoder().decode(file?.bytes), /INC-1/);
});

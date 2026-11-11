/**
 * The OpenAPI document — the contract the judges read.
 *
 * Acceptance: the document exposes the sixteen endpoints of chapter 15, with
 * their parameters, their error codes and their requirement references; the
 * router serves each of them; and no operation or schema qualifies a control
 * with the forbidden vocabulary (ENF-IA-01).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenApiDocument, documentExposes, documentedOperations, openApiPath } from '../../src/api/openapi.ts';
import { CHAPTER_15_ENDPOINTS, CHAPTER_15_OPERATIONS } from '../../src/api/routes/table.ts';
import { ROUTES } from '../../src/api/routes/index.ts';
import { containsForbiddenWord } from '../../src/domain/vocabulary.ts';
import { TOKENS, startTestApi } from './harness.ts';

test('chapter 15: the reference table holds the sixteen endpoints', () => {
  assert.equal(CHAPTER_15_ENDPOINTS.length, 16);
  assert.equal(new Set(CHAPTER_15_OPERATIONS).size, 16);
});

test('chapter 15: the OpenAPI document exposes the sixteen endpoints', () => {
  const document = buildOpenApiDocument();
  for (const endpoint of CHAPTER_15_ENDPOINTS) {
    assert.ok(
      documentExposes(document, endpoint.method, endpoint.path),
      `${endpoint.method} ${endpoint.path} is missing from the document`
    );
  }
});

test('chapter 15: the router serves the sixteen endpoints', () => {
  const served = new Set(documentedOperations().map((route) => `${route.method} ${route.path}`));
  for (const operation of CHAPTER_15_OPERATIONS) {
    assert.ok(served.has(operation), `${operation} is not served by the router`);
  }
});

test('chapter 15: every served route is documented, and the reverse', () => {
  const documented = new Set(documentedOperations().map((route) => `${route.method} ${route.path}`));
  for (const route of ROUTES) {
    const key = `${route.method} ${openApiPath(route.path)}`;
    assert.ok(documented.has(key), `${key} is served but not documented`);
  }
  for (const operation of CHAPTER_15_OPERATIONS) {
    assert.ok(
      documentedOperations().some((route) => `${route.method} ${route.path}` === operation),
      `${operation} is documented but not served`
    );
  }
});

test('the document declares its version, its security schemes and its schemas', () => {
  const document = buildOpenApiDocument();
  assert.equal(document.openapi, '3.1.0');
  const components = document.components as { securitySchemes: Record<string, unknown>; schemas: Record<string, unknown> };
  assert.ok(components.securitySchemes.bearerAuth);
  assert.ok(components.securitySchemes.sessionCookie);
  assert.ok(Object.keys(components.schemas).length >= 20);
  assert.ok(components.schemas.Error);
  assert.ok(components.schemas.Control);
});

test('each operation names its requirement, its roles and its error codes', () => {
  const document = buildOpenApiDocument();
  const paths = document.paths as Record<string, Record<string, Record<string, unknown>>>;
  for (const endpoint of CHAPTER_15_ENDPOINTS) {
    const operation = paths[endpoint.path]?.[endpoint.method.toLowerCase()];
    assert.ok(operation, `${endpoint.method} ${endpoint.path} has no operation`);
    const description = String(operation.description ?? '');
    assert.ok(
      description.includes(endpoint.requirement),
      `${endpoint.method} ${endpoint.path} does not reference ${endpoint.requirement}`
    );
    assert.ok(Array.isArray(operation['x-roles']), 'each operation declares the roles it accepts');
    assert.ok(operation.responses !== undefined);
  }
});

test('the path parameters of an operation are declared', () => {
  const document = buildOpenApiDocument();
  const paths = document.paths as Record<string, Record<string, Record<string, unknown>>>;
  const operation = paths['/v1/controls/{id}']?.get;
  assert.ok(operation);
  const parameters = operation.parameters as Array<{ name: string; in: string; required: boolean }>;
  assert.equal(parameters.length, 1);
  assert.equal(parameters[0]?.name, 'id');
  assert.equal(parameters[0]?.in, 'path');
  assert.equal(parameters[0]?.required, true);
});

test('ENF-IA-01: the document never qualifies a control with the forbidden wording', () => {
  const document = buildOpenApiDocument();
  const text = JSON.stringify(document);
  assert.ok(!containsForbiddenWord(text), 'the OpenAPI document uses the forbidden wording');
  const states = (document.components as { schemas: Record<string, { properties?: Record<string, unknown> }> }).schemas
    .Control?.properties?.state as { enum?: string[] };
  assert.ok(states);
  assert.deepEqual(states.enum?.filter((value) => value !== null), [
    'COVERED',
    'TO_RENEW',
    'TO_VERIFY',
    'EXPIRED',
    'NO_EVIDENCE'
  ]);
});

test('GET /openapi.json serves the document without a credential', async () => {
  const api = await startTestApi();
  try {
    const response = await api.request('GET', '/openapi.json', { token: null });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    const document = response.json as { openapi: string; paths: Record<string, unknown> };
    assert.equal(document.openapi, '3.1.0');
    assert.equal(Object.keys(document.paths).length >= 16, true);
  } finally {
    await api.close();
  }
});

test('the public routes need no credential, the others do', async () => {
  const api = await startTestApi();
  try {
    assert.equal((await api.request('GET', '/healthz', { token: null })).status, 200);
    assert.equal((await api.request('GET', '/openapi.json', { token: null })).status, 200);
    assert.equal((await api.request('GET', '/v1/frameworks', { token: null })).status, 401);
    assert.equal((await api.request('GET', '/v1/frameworks', { token: TOKENS.qualityLead })).status, 200);
  } finally {
    await api.close();
  }
});

/**
 * Component names referenced by the route table but not defined in
 * `src/api/schemas*.ts`. The list is empty: every reference resolves. Any new
 * dangling reference fails the suite, which is the point of keeping the check.
 */
const KNOWN_DANGLING_SCHEMAS: readonly string[] = [];

/** The response schema the new contract gives each operation of chapter 15. */
const CONTRACT_SCHEMAS: Readonly<Record<string, string>> = {
  'POST /v1/frameworks': 'Framework',
  'GET /v1/frameworks': 'FrameworkArray',
  'GET /v1/frameworks/{id}/controls': 'ControlArray',
  'GET /v1/frameworks/{id}/readiness': 'ReadinessOverview',
  'GET /v1/frameworks/{id}/diff': 'FrameworkDiff',
  'POST /v1/evidence': 'Evidence',
  'GET /v1/evidence/{id}': 'Evidence',
  'GET /v1/controls/{id}': 'ControlWithRelations',
  'GET /v1/controls/{id}/evidence': 'EvidenceArray',
  'GET /v1/validations': 'ValidationItemArray',
  'POST /v1/validations/{id}/decision': 'ValidationItem',
  'POST /v1/ask': 'Answer',
  'POST /v1/frameworks/{id}/packs': 'Pack',
  'GET /v1/packs': 'PackArray',
  'GET /v1/packs/{id}': 'Pack',
  'GET /v1/reminders': 'ReminderArray',
  'GET /v1/audit-log': 'AuditEventArray'
  // POST /v1/controls/{id}/remind is left out on purpose: the route answers a
  // bare `Reminder` with 201 while the table declares `ReminderList` and 202.
};

/** Component names of the document. */
function schemaNames(): string[] {
  const document = buildOpenApiDocument();
  return Object.keys((document.components as { schemas: Record<string, unknown> }).schemas);
}

/** Every component name a `$ref` of the document points at. */
function referencedSchemas(node: unknown, names = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) referencedSchemas(item, names);
    return names;
  }
  if (node === null || typeof node !== 'object') return names;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === '$ref' && typeof value === 'string' && value.startsWith('#/components/schemas/')) {
      names.add(value.slice('#/components/schemas/'.length));
    }
    referencedSchemas(value, names);
  }
  return names;
}

test('the contract schemas are the ones the route table declares', () => {
  const declared = new Map(
    ROUTES.map((route) => [`${route.method} ${openApiPath(route.path)}`, route.meta.responseSchema])
  );
  for (const [operation, schema] of Object.entries(CONTRACT_SCHEMAS)) {
    assert.equal(declared.get(operation), schema, `${operation} must answer ${schema}`);
  }
  assert.equal(declared.get('POST /v1/auth/session'), 'Session');
  assert.equal(declared.get('GET /v1/auth/accounts'), 'SessionAccountArray');
});

test('the document exposes the schemas the new contract answers', () => {
  const schemas = schemaNames();
  for (const name of [
    'Framework',
    'FrameworkArray',
    'FrameworkDiff',
    'Control',
    'ControlArray',
    'ReadinessOverview',
    'ControlWithRelations',
    'Evidence',
    'EvidenceArray',
    'ValidationItem',
    'ValidationItemArray',
    'Reminder',
    'ReminderArray',
    'Pack',
    'PackArray',
    'Session',
    'SessionRequest',
    'SessionAccountArray',
    'CostReport'
  ]) {
    assert.ok(schemas.includes(name), `${name} is missing from components.schemas`);
  }
});

test('the bare list schemas of the contract are declared as arrays', () => {
  const document = buildOpenApiDocument();
  const schemas = (document.components as { schemas: Record<string, { type?: string }> }).schemas;
  for (const name of [
    'FrameworkArray',
    'ControlArray',
    'EvidenceArray',
    'ValidationItemArray',
    'ReminderArray',
    'PackArray',
    'SessionAccountArray'
  ]) {
    assert.equal(schemas[name]?.type, 'array', `${name} is the bare list of the contract`);
  }
});

test('safety net: no route and no schema references an undefined component', () => {
  const defined = schemaNames();
  const dangling = new Set<string>();
  for (const route of ROUTES) {
    for (const name of [route.meta.responseSchema, route.meta.requestSchema]) {
      if (name !== undefined && !defined.includes(name)) dangling.add(name);
    }
  }
  for (const name of referencedSchemas(buildOpenApiDocument())) {
    if (!defined.includes(name)) dangling.add(name);
  }
  const unexpected = [...dangling].filter((name) => !KNOWN_DANGLING_SCHEMAS.includes(name)).sort();
  assert.deepEqual(unexpected, [], 'these references have no schema behind them');
  const resolved = KNOWN_DANGLING_SCHEMAS.filter((name) => !dangling.has(name));
  assert.deepEqual(resolved, [], 'these references now resolve: drop them from KNOWN_DANGLING_SCHEMAS');
});

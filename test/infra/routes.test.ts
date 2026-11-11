/**
 * Drift guard between the application's route table and the API Gateway stack.
 *
 * The two live in separate TypeScript projects (ESM app, CommonJS infra), so the
 * gateway reads a generated manifest (`infra/routes.json`). This test rebuilds
 * the manifest from the live route table and fails when the committed file no
 * longer matches — which is what would otherwise let a deployed gateway 404 on a
 * route the application serves.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROUTES } from '../../src/api/routes/index.ts';
import {
  ROUTES_MANIFEST,
  buildManifest,
  renderManifest,
  toGatewayPath
} from '../../tools/quality/exportRoutes.ts';

test('infra/routes.json matches the routes the application serves', () => {
  const committed = readFileSync(join(process.cwd(), ROUTES_MANIFEST), 'utf8');
  assert.equal(committed, renderManifest(buildManifest()), `${ROUTES_MANIFEST} is out of date`);
});

test('every served route has a gateway path', () => {
  const manifest = buildManifest();
  const paths = new Set(manifest.routes.map((route) => route.path));
  for (const route of ROUTES) {
    assert.ok(paths.has(toGatewayPath(route.path)), `${route.path} is missing from the manifest`);
  }
});

test('every gateway path is served by the application', () => {
  const served = new Set(ROUTES.map((route) => toGatewayPath(route.path)));
  for (const route of buildManifest().routes) {
    assert.ok(served.has(route.path), `${route.path} is served by the gateway but not implemented`);
  }
});

test('a path is public only when every method on it is public', () => {
  const manifest = buildManifest();
  const publicPaths = new Set(manifest.routes.filter((route) => route.public).map((route) => route.path));
  for (const route of ROUTES) {
    const path = toGatewayPath(route.path);
    const isPublic = route.meta.roles === 'public';
    if (!isPublic) {
      assert.equal(publicPaths.has(path), false, `${path} must not be public: ${route.method} needs a credential`);
    }
  }
  assert.ok(publicPaths.has('/healthz'), 'the health probe must stay public');
  assert.ok(publicPaths.has('/openapi.json'), 'the contract must stay public');
});

test('no path uses the router syntax in the manifest', () => {
  for (const route of buildManifest().routes) {
    assert.ok(!route.path.includes(':'), `${route.path} still uses :param syntax`);
    assert.ok(route.methods.length > 0, `${route.path} declares no method`);
  }
});

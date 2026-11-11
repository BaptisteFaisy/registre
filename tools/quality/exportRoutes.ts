/**
 * Exports the served route table to `infra/routes.json`.
 *
 * Why a generated file: the API Gateway stack and the application are two
 * separate TypeScript projects (CommonJS vs ESM, different tsconfig), so the
 * stack cannot import the app's route table directly. Instead the app exports
 * it, the stack reads the JSON, and `test/infra/routes.test.ts` fails whenever
 * the committed file drifts from what the application actually serves.
 *
 * Usage:
 *   node tools/quality/exportRoutes.ts          # rewrite infra/routes.json
 *   node tools/quality/exportRoutes.ts --check  # fail when it is out of date
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROUTES } from '../../src/api/routes/index.ts';

/** Relative path of the generated manifest, from the repository root. */
export const ROUTES_MANIFEST = 'infra/routes.json';

export interface RouteManifestEntry {
  /** API Gateway path template, `{id}` style. */
  path: string;
  /** HTTP methods served on that path, sorted. */
  methods: string[];
  /** True when the route needs no credential (health, OpenAPI, session, share). */
  public: boolean;
}

export interface RouteManifest {
  generatedBy: string;
  routes: RouteManifestEntry[];
}

/** Turns a router path (`:id`) into an API Gateway path (`{id}`). */
export function toGatewayPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/** Builds the manifest from the live route table. */
export function buildManifest(): RouteManifest {
  const byPath = new Map<string, RouteManifestEntry>();
  for (const route of ROUTES) {
    const path = toGatewayPath(route.path);
    const entry = byPath.get(path) ?? { path, methods: [], public: route.meta.roles === 'public' };
    if (!entry.methods.includes(route.method)) entry.methods.push(route.method);
    // A path is public only when every method on it is public.
    entry.public = entry.public && route.meta.roles === 'public';
    byPath.set(path, entry);
  }
  const routes = [...byPath.values()]
    .map((entry) => ({ ...entry, methods: [...entry.methods].sort() }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return { generatedBy: 'tools/quality/exportRoutes.ts', routes };
}

/** Serialises the manifest exactly as it is committed. */
export function renderManifest(manifest: RouteManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function main(): number {
  const manifest = buildManifest();
  const rendered = renderManifest(manifest);
  const target = join(process.cwd(), ROUTES_MANIFEST);
  if (process.argv.includes('--check')) {
    let current = '';
    try {
      current = readFileSync(target, 'utf8');
    } catch {
      console.error(`::error::${ROUTES_MANIFEST} is missing - run: node tools/quality/exportRoutes.ts`);
      return 1;
    }
    if (current !== rendered) {
      console.error(`::error::${ROUTES_MANIFEST} is out of date - run: node tools/quality/exportRoutes.ts`);
      return 1;
    }
    console.log(`OK — ${manifest.routes.length} routes, ${ROUTES_MANIFEST} is up to date.`);
    return 0;
  }
  writeFileSync(target, rendered);
  console.log(`wrote ${ROUTES_MANIFEST} (${manifest.routes.length} routes)`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}

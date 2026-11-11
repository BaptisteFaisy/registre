/**
 * Service resolution: where the `Services` bundle comes from at runtime.
 *
 * The pilot owns `src/bootstrap.ts` (the composition root: mock or Bedrock
 * provider, storage adapters, clock). It is loaded lazily, by URL, so this
 * module compiles and runs whether or not that file exists yet: without it, the
 * offline demonstration bundle of `demoServices.ts` is used and the API still
 * answers.
 *
 * Resolution happens once per process (`servicesSingleton` caches its promise),
 * which is what the Lambda handlers need: a cold start builds the bundle, warm
 * invocations reuse it.
 */

import type { Services } from '../ports/index.ts';
import { createDemoServices } from './demoServices.ts';

/** The shape `src/bootstrap.ts` exposes. */
export interface BootstrapModule {
  /** Builds the bundle; it may return the bundle or a richer envelope. */
  createServices?: (options?: unknown) => Promise<unknown> | unknown;
  /** Alternative export name accepted for convenience. */
  default?: () => Promise<unknown> | unknown;
}

/** Where the bundle came from, for the startup log and `/healthz`. */
export type ServicesSource = 'bootstrap' | 'demo';

/** A resolved bundle and its provenance. */
export interface ResolvedServices {
  services: Services;
  source: ServicesSource;
}

/** URL of the pilot-owned bootstrap module. */
function bootstrapUrl(): string {
  return new URL('../bootstrap.ts', import.meta.url).href;
}

/** True when the value carries a `Services` bundle. */
function isServices(value: unknown): value is Services {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<Services>;
  return candidate.state !== undefined && candidate.audit !== undefined && candidate.clock !== undefined;
}

/** Unwraps the envelope of `src/bootstrap.ts` when it returns one. */
function unwrap(value: unknown): Services | null {
  if (isServices(value)) return value;
  if (value !== null && typeof value === 'object') {
    const envelope = value as { services?: unknown };
    if (isServices(envelope.services)) return envelope.services;
  }
  return null;
}

/** Loads `src/bootstrap.ts` when it exists and exposes a factory. */
async function fromBootstrap(): Promise<Services | null> {
  let module: BootstrapModule;
  try {
    module = (await import(bootstrapUrl())) as BootstrapModule;
  } catch {
    return null;
  }
  if (typeof module.createServices === 'function') return unwrap(await module.createServices());
  if (typeof module.default === 'function') return unwrap(await module.default());
  return null;
}

/** Resolves the bundle once: bootstrap first, offline demonstration otherwise. */
export async function resolveServices(env: NodeJS.ProcessEnv = process.env): Promise<ResolvedServices> {
  const bootstrapped = await fromBootstrap();
  if (bootstrapped !== null) return { services: bootstrapped, source: 'bootstrap' };
  return { services: createDemoServices({ env }), source: 'demo' };
}

/** Cached resolution, so a warm Lambda invocation rebuilds nothing. */
let cached: Promise<ResolvedServices> | null = null;

/** Resolves the bundle, memoised for the life of the process. */
export function servicesSingleton(env: NodeJS.ProcessEnv = process.env): Promise<ResolvedServices> {
  cached ??= resolveServices(env);
  return cached;
}

/** Drops the cache (tests, or a settings change that rebuilds adapters). */
export function resetServicesSingleton(): void {
  cached = null;
}

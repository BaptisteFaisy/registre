/**
 * Route table assembly. One file per domain (chapter 15), gathered here.
 */

import type { RouteDefinition } from '../types.ts';
import { healthRoutes } from './health.ts';
import { authRoutes } from './auth.ts';
import { docsRoutes } from './docs.ts';
import { frameworkRoutes } from './frameworks.ts';
import { evidenceRoutes } from './evidence.ts';
import { controlRoutes } from './controls.ts';
import { validationRoutes } from './validations.ts';
import { askRoutes } from './ask.ts';
import { packRoutes } from './packs.ts';
import { reminderRoutes } from './reminders.ts';
import { auditRoutes } from './audit.ts';
import { settingsRoutes } from './settings.ts';

/** Every served route, in declaration order. */
export const ROUTES: readonly RouteDefinition[] = [
  ...healthRoutes,
  ...authRoutes,
  ...docsRoutes,
  ...frameworkRoutes,
  ...evidenceRoutes,
  ...controlRoutes,
  ...validationRoutes,
  ...askRoutes,
  ...packRoutes,
  ...reminderRoutes,
  ...auditRoutes,
  ...settingsRoutes
];

/** One `METHOD path` line per route, for the startup log. */
export function describeRoutes(): string[] {
  return ROUTES.map((route) => {
    const roles = route.meta.roles === 'public' ? 'public' : route.meta.roles.join(',');
    return `${route.method.padEnd(6)} ${route.path.padEnd(34)} ${roles}`;
  });
}

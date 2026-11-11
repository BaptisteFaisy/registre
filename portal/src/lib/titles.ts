/* Human titles of each route, shown in the top bar. */

import type { Route } from './router.ts';

const TITLES: Record<Route['name'], string> = {
  readiness: 'Readiness',
  controls: 'Controls',
  control: 'Controls',
  evidence: 'Evidence',
  validation: 'Validation queue',
  ask: 'Ask the register',
  packs: 'Audit pack',
  verify: 'Verify and share',
  mappings: 'Cross-framework mappings',
  quality: 'Measured quality',
  reminders: 'Reminders',
  audit: 'Audit log',
  settings: 'Settings',
  'not-found': 'Not found'
};

export function routeTitle(route: Route): string {
  return TITLES[route.name];
}

/** Short, readable label of a MIME type (spreadsheets, PDF, CSV, image). */
export function shortContentType(contentType: string): string {
  if (contentType.includes('spreadsheet')) return 'spreadsheet';
  if (contentType === 'application/pdf') return 'PDF';
  if (contentType === 'text/csv') return 'CSV';
  if (contentType.startsWith('image/')) return contentType.replace('image/', 'image ').toUpperCase();
  if (contentType.startsWith('text/')) return contentType.replace('text/', 'text ').toUpperCase();
  return contentType;
}

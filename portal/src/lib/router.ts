/**
 * Home-made router: no dependency, URL driven with `history.pushState`.
 *
 * The portal is a single page application served by Vite (SPA fallback), so a
 * plain path is enough. `useSyncExternalStore` keeps React in sync with
 * `popstate` and with our own `navigate` calls.
 */

import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'readiness' }
  | { name: 'controls' }
  | { name: 'control'; controlId: string }
  | { name: 'evidence'; evidenceId: string }
  | { name: 'validation' }
  | { name: 'ask' }
  | { name: 'packs' }
  | { name: 'verify'; packId?: string }
  | { name: 'mappings' }
  | { name: 'quality' }
  | { name: 'reminders' }
  | { name: 'audit' }
  | { name: 'settings' }
  | { name: 'not-found'; path: string };

const listeners = new Set<() => void>();

/** Parses a pathname into a route; unknown paths fall back to `not-found`. */
export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/';
  const segments = path.split('/').filter(Boolean);
  const [head, second] = segments;

  if (!head) return { name: 'readiness' };
  if (head === 'readiness') return { name: 'readiness' };
  if (head === 'controls') {
    return second ? { name: 'control', controlId: second } : { name: 'controls' };
  }
  if (head === 'evidence' && second) return { name: 'evidence', evidenceId: second };
  if (head === 'validation') return { name: 'validation' };
  if (head === 'ask') return { name: 'ask' };
  if (head === 'packs') return { name: 'packs' };
  if (head === 'verify') return second ? { name: 'verify', packId: second } : { name: 'verify' };
  if (head === 'mappings') return { name: 'mappings' };
  if (head === 'quality') return { name: 'quality' };
  if (head === 'reminders') return { name: 'reminders' };
  if (head === 'audit') return { name: 'audit' };
  if (head === 'settings') return { name: 'settings' };
  return { name: 'not-found', path };
}

/** Builds the pathname of a route. */
export function routeToPath(route: Route): string {
  switch (route.name) {
    case 'readiness':
      return '/readiness';
    case 'controls':
      return '/controls';
    case 'control':
      return `/controls/${route.controlId}`;
    case 'evidence':
      return `/evidence/${route.evidenceId}`;
    case 'validation':
      return '/validation';
    case 'ask':
      return '/ask';
    case 'packs':
      return '/packs';
    case 'verify':
      return route.packId ? `/verify/${route.packId}` : '/verify';
    case 'mappings':
      return '/mappings';
    case 'quality':
      return '/quality';
    case 'reminders':
      return '/reminders';
    case 'audit':
      return '/audit';
    case 'settings':
      return '/settings';
    case 'not-found':
      return route.path;
  }
}

/** Subscribes to URL changes (used by `useSyncExternalStore`). */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

function snapshot(): string {
  return window.location.pathname;
}

/** Navigates to a path without reloading the page. */
export function navigate(path: string): void {
  if (path === window.location.pathname) return;
  window.history.pushState({}, '', path);
  for (const listener of listeners) listener();
}

/** Current route, kept in sync with the browser URL. */
export function useRoute(): Route {
  const path = useSyncExternalStore(subscribe, snapshot, () => '/');
  return parseRoute(path);
}

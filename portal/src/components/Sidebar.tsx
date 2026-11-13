/* Sidebar navigation, filtered by the capabilities of the signed-in role. */

import { BrandMark } from './BrandMark.tsx';
import { useApp } from '../state/app.tsx';
import { useApiData } from '../state/useData.ts';
import { can } from '../lib/access.ts';
import type { Capability } from '../lib/access.ts';
import { navigate } from '../lib/router.ts';
import type { Route } from '../lib/router.ts';

interface NavEntry {
  path: string;
  label: string;
  capability: Capability;
  group: string;
}

const NAV: NavEntry[] = [
  { path: '/readiness', label: 'Readiness', capability: 'readiness', group: 'Monitor' },
  { path: '/controls', label: 'Controls', capability: 'controls', group: 'Monitor' },
  { path: '/validation', label: 'Validation queue', capability: 'validation', group: 'Operate' },
  { path: '/ask', label: 'Ask', capability: 'ask', group: 'Operate' },
  { path: '/mappings', label: 'Mappings', capability: 'mappings', group: 'Operate' },
  { path: '/reminders', label: 'Reminders', capability: 'reminders', group: 'Operate' },
  { path: '/packs', label: 'Audit pack', capability: 'packs', group: 'Deliver' },
  { path: '/verify', label: 'Verify & share', capability: 'verify', group: 'Deliver' },
  { path: '/audit', label: 'Audit log', capability: 'audit', group: 'Deliver' },
  { path: '/quality', label: 'Measured quality', capability: 'quality', group: 'Admin' },
  { path: '/settings', label: 'Settings', capability: 'settings', group: 'Admin' }
];

const GROUPS = ['Monitor', 'Operate', 'Deliver', 'Admin'];

/** True when the current route belongs to the given navigation entry. */
function isActive(route: Route, path: string): boolean {
  if (path === '/controls') return route.name === 'controls' || route.name === 'control';
  if (path === '/readiness') return route.name === 'readiness';
  return `/${route.name}` === path;
}

export function Sidebar({ route }: { route: Route }) {
  const { principal } = useApp();
  const pending = useApiData((api) => api.listValidations('PENDING'));
  if (!principal) return null;
  const queueCount = (pending.data ?? []).length;

  return (
    <aside className="sidebar">
      <div className="brand">
        <BrandMark />
        <span>
          <span className="brand-name">Registre</span>
          <br />
          <span className="brand-sub">audit evidence register</span>
        </span>
      </div>
      <nav className="nav">
        {GROUPS.map((group) => (
          <NavGroup
            key={group}
            group={group}
            role={principal.role}
            route={route}
            queueCount={queueCount}
          />
        ))}
      </nav>
      <div className="sidebar-footer">
        Offline demonstration data
        <br />
        Track 1 — AWS MSP AI
      </div>
    </aside>
  );
}

function NavGroup({
  group,
  role,
  route,
  queueCount
}: {
  group: string;
  role: Parameters<typeof can>[0];
  route: Route;
  queueCount: number;
}) {
  const entries = NAV.filter((entry) => entry.group === group && can(role, entry.capability));
  if (entries.length === 0) return null;
  return (
    <div>
      <div className="nav-section">{group}</div>
      {entries.map((entry) => (
        <button
          key={entry.path}
          type="button"
          className={isActive(route, entry.path) ? 'nav-item active' : 'nav-item'}
          onClick={() => navigate(entry.path)}
        >
          <span>{entry.label}</span>
          {entry.capability === 'validation' && queueCount > 0 ? (
            <span className="nav-count">{queueCount}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

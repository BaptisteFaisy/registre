/* Application shell: sidebar, top bar and the route switch. */

import type { ReactNode } from 'react';
import { AppProvider, useApp } from './state/app.tsx';
import { useRoute, navigate } from './lib/router.ts';
import type { Route } from './lib/router.ts';
import { can } from './lib/access.ts';
import type { Capability } from './lib/access.ts';
import { ROLE_LABEL } from './lib/states.ts';
import { LoginScreen } from './screens/Login.tsx';
import { ReadinessScreen } from './screens/Readiness.tsx';
import { ControlsScreen } from './screens/Controls.tsx';
import { ControlDetailScreen } from './screens/ControlDetail.tsx';
import { EvidenceScreen } from './screens/Evidence.tsx';
import { ValidationScreen } from './screens/Validation.tsx';
import { AskScreen } from './screens/Ask.tsx';
import { PacksScreen } from './screens/Packs.tsx';
import { VerifyScreen } from './screens/Verify.tsx';
import { MappingsScreen } from './screens/Mappings.tsx';
import { QualityScreen } from './screens/Quality.tsx';
import { RemindersScreen } from './screens/Reminders.tsx';
import { AuditLogScreen } from './screens/AuditLog.tsx';
import { SettingsScreen } from './screens/Settings.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { Card, CardBody, CardHeader } from './components/Card.tsx';
import { routeTitle } from './lib/titles.ts';

/** Maps a route to the capability it requires. */
export function capabilityOf(route: Route): Capability {
  switch (route.name) {
    case 'controls':
    case 'control':
    case 'evidence':
      return 'controls';
    case 'validation':
      return 'validation';
    case 'ask':
      return 'ask';
    case 'packs':
      return 'packs';
    case 'verify':
      return 'verify';
    case 'mappings':
      return 'mappings';
    case 'quality':
      return 'quality';
    case 'reminders':
      return 'reminders';
    case 'audit':
      return 'audit';
    case 'settings':
      return 'settings';
    default:
      return 'readiness';
  }
}

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

function Shell() {
  const { principal } = useApp();
  if (!principal) return <LoginScreen />;
  return <Layout />;
}

function Layout() {
  const { principal, signOut } = useApp();
  const route = useRoute();
  if (!principal) return null;
  return (
    <div className="app">
      <Sidebar route={route} />
      <main className="main">
        <TopBar title={routeTitle(route)} name={principal.name} role={principal.role} onSignOut={signOut} />
        <div className="content">
          <Guarded route={route} />
        </div>
      </main>
    </div>
  );
}

function TopBar({
  title,
  name,
  role,
  onSignOut
}: {
  title: string;
  name: string;
  role: keyof typeof ROLE_LABEL;
  onSignOut: () => void;
}) {
  const initials = name
    .split(' ')
    .map((part) => part.charAt(0))
    .join('');
  return (
    <header className="topbar">
      <div className="topbar-titles">
        <span className="topbar-eyebrow">Northwind Managed Services</span>
        <span className="topbar-title">{title}</span>
      </div>
      <div className="topbar-spacer" />
      <div className="identity">
        <span className="avatar">{initials}</span>
        <span>
          <span className="identity-name">{name}</span>
          <br />
          <span className="identity-role">{ROLE_LABEL[role]}</span>
        </span>
      </div>
      <button type="button" className="btn btn-sm" onClick={onSignOut}>
        Sign out
      </button>
    </header>
  );
}

/** Renders the screen of the current route, or a role explanation. */
function Guarded({ route }: { route: Route }): ReactNode {
  const { principal } = useApp();
  if (!principal) return null;
  if (!can(principal.role, capabilityOf(route))) return <RoleNotice role={principal.role} />;
  switch (route.name) {
    case 'readiness':
      return <ReadinessScreen />;
    case 'controls':
      return <ControlsScreen />;
    case 'control':
      return <ControlDetailScreen controlId={route.controlId} />;
    case 'evidence':
      return <EvidenceScreen evidenceId={route.evidenceId} />;
    case 'validation':
      return <ValidationScreen />;
    case 'ask':
      return <AskScreen />;
    case 'packs':
      return <PacksScreen />;
    case 'verify':
      return <VerifyScreen packId={route.packId ?? null} />;
    case 'mappings':
      return <MappingsScreen />;
    case 'quality':
      return <QualityScreen />;
    case 'reminders':
      return <RemindersScreen />;
    case 'audit':
      return <AuditLogScreen />;
    case 'settings':
      return <SettingsScreen />;
    default:
      return <NotFound path={route.path} />;
  }
}

function RoleNotice({ role }: { role: keyof typeof ROLE_LABEL }) {
  return (
    <Card>
      <CardHeader title="Not available for this role" />
      <CardBody>
        <p className="muted">
          The {ROLE_LABEL[role]} role does not open this screen. Sign in with another demonstration
          account to see it — the same data sits behind every role, filtered by rights.
        </p>
      </CardBody>
    </Card>
  );
}

function NotFound({ path }: { path: string }) {
  return (
    <Card>
      <CardHeader title="Page not found" />
      <CardBody>
        <p className="muted">
          No screen at {path}. <button type="button" className="btn btn-sm" onClick={() => navigate('/readiness')}>Back to readiness</button>
        </p>
      </CardBody>
    </Card>
  );
}

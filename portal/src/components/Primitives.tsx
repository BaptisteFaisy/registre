/* Small presentational primitives shared by every screen. */

import type { ReactNode } from 'react';

/** Coloured pill used for states, classes and access levels. */
export function Badge({
  label,
  color,
  soft = false,
  dot = true
}: {
  label: string;
  color: string;
  soft?: boolean;
  dot?: boolean;
}) {
  return (
    <span
      className={soft ? 'badge badge-soft' : 'badge'}
      style={soft ? undefined : { color, background: `${color}1f` }}
    >
      {dot ? <span className="badge-dot" style={{ background: color }} /> : null}
      {label}
    </span>
  );
}

/** A plain, muted tag (domains, owners, technical values). */
export function Tag({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className="tag" title={title}>
      {children}
    </span>
  );
}

/** Small horizontal meter used for confidence values. */
export function Meter({ value, color }: { value: number; color: string }) {
  const width = `${Math.max(2, Math.min(100, Math.round(value * 100)))}%`;
  return (
    <span className="meter" title={`${Math.round(value * 100)} %`}>
      <span className="meter-fill" style={{ width, background: color }} />
    </span>
  );
}

/** Loading indicator with an optional label. */
export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="row faint small" style={{ padding: '18px 0' }}>
      <span className="spinner" />
      <span>{label}</span>
    </div>
  );
}

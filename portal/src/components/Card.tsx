/* Cards, statistics and key/value blocks. */

import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`.trim()}>{children}</section>;
}

export function CardHeader({
  title,
  subtitle,
  action
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="card-header">
      <div>
        <div className="card-title">{title}</div>
        {subtitle ? <div className="card-subtitle">{subtitle}</div> : null}
      </div>
      {action}
    </header>
  );
}

export function CardBody({ children, tight = false }: { children: ReactNode; tight?: boolean }) {
  return <div className={tight ? 'card-body tight' : 'card-body'}>{children}</div>;
}

export function CardFooter({ children }: { children: ReactNode }) {
  return <footer className="card-footer">{children}</footer>;
}

/** One headline number with its label and optional hint. */
export function Stat({
  value,
  label,
  hint,
  color
}: {
  value: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  color?: string;
}) {
  return (
    <div className="stat" style={color ? { borderTopColor: color } : undefined}>
      <div className="stat-value" style={color ? { color } : undefined}>
        {value}
      </div>
      <div className="stat-label">{label}</div>
      {hint ? <div className="stat-hint">{hint}</div> : null}
    </div>
  );
}

/** Definition list of label/value pairs. */
export function KeyValue({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="kv">
      {items.map((item) => (
        <div key={item.label} style={{ display: 'contents' }}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Notice({
  children,
  tone = 'warn'
}: {
  children: ReactNode;
  tone?: 'warn' | 'info';
}) {
  return <div className={tone === 'info' ? 'notice info' : 'notice'}>{children}</div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="notice" style={{ borderLeftColor: 'var(--bad)' }}>
      <span className="error-text">{message}</span>
      {onRetry ? (
        <button type="button" className="btn btn-sm" onClick={onRetry} style={{ marginLeft: 'auto' }}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

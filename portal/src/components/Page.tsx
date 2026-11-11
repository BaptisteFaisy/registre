/* Page header, breadcrumbs and citation blocks. */

import type { ReactNode } from 'react';

export function PageHeader({
  title,
  subtitle,
  actions,
  crumbs
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  crumbs?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        {crumbs}
        <h1>{title}</h1>
        {subtitle ? <div className="page-sub">{subtitle}</div> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}

export function Crumbs({ items }: { items: Array<{ label: string; onClick?: () => void }> }) {
  return (
    <nav className="crumbs">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`}>
          {item.onClick ? (
            <button type="button" onClick={item.onClick}>
              {item.label}
            </button>
          ) : (
            <span>{item.label}</span>
          )}
          {index < items.length - 1 ? <span> / </span> : null}
        </span>
      ))}
    </nav>
  );
}

/** Verbatim passage with its source, as an auditor expects to read it. */
export function Quote({
  text,
  meta
}: {
  text: string;
  meta?: string;
}) {
  return (
    <blockquote className="quote">
      “{text}”
      {meta ? <span className="quote-meta">{meta}</span> : null}
    </blockquote>
  );
}

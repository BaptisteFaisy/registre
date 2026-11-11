/* Form controls and the modal shell. */

import type { ChangeEvent, ReactNode } from 'react';

export function Button({
  children,
  onClick,
  variant = 'default',
  size = 'md',
  disabled = false,
  type = 'button',
  title
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'md' | 'sm';
  disabled?: boolean;
  type?: 'button' | 'submit';
  title?: string;
}) {
  const variantClass =
    variant === 'primary'
      ? 'btn btn-primary'
      : variant === 'danger'
        ? 'btn btn-danger'
        : variant === 'ghost'
          ? 'btn btn-ghost'
          : 'btn';
  return (
    <button
      type={type}
      title={title}
      className={size === 'sm' ? `${variantClass} btn-sm` : variantClass}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
  hint,
  grow = false
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  grow?: boolean;
}) {
  return (
    <div className={grow ? 'field grow' : 'field'}>
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="setting-help">{hint}</span> : null}
    </div>
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  ariaLabel
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <select
      className="select"
      aria-label={ariaLabel}
      value={value}
      onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value as T)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  type = 'text'
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
  type?: 'text' | 'password';
}) {
  return (
    <input
      className="input"
      type={type}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  ariaLabel
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
}) {
  return (
    <textarea
      className="textarea"
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function Modal({
  title,
  children,
  actions,
  onClose
}: {
  title: string;
  children: ReactNode;
  actions: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="card-header">
          <div className="card-title">{title}</div>
        </header>
        <div className="modal-body">{children}</div>
        <div className="modal-actions">{actions}</div>
      </div>
    </div>
  );
}

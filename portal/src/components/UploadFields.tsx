/* Fields of the deposit form, kept apart from its state. */

import type { AccessLevel, Control } from '../api/types.ts';
import { Field, Select } from './Form.tsx';
import { formatBytes } from '../lib/format.ts';
import { ACCESS_LABEL } from '../lib/states.ts';

export function FileField({
  file,
  onChange
}: {
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  return (
    <label className="field">
      <span className="label">Document</span>
      <input
        className="input"
        type="file"
        aria-label="Document to deposit"
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
      {file ? (
        <span className="setting-help">
          {file.name} · {formatBytes(file.size)}
        </span>
      ) : null}
    </label>
  );
}

export function ControlField({
  controls,
  value,
  onChange
}: {
  controls: readonly Control[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label="Suggested control" hint="Optional: the register decides the attachments.">
      <Select
        ariaLabel="Suggested control"
        value={value}
        onChange={onChange}
        options={controls.map((control) => ({
          value: control.id,
          label: `${control.id} — ${control.title}`
        }))}
      />
    </Field>
  );
}

export function AccessField({
  value,
  onChange
}: {
  value: AccessLevel;
  onChange: (value: AccessLevel) => void;
}) {
  return (
    <Field label="Access level" hint="Restricted documents are hidden from some roles.">
      <Select<AccessLevel>
        ariaLabel="Access level"
        value={value}
        onChange={onChange}
        options={(['INTERNAL', 'RESTRICTED', 'PUBLIC'] as AccessLevel[]).map((level) => ({
          value: level,
          label: ACCESS_LABEL[level]
        }))}
      />
    </Field>
  );
}

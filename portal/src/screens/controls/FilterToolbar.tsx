/* Filter toolbar and state counters of the controls list. */

import type { ControlStatus } from '../../api/types.ts';
import { Field, Select, TextInput } from '../../components/Form.tsx';
import { STATE_ORDER, stateColor, stateLabel } from '../../lib/states.ts';
import type { ControlFilters, StateFilter } from '../../state/useControlFilters.ts';

/** Counters of each state, in the canonical order. */
export function StateCounts({ statuses }: { statuses: readonly ControlStatus[] }) {
  return (
    <div className="row">
      {STATE_ORDER.map((state) => {
        const count = statuses.filter((status) => status.state === state).length;
        return (
          <span key={state} className="legend-item">
            <span className="dot" style={{ background: stateColor(state) }} />
            {stateLabel(state)} <span className="legend-value">{count}</span>
          </span>
        );
      })}
    </div>
  );
}

/** State, domain, owner and free-text filters. */
export function FilterToolbar({ filters }: { filters: ControlFilters }) {
  return (
    <div className="toolbar">
      <Field label="State">
        <Select<StateFilter>
          ariaLabel="Filter by state"
          value={filters.state}
          onChange={filters.setState}
          options={[
            { value: 'ALL', label: 'All states' },
            ...STATE_ORDER.map((state) => ({ value: state as StateFilter, label: stateLabel(state) }))
          ]}
        />
      </Field>
      <Field label="Domain">
        <Select
          ariaLabel="Filter by domain"
          value={filters.domain}
          onChange={filters.setDomain}
          options={[
            { value: 'ALL', label: 'All domains' },
            ...filters.domains.map((domain) => ({ value: domain, label: domain }))
          ]}
        />
      </Field>
      <Field label="Owner">
        <Select
          ariaLabel="Filter by owner"
          value={filters.owner}
          onChange={filters.setOwner}
          options={[
            { value: 'ALL', label: 'All owners' },
            ...filters.owners.map((owner) => ({ value: owner, label: owner }))
          ]}
        />
      </Field>
      <Field label="Search" grow>
        <TextInput
          ariaLabel="Search a control"
          value={filters.search}
          onChange={filters.setSearch}
          placeholder="Identifier, title or requirement"
        />
      </Field>
    </div>
  );
}

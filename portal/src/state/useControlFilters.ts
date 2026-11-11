/* Filtering state of the controls list, kept out of the screen component. */

import { useMemo, useState } from 'react';
import type { Control, ControlState } from '../api/types.ts';

export type StateFilter = 'ALL' | ControlState;

export interface ControlFilters {
  state: StateFilter;
  domain: string;
  owner: string;
  search: string;
  setState: (value: StateFilter) => void;
  setDomain: (value: string) => void;
  setOwner: (value: string) => void;
  setSearch: (value: string) => void;
  domains: string[];
  owners: string[];
  apply: (controls: readonly Control[], stateOf: (id: string) => ControlState | undefined) => Control[];
}

/** Filters the control list by state, domain, owner and free text. */
export function useControlFilters(controls: readonly Control[]): ControlFilters {
  const [state, setState] = useState<StateFilter>('ALL');
  const [domain, setDomain] = useState('ALL');
  const [owner, setOwner] = useState('ALL');
  const [search, setSearch] = useState('');

  const domains = useMemo(
    () => Array.from(new Set(controls.map((item) => item.domain))).sort(),
    [controls]
  );
  const owners = useMemo(
    () => Array.from(new Set(controls.map((item) => item.owner))).sort(),
    [controls]
  );

  const apply = useMemo(
    () => (list: readonly Control[], stateOf: (id: string) => ControlState | undefined) =>
      list.filter((control) => {
        if (state !== 'ALL' && stateOf(control.id) !== state) return false;
        if (domain !== 'ALL' && control.domain !== domain) return false;
        if (owner !== 'ALL' && control.owner !== owner) return false;
        const needle = search.trim().toLowerCase();
        if (!needle) return true;
        const haystack = `${control.id} ${control.title} ${control.requirement}`.toLowerCase();
        return haystack.includes(needle);
      }),
    [state, domain, owner, search]
  );

  return {
    state,
    domain,
    owner,
    search,
    setState,
    setDomain,
    setOwner,
    setSearch,
    domains,
    owners,
    apply
  };
}

/* Data loading and actions of the Verify & share screen (axis 1). */

import { useEffect, useState } from 'react';
import type { Pack, ShareGrant, ShareInput, VerificationResult } from '../../api/types.ts';
import { useApp } from '../../state/app.tsx';
import { useApiData } from '../../state/useData.ts';
import type { Loadable } from '../../state/useData.ts';
import { runAction } from '../../lib/hooks.ts';

export interface VerifyScreenState {
  packs: Loadable<Pack[]>;
  selectedId: string | null;
  selected: Pack | null;
  select: (packId: string) => void;
  verification: Loadable<VerificationResult | null>;
  shares: Loadable<ShareGrant[]>;
  createShare: (input: ShareInput) => Promise<string | null>;
  revoke: (token: string) => Promise<string | null>;
  busy: boolean;
}

/** Loads the packs, the verification of the selected one and the grants. */
export function useVerifyScreen(initialPackId: string | null): VerifyScreenState {
  const { api } = useApp();
  const packs = useApiData((client) => client.listPacks());
  const shares = useApiData((client) => client.listShares());
  const [selectedId, setSelectedId] = useState<string | null>(initialPackId);
  const [busy, setBusy] = useState(false);

  const list = packs.data ?? [];
  useEffect(() => {
    if (!selectedId && list[0]) setSelectedId(list[0].id);
  }, [list, selectedId]);

  const verification = useApiData(
    (client) => (selectedId ? client.verifyPack(selectedId) : Promise.resolve(null)),
    [selectedId]
  );

  const createShare = (input: ShareInput): Promise<string | null> =>
    selectedId
      ? runAction(() => api.createShare(selectedId, input), shares.reload, setBusy)
      : Promise.resolve('Select a pack first.');

  const revoke = (token: string): Promise<string | null> =>
    runAction(() => api.revokeShare(token), shares.reload, setBusy);

  return {
    packs,
    selectedId,
    selected: list.find((pack) => pack.id === selectedId) ?? null,
    select: setSelectedId,
    verification,
    shares,
    createShare,
    revoke,
    busy
  };
}

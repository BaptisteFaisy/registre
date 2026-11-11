/* Columns of the share table, one small builder per column. */

import type { ReactNode } from 'react';
import type { ShareGrant } from '../../api/types.ts';
import type { Column } from '../../components/DataTable.tsx';
import { Button } from '../../components/Form.tsx';
import { Badge } from '../../components/Primitives.tsx';
import { formatDate, formatRelative } from '../../lib/format.ts';
import { SHARE_STATE_META, shareState, shortToken } from '../../lib/verify.ts';

export interface ShareColumnContext {
  now: string;
  confirmToken: string | null;
  busy: boolean;
  onAskRevoke: (token: string | null) => void;
  onRevoke: (token: string) => Promise<void>;
}

function tokenColumn(): Column<ShareGrant> {
  return {
    key: 'token',
    label: 'Token',
    render: (share) => (
      <span className="mono small" title={share.token}>
        {shortToken(share.token)}
      </span>
    )
  };
}

function scopeColumn(): Column<ShareGrant> {
  return {
    key: 'scope',
    label: 'Scope',
    render: (share) => (
      <span>
        {share.scope === 'PACK' ? share.packId : share.frameworkId}
        <span className="cell-sub">{share.watermark}</span>
      </span>
    )
  };
}

function createdColumn(): Column<ShareGrant> {
  return {
    key: 'created',
    label: 'Opened',
    render: (share) => (
      <span>
        {formatDate(share.createdAt)}
        <span className="cell-sub">by {share.createdBy}</span>
      </span>
    )
  };
}

function expiryColumn(now: string): Column<ShareGrant> {
  return {
    key: 'expires',
    label: 'Expires',
    render: (share) => (
      <span>
        {formatDate(share.expiresAt)}
        <span className="cell-sub">{formatRelative(share.expiresAt, now)}</span>
      </span>
    )
  };
}

function usesColumn(): Column<ShareGrant> {
  return {
    key: 'uses',
    label: 'Uses',
    align: 'right',
    render: (share) => (
      <span title={share.lastUsedAt ? `Last use ${formatDate(share.lastUsedAt)}` : 'Never used'}>
        {share.useCount}
      </span>
    )
  };
}

function stateColumn(now: string): Column<ShareGrant> {
  return {
    key: 'state',
    label: 'State',
    render: (share) => {
      const meta = SHARE_STATE_META[shareState(share, now)];
      return <Badge label={meta.label} color={meta.color} />;
    }
  };
}

/** Two-step revocation: ask, then confirm — never a silent destructive click. */
function actionColumn(context: ShareColumnContext): Column<ShareGrant> {
  return {
    key: 'action',
    label: '',
    align: 'right',
    render: (share) => revokeCell(share, context)
  };
}

function revokeCell(share: ShareGrant, context: ShareColumnContext): ReactNode {
  if (shareState(share, context.now) !== 'ACTIVE') {
    return (
      <span className="faint small">
        {share.revokedBy ? `Revoked by ${share.revokedBy}` : 'Closed'}
      </span>
    );
  }
  if (context.confirmToken !== share.token) {
    return (
      <Button size="sm" disabled={context.busy} onClick={() => context.onAskRevoke(share.token)}>
        Revoke
      </Button>
    );
  }
  return (
    <span className="row">
      <Button
        size="sm"
        variant="danger"
        disabled={context.busy}
        onClick={() => context.onRevoke(share.token)}
      >
        Confirm revocation
      </Button>
      <Button size="sm" variant="ghost" onClick={() => context.onAskRevoke(null)}>
        Cancel
      </Button>
    </span>
  );
}

/** Assembles the seven columns of the grants table. */
export function shareColumns(context: ShareColumnContext): Array<Column<ShareGrant>> {
  return [
    tokenColumn(),
    scopeColumn(),
    createdColumn(),
    expiryColumn(context.now),
    usesColumn(),
    stateColumn(context.now),
    actionColumn(context)
  ];
}

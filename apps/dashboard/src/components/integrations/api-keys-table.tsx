import type { ApiKeyResource } from '@openverify/contracts';
import Link from 'next/link';
import { DataTable, type Column } from '../data-table';
import { LINK_CLASS } from '../link-styles';
import { EmptyValue } from '../masked-value';
import { Timestamp } from '../timestamp';
import { ApiKeyStateBadge, type ApiKeyBadgeState } from './badges';

/** An API key row with its state, computed from its expiry on the server. */
export interface ApiKeyRow {
  readonly key: ApiKeyResource;
  readonly state: ApiKeyBadgeState;
}

/** The key's state, and when it expires or expired. */
export function ApiKeyStatus({ row }: { readonly row: ApiKeyRow }) {
  const expiresAt = row.key.attributes['expires-at'];
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <ApiKeyStateBadge state={row.state} />
      {expiresAt !== null && <Timestamp value={expiresAt} />}
    </span>
  );
}

/** A key's token as it is known after creation: its prefix. */
export function TokenPrefix({ prefix }: { readonly prefix: string }) {
  return <code className="font-mono text-xs">{`${prefix}…`}</code>;
}

const scopeCount = (count: number) => (count === 1 ? '1 scope' : `${String(count)} scopes`);

/**
 * Whether the key sees personal data (C25.6): `Masked` for a key made by a role without
 * `pii:view` (Workflow 2B F001), `Visible` otherwise; unknown from an API older than 2E.
 */
export function PiiMasked({
  masked,
  explain = false,
}: {
  readonly masked: boolean | undefined;
  readonly explain?: boolean;
}) {
  if (masked === undefined) {
    return <EmptyValue />;
  }
  if (!masked) {
    return <>Visible</>;
  }
  return (
    <>
      {explain
        ? 'Masked: this key reads field values, notes, IP addresses and user agents as empty, and cannot download files.'
        : 'Masked'}
    </>
  );
}

const COLUMNS: readonly Column<ApiKeyRow>[] = [
  {
    id: 'name',
    header: 'Name',
    rowHeader: true,
    cell: ({ key }) => (
      <Link href={`/api-keys/${key.id}`} className={LINK_CLASS}>
        {key.attributes.name}
      </Link>
    ),
  },
  {
    id: 'token',
    header: 'Token',
    cell: ({ key }) => <TokenPrefix prefix={key.attributes['token-prefix']} />,
  },
  { id: 'scopes', header: 'Scopes', cell: ({ key }) => scopeCount(key.attributes.scopes.length) },
  { id: 'status', header: 'Status (UTC)', cell: (row) => <ApiKeyStatus row={row} /> },
  {
    id: 'pii',
    header: 'Personal data',
    cell: ({ key }) => <PiiMasked masked={key.attributes['pii-masked']} />,
  },
  {
    id: 'used',
    header: 'Last used (UTC)',
    cell: ({ key }) => {
      const used = key.attributes['last-used-at'];
      return used === null ? 'Never' : <Timestamp value={used} />;
    },
  },
  {
    id: 'created',
    header: 'Created (UTC)',
    cell: ({ key }) => <Timestamp value={key.attributes['created-at']} />,
  },
];

export function ApiKeysTable({ rows }: { readonly rows: readonly ApiKeyRow[] }) {
  return (
    <DataTable
      caption="API keys"
      captionHidden
      columns={COLUMNS}
      rows={rows}
      getRowKey={(row) => row.key.id}
      emptyMessage="No API keys on this page."
    />
  );
}

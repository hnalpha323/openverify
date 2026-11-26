import type { ShareTokenResource } from '@openverify/contracts';
import Link from 'next/link';
import { DataTable } from '../data-table';
import { LINK_CLASS } from '../link-styles';
import { Badge } from '../status-badge';
import { Timestamp } from '../timestamp';
import { shareTokenHref } from './connect-paths';
import {
  SHARE_SOURCE_TYPE_SINGULAR,
  SHARE_TOKEN_STATUS_TONES,
  SHARE_TOKEN_STATUS_WORDS,
  categoryList,
} from './connect-words';

export interface ShareTokensTableProps {
  readonly tokens: readonly ShareTokenResource[];
  readonly caption: string;
  readonly emptyMessage: string;
}

export { SHARE_TOKENS_PATH, shareTokenHref } from './connect-paths';

/** C242.2: share tokens with direction, source type, status, categories and expiry. */
export function ShareTokensTable({ tokens, caption, emptyMessage }: ShareTokensTableProps) {
  return (
    <DataTable
      caption={caption}
      rows={tokens}
      getRowKey={(row) => row.id}
      emptyMessage={emptyMessage}
      columns={[
        {
          id: 'token',
          header: 'Share token',
          rowHeader: true,
          cell: (row) => (
            <Link href={shareTokenHref(row.id)} className={`${LINK_CLASS} font-mono text-xs`}>
              {row.id}
            </Link>
          ),
        },
        {
          id: 'direction',
          header: 'Direction',
          cell: (row) => (row.attributes.direction === 'inbound' ? 'Inbound' : 'Outbound'),
        },
        {
          id: 'source',
          header: 'Source',
          cell: (row) => SHARE_SOURCE_TYPE_SINGULAR[row.attributes['source-type']],
        },
        {
          id: 'status',
          header: 'Status',
          cell: (row) => (
            <Badge
              status={row.attributes.status}
              label={SHARE_TOKEN_STATUS_WORDS[row.attributes.status]}
              tone={SHARE_TOKEN_STATUS_TONES[row.attributes.status]}
            />
          ),
        },
        {
          id: 'carries',
          header: 'Carries',
          cell: (row) => categoryList(row.attributes['data-categories']),
        },
        {
          id: 'expires',
          header: 'Expires (UTC)',
          cell: (row) => <Timestamp value={row.attributes['expires-at']} />,
        },
        {
          id: 'created',
          header: 'Created (UTC)',
          cell: (row) => <Timestamp value={row.attributes['created-at']} />,
        },
      ]}
    />
  );
}

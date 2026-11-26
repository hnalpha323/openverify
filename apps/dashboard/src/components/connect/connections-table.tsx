import type { ConnectionDirection, ConnectionResource } from '@openverify/contracts';
import Link from 'next/link';
import { DataTable } from '../data-table';
import { LINK_CLASS } from '../link-styles';
import { Badge } from '../status-badge';
import { Timestamp } from '../timestamp';
import { counterpartyOf, policyVersionWords } from './connection-summary';
import { connectionHref } from './connect-paths';
import { SampleLabel } from './sample-label';
import { CONNECTION_STATUS_TONES, CONNECTION_STATUS_WORDS } from './connect-words';

export interface ConnectionsTableProps {
  readonly connections: readonly ConnectionResource[];
  readonly caption: string;
  readonly emptyMessage: string;
}

const DIRECTION_SHORT: Readonly<Record<ConnectionDirection, string>> = {
  inbound: 'Inbound',
  outbound: 'Outbound',
  self: 'Self',
};

export { CONNECT_SETTINGS_PATH, connectionHref } from './connect-paths';

/** C242.1: connections with their counterparty, direction, status and policy version. */
export function ConnectionsTable({ connections, caption, emptyMessage }: ConnectionsTableProps) {
  return (
    <DataTable
      caption={caption}
      rows={connections}
      getRowKey={(row) => row.id}
      emptyMessage={emptyMessage}
      columns={[
        {
          id: 'counterparty',
          header: 'Counterparty',
          rowHeader: true,
          cell: (row) => {
            const { name, sample } = counterpartyOf(row);
            return (
              <>
                <Link href={connectionHref(row.id)} className={LINK_CLASS}>
                  {name}
                </Link>
                {sample && <SampleLabel />}
              </>
            );
          },
        },
        {
          id: 'direction',
          header: 'Direction',
          cell: (row) => DIRECTION_SHORT[row.attributes.direction],
        },
        {
          id: 'status',
          header: 'Status',
          cell: (row) => (
            <Badge
              status={row.attributes.status}
              label={CONNECTION_STATUS_WORDS[row.attributes.status]}
              tone={CONNECTION_STATUS_TONES[row.attributes.status]}
            />
          ),
        },
        { id: 'policy', header: 'Policy', cell: (row) => policyVersionWords(row) },
        {
          id: 'created',
          header: 'Created (UTC)',
          cell: (row) => <Timestamp value={row.attributes['created-at']} />,
        },
      ]}
    />
  );
}

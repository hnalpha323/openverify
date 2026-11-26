import type { ApiLogResource } from '@openverify/contracts';
import Link from 'next/link';
import { DataTable, type Column } from '../data-table';
import { listHref } from '../../lib/list-query';
import { LINK_CLASS } from '../link-styles';
import { EmptyValue } from '../masked-value';
import { Timestamp } from '../timestamp';
import { HttpStatusBadge } from './badges';

/**
 * Who made a request: the API key (a link to it for an operator with `api-keys:read`), the
 * dashboard user (a link to the requests made with their sessions, C25.9), or no one known (an
 * unauthenticated request).
 */
export function Caller({
  log,
  canSeeApiKeys,
}: {
  readonly log: ApiLogResource;
  readonly canSeeApiKeys: boolean;
}) {
  const key = log.attributes['api-key-id'];
  const user = log.attributes['user-id'];
  if (key !== null) {
    const code = <code className="font-mono text-xs">{key}</code>;
    return canSeeApiKeys ? (
      <Link href={`/api-keys/${key}`} className={LINK_CLASS}>
        {code}
      </Link>
    ) : (
      code
    );
  }
  return user === null ? (
    <EmptyValue />
  ) : (
    <Link href={listHref('/api-logs', { 'user-id': user })} className={LINK_CLASS}>
      <code className="font-mono text-xs">{user}</code>
    </Link>
  );
}

function columns(canSeeApiKeys: boolean): readonly Column<ApiLogResource>[] {
  return [
    {
      id: 'time',
      header: 'Time (UTC)',
      rowHeader: true,
      cell: (log) => (
        <Link href={`/api-logs/${log.id}`} className={LINK_CLASS}>
          <Timestamp value={log.attributes['created-at']} />
        </Link>
      ),
    },
    {
      id: 'method',
      header: 'Method',
      cell: (log) => <code className="font-mono text-xs">{log.attributes.method}</code>,
    },
    {
      id: 'path',
      header: 'Path',
      cell: (log) => <code className="font-mono text-xs break-all">{log.attributes.path}</code>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (log) => <HttpStatusBadge status={log.attributes.status} />,
    },
    {
      id: 'duration',
      header: 'Duration',
      cell: (log) => `${String(log.attributes['duration-ms'])} ms`,
    },
    {
      id: 'caller',
      header: 'Caller',
      cell: (log) => <Caller log={log} canSeeApiKeys={canSeeApiKeys} />,
    },
  ];
}

export interface ApiLogsTableProps {
  readonly logs: readonly ApiLogResource[];
  readonly canSeeApiKeys: boolean;
  readonly emptyMessage: string;
}

export function ApiLogsTable({ logs, canSeeApiKeys, emptyMessage }: ApiLogsTableProps) {
  return (
    <DataTable
      caption="API logs"
      captionHidden
      columns={columns(canSeeApiKeys)}
      rows={logs}
      getRowKey={(log) => log.id}
      emptyMessage={emptyMessage}
    />
  );
}

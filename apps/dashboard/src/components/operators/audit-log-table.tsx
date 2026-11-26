import type { UserAuditLogResource } from '@openverify/contracts';
import Link from 'next/link';
import { DataTable } from '../data-table';
import { LINK_CLASS } from '../link-styles';
import { EmptyValue, MaskedValue } from '../masked-value';
import { Timestamp } from '../timestamp';
import { AuditActorValue, type OperatorDirectory } from './audit-actor';

export interface AuditLogTableProps {
  readonly entries: readonly UserAuditLogResource[];
  readonly directory: OperatorDirectory | null;
  /** Without `pii:view` the API masks client addresses: null means "Hidden". */
  readonly masked: boolean;
  readonly emptyMessage: string;
  /** The table's name; "Audit log entries" by default. */
  readonly caption?: string;
}

/** Audit log entries, newest first, each linked to its detail. */
export function AuditLogTable({
  entries,
  directory,
  masked,
  emptyMessage,
  caption = 'Audit log entries',
}: AuditLogTableProps) {
  return (
    <DataTable
      caption={caption}
      captionHidden
      rows={entries}
      getRowKey={(entry) => entry.id}
      emptyMessage={emptyMessage}
      columns={[
        {
          id: 'when',
          header: 'When (UTC)',
          rowHeader: true,
          cell: (entry) => (
            <Link href={`/audit-logs/${entry.id}`} className={LINK_CLASS}>
              <Timestamp value={entry.attributes['created-at']} />
            </Link>
          ),
        },
        {
          id: 'action',
          header: 'Action',
          cell: (entry) => <code className="font-mono text-xs">{entry.attributes.action}</code>,
        },
        {
          id: 'actor',
          header: 'Actor',
          cell: (entry) => (
            <AuditActorValue actor={entry.attributes.actor} directory={directory} compact />
          ),
        },
        {
          id: 'resource',
          header: 'Resource',
          cell: ({ attributes }) =>
            attributes['resource-id'] === null ? (
              (attributes['resource-type'] ?? <EmptyValue />)
            ) : (
              <span className="flex flex-col">
                <span>{attributes['resource-type']}</span>
                <code className="font-mono text-xs text-ink-muted">
                  {attributes['resource-id']}
                </code>
              </span>
            ),
        },
        {
          id: 'address',
          header: 'IP address',
          cell: (entry) => <MaskedValue value={entry.attributes['ip-address']} masked={masked} />,
        },
      ]}
    />
  );
}

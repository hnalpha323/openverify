import type { InquiryStatus } from '@openverify/core';
import Link from 'next/link';
import { DataTable, type Column } from './data-table';
import { TagList } from './lifecycle/tag-list';
import { LINK_CLASS } from './link-styles';
import { EmptyValue } from './masked-value';
import { InquiryStatusBadge } from './status-badge';
import { Timestamp } from './timestamp';

/** One row of an inquiries list. */
export interface InquirySummary {
  readonly id: string;
  readonly referenceId: string | null;
  readonly status: InquiryStatus;
  readonly tags: readonly string[];
  /** Null only for inquiries created before accounts existed. */
  readonly accountId: string | null;
  /** ISO 8601 timestamp. */
  readonly createdAt: string;
}

export interface InquiriesTableProps {
  readonly inquiries: readonly InquirySummary[];
  /** Link each account to its page (the operator holds `accounts:read`). */
  readonly linkAccounts?: boolean;
  readonly caption?: string;
  readonly emptyMessage?: string;
}

function columns(linkAccounts: boolean): readonly Column<InquirySummary>[] {
  return [
    {
      id: 'id',
      header: 'Inquiry ID',
      rowHeader: true,
      cell: (inquiry) => (
        <Link href={`/inquiries/${inquiry.id}`} className={LINK_CLASS}>
          <code className="font-mono text-xs">{inquiry.id}</code>
        </Link>
      ),
    },
    {
      id: 'reference',
      header: 'Reference ID',
      cell: (inquiry) => inquiry.referenceId ?? <EmptyValue />,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (inquiry) => <InquiryStatusBadge status={inquiry.status} />,
    },
    {
      id: 'tags',
      header: 'Tags',
      cell: (inquiry) => <TagList tags={inquiry.tags} />,
    },
    {
      id: 'account',
      header: 'Account',
      cell: ({ accountId }) => {
        if (accountId === null) {
          return <EmptyValue />;
        }
        const id = <code className="font-mono text-xs">{accountId}</code>;
        return linkAccounts ? (
          <Link href={`/accounts/${accountId}`} className={LINK_CLASS}>
            {id}
          </Link>
        ) : (
          id
        );
      },
    },
    {
      id: 'created',
      header: 'Created (UTC)',
      cell: (inquiry) => <Timestamp value={inquiry.createdAt} />,
    },
  ];
}

export function InquiriesTable({
  inquiries,
  linkAccounts = false,
  caption = 'Inquiries',
  emptyMessage = 'No inquiries match.',
}: InquiriesTableProps) {
  return (
    <DataTable
      caption={caption}
      captionHidden
      columns={columns(linkAccounts)}
      rows={inquiries}
      getRowKey={(inquiry) => inquiry.id}
      emptyMessage={emptyMessage}
    />
  );
}

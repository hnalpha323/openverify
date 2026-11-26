import type { InquiryTemplateVersionStatus } from '@openverify/contracts';
import Link from 'next/link';
import { DataTable } from '../data-table';
import { LINK_CLASS } from '../link-styles';
import { EmptyValue } from '../masked-value';
import { Timestamp } from '../timestamp';
import { VersionStatusBadge } from './badges';

/** One version of a transaction type or a graph query template. */
export interface VersionRow {
  readonly id: string;
  readonly href: string;
  readonly versionNumber: number;
  readonly status: InquiryTemplateVersionStatus;
  readonly createdAt: string;
  readonly publishedAt: string | null;
}

/** The versions of one type or template as the API listed them, newest first (K7B-3). */
export function VersionsTable({ rows }: { readonly rows: readonly VersionRow[] }) {
  return (
    <DataTable
      caption="Versions"
      captionHidden
      columns={[
        {
          id: 'version',
          header: 'Version',
          rowHeader: true,
          cell: (row) => (
            <Link href={row.href} className={LINK_CLASS}>
              Version {String(row.versionNumber)}
            </Link>
          ),
        },
        {
          id: 'status',
          header: 'Status',
          cell: (row) => <VersionStatusBadge status={row.status} />,
        },
        {
          id: 'created',
          header: 'Created (UTC)',
          cell: (row) => <Timestamp value={row.createdAt} />,
        },
        {
          id: 'published',
          header: 'Published (UTC)',
          cell: (row) =>
            row.publishedAt === null ? <EmptyValue /> : <Timestamp value={row.publishedAt} />,
        },
      ]}
      rows={rows}
      getRowKey={(row) => row.id}
      emptyMessage="No more versions."
    />
  );
}

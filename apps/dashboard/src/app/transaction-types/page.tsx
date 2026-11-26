import type { Metadata } from 'next';
import Link from 'next/link';
import { DataTable } from '../../components/data-table';
import { EmptyState } from '../../components/empty-state';
import { LINK_CLASS } from '../../components/link-styles';
import { PageHeader } from '../../components/page-header';
import { PageMain } from '../../components/page-main';
import { Pagination } from '../../components/pagination';
import { Timestamp } from '../../components/timestamp';
import { CreateTypeForm } from '../../components/transaction-types/type-forms';
import { hasPermission } from '../../lib/api/me';
import { renderPage } from '../../lib/api/page';
import { TRANSACTIONS_PAGE_SIZE, listTransactionTypes } from '../../lib/api/transactions';
import { cursorFromNextLink, parseCursor } from '../../lib/list-query';
import { createTransactionType } from './actions';

export const metadata: Metadata = { title: 'Transaction types' };

export interface TransactionTypesPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const version = (number: number | null) =>
  number === null ? 'Not published yet' : `v${String(number)}`;

/**
 * The transaction types (C104, C108): each with its status and its latest and published version
 * numbers, and creation with `transaction-types:write`. Reads `GET /transaction-types` with
 * `transactions:read`.
 */
export default async function TransactionTypesPage({ searchParams }: TransactionTypesPageProps) {
  const after = parseCursor((await searchParams).after, 'txntp');
  return renderPage({ permissions: ['transactions:read'] }, async ({ session }) => {
    const page = await listTransactionTypes(TRANSACTIONS_PAGE_SIZE, after);
    return (
      <PageMain>
        <PageHeader
          title="Transaction types"
          description="What a transaction of each type records: its fields, statuses and relations, in immutable versions. Each transaction keeps the version it was created under."
        />
        {hasPermission(session, 'transaction-types:write') && (
          <CreateTypeForm environmentId={session.environment.id} action={createTransactionType} />
        )}
        {page.data.length === 0 && after === undefined ? (
          <EmptyState title="No transaction types yet">
            A transaction type is needed before your backend can record transactions.
          </EmptyState>
        ) : (
          <DataTable
            caption="Transaction types"
            captionHidden
            rows={page.data}
            getRowKey={(type) => type.id}
            emptyMessage="No more transaction types."
            columns={[
              {
                id: 'name',
                header: 'Name',
                rowHeader: true,
                cell: (type) => (
                  <Link href={`/transaction-types/${type.id}`} className={LINK_CLASS}>
                    {type.attributes.name}
                  </Link>
                ),
              },
              {
                id: 'status',
                header: 'Status',
                cell: (type) => (type.attributes.status === 'active' ? 'Active' : 'Archived'),
              },
              {
                id: 'latest',
                header: 'Latest version',
                cell: (type) => version(type.attributes['latest-version']),
              },
              {
                id: 'published',
                header: 'Published version',
                cell: (type) => version(type.attributes['published-version']),
              },
              {
                id: 'created',
                header: 'Created (UTC)',
                cell: (type) => <Timestamp value={type.attributes['created-at']} />,
              },
            ]}
          />
        )}
        <Pagination
          path="/transaction-types"
          query={{}}
          after={after}
          nextCursor={cursorFromNextLink(page.links.next, 'txntp')}
        />
      </PageMain>
    );
  });
}

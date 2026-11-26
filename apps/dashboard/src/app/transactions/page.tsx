import { Alert } from '@openverify/ui';
import type { Metadata } from 'next';
import { EmptyState } from '../../components/empty-state';
import { PageHeader } from '../../components/page-header';
import { PageMain } from '../../components/page-main';
import { Pagination } from '../../components/pagination';
import { TransactionFilters } from '../../components/transactions/transaction-filters';
import {
  hasTransactionFilters,
  parseTransactionQuery,
  transactionFilterQuery,
} from '../../components/transactions/transaction-query';
import { TransactionsTable } from '../../components/transactions/transactions-table';
import { hasPermission } from '../../lib/api/me';
import { renderPage } from '../../lib/api/page';
import {
  TRANSACTION_TYPE_CHOICES,
  listTransactionTypes,
  listTransactions,
} from '../../lib/api/transactions';
import { cursorFromNextLink } from '../../lib/list-query';
import { SavedViewsSlot } from '../../components/saved-views/saved-views-slot';

export const metadata: Metadata = { title: 'Transactions' };

export interface TransactionsPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The session environment's transactions (C105, C108), newest first, filtered by type, status,
 * reference and creation date in the URL (C23), with cursor paging. No field value is listed. Reads
 * `GET /transactions` and the types for the filter (`GET /transaction-types`), with
 * `transactions:read`.
 */
export default async function TransactionsPage({ searchParams }: TransactionsPageProps) {
  const query = parseTransactionQuery(await searchParams);
  return renderPage({ permissions: ['transactions:read'] }, async ({ session }) => {
    const types = await listTransactionTypes(TRANSACTION_TYPE_CHOICES);
    const header = (
      <PageHeader
        title="Transactions"
        description="Events your backend records about accounts and inquiries, newest first. A transaction’s fields are personal data, shown on its page only to operators with pii:view."
      />
    );
    const filters = (
      <TransactionFilters
        query={query}
        types={types.data}
        canFilterStrings={hasPermission(session, 'pii:view')}
      />
    );
    if (Object.keys(query.errors).length > 0) {
      return (
        <PageMain>
          {header}
          {filters}
          <Alert tone="warning" title="Check the filters">
            Some values cannot be used. Correct them to see the transactions.
          </Alert>
        </PageMain>
      );
    }
    const page = await listTransactions(query.filters, query.after);
    const filtered = hasTransactionFilters(query.filters);
    return (
      <PageMain>
        {header}
        {filters}
        <SavedViewsSlot list="transactions" />
        {page.data.length === 0 && !filtered && query.after === undefined ? (
          <EmptyState title="No transactions yet">
            Transactions appear here once your backend creates them with the API.
          </EmptyState>
        ) : (
          <TransactionsTable
            caption="Transactions"
            transactions={page.data}
            typeNames={new Map(types.data.map((type) => [type.id, type.attributes.name]))}
            emptyMessage={
              filtered ? 'No transactions match these filters.' : 'No more transactions.'
            }
          />
        )}
        <Pagination
          path="/transactions"
          query={transactionFilterQuery(query.values)}
          after={query.after}
          nextCursor={cursorFromNextLink(page.links.next, 'txn')}
        />
      </PageMain>
    );
  });
}

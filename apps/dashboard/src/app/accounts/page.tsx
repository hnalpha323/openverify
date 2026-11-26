import { Alert } from '@openverify/ui';
import type { Metadata } from 'next';
import { EmptyState } from '../../components/empty-state';
import { AccountFilters } from '../../components/lifecycle/account-filters';
import {
  accountFilterQuery,
  accountListFilter,
  hasAccountFilters,
  parseAccountListQuery,
} from '../../components/lifecycle/account-query';
import { AccountsTable } from '../../components/lifecycle/accounts-table';
import { PageHeader } from '../../components/page-header';
import { PageMain } from '../../components/page-main';
import { Pagination } from '../../components/pagination';
import { renderPage } from '../../lib/api/page';
import { cursorFromNextLink } from '../../lib/list-query';
import { SavedViewsSlot } from '../../components/saved-views/saved-views-slot';

export const metadata: Metadata = { title: 'Accounts' };

const PAGE_SIZE = 25;
/** Account types listed for the type filter and the type column. */
const TYPE_PAGE_SIZE = 100;

export interface AccountsPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** The environment's accounts (C13, C23), newest first, filtered in the URL, cursor paged. */
export default async function AccountsPage({ searchParams }: AccountsPageProps) {
  const query = parseAccountListQuery(await searchParams);
  return renderPage({ permissions: ['accounts:read'] }, async ({ api }) => {
    const invalid = Object.keys(query.errors).length > 0;
    const [types, page] = await Promise.all([
      api.accountTypes.list({ page: { size: TYPE_PAGE_SIZE } }),
      invalid
        ? null
        : api.accounts.list({
            filter: accountListFilter(query.filters),
            page: { size: PAGE_SIZE, ...(query.after === undefined ? {} : { after: query.after }) },
          }),
    ]);
    const typeNames = new Map(types.data.map((type) => [type.id, type.attributes.name]));
    const filtered = hasAccountFilters(query.filters);

    return (
      <PageMain>
        <PageHeader
          title="Accounts"
          description="The people and businesses behind your inquiries, newest first."
        />
        <AccountFilters
          selected={query.selected}
          values={query.values}
          errors={query.errors}
          accountTypes={types.data}
        />
        <SavedViewsSlot list="accounts" />
        {page === null ? (
          <Alert tone="warning" title="Check the filters">
            Some values cannot be used. Correct them to see the accounts.
          </Alert>
        ) : (
          <>
            {page.data.length === 0 && !filtered && query.after === undefined ? (
              <EmptyState title="No accounts yet">
                Every inquiry belongs to an account; accounts appear here as inquiries are created.
              </EmptyState>
            ) : (
              <AccountsTable
                accounts={page.data}
                typeNames={typeNames}
                emptyMessage={filtered ? 'No accounts match these filters.' : 'No more accounts.'}
              />
            )}
            <Pagination
              path="/accounts"
              query={accountFilterQuery(query.filters)}
              after={query.after}
              nextCursor={cursorFromNextLink(page.links.next, 'acc')}
            />
          </>
        )}
      </PageMain>
    );
  });
}

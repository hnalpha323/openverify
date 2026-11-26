import { listKindSchema, listStatusSchema } from '@openverify/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '../../components/empty-state';
import { PRIMARY_LINK_BUTTON } from '../../components/integrations/link-button';
import { ListFilters } from '../../components/lists/list-filters';
import { ListsTable } from '../../components/lists/lists-table';
import { PageHeader } from '../../components/page-header';
import { PageMain } from '../../components/page-main';
import { Pagination } from '../../components/pagination';
import { listLists } from '../../lib/api/lists';
import { hasPermission } from '../../lib/api/me';
import { renderPage } from '../../lib/api/page';
import { cursorFromNextLink, parseCursor } from '../../lib/list-query';

export const metadata: Metadata = { title: 'Lists' };

export interface ListsPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The session environment's lists (C97, C108), newest first, filtered by type (the singular
 * kind, as `filter[type]` takes it) and status in the URL (C23), with cursor paging. A filter value
 * the API would refuse is left out. Reads `GET /lists` with `lists:read`.
 */
export default async function ListsPage({ searchParams }: ListsPageProps) {
  const params = await searchParams;
  const type = listKindSchema.safeParse(params.type).data;
  const status = listStatusSchema.safeParse(params.status).data;
  const after = parseCursor(params.after, 'lst');
  return renderPage({ permissions: ['lists:read'] }, async ({ session }) => {
    const page = await listLists({ type, status }, after);
    const filtered = type !== undefined || status !== undefined;
    return (
      <PageMain>
        <PageHeader
          title="Lists"
          description="Your own lists of values to screen inquiries against. A list says what it matched only for what it screened."
          actions={
            hasPermission(session, 'lists:write') ? (
              <Link href="/lists/new" className={PRIMARY_LINK_BUTTON}>
                Create list
              </Link>
            ) : undefined
          }
        />
        <ListFilters type={type} status={status} />
        {page.data.length === 0 && !filtered && after === undefined ? (
          <EmptyState title="No lists yet">
            Lists appear here once you create one here or your backend creates one with the API.
          </EmptyState>
        ) : (
          <ListsTable
            lists={page.data}
            emptyMessage={filtered ? 'No lists match these filters.' : 'No more lists.'}
          />
        )}
        <Pagination
          path="/lists"
          query={{ type, status }}
          after={after}
          nextCursor={cursorFromNextLink(page.links.next, 'lst')}
        />
      </PageMain>
    );
  });
}

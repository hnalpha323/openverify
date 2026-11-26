import { GRAPH_QUERY_STATUSES, type GraphQueryResource } from '@openverify/contracts';
import type { GraphQueryStatus } from '@openverify/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { DataTable } from '../../components/data-table';
import { EmptyState } from '../../components/empty-state';
import { GraphQueryStatusBadge } from '../../components/graph/graph-result-summary';
import { GRAPH_STATUS_WORDS } from '../../components/graph/graph-words';
import { SECONDARY_LINK_BUTTON } from '../../components/integrations/link-button';
import { LINK_CLASS } from '../../components/link-styles';
import { PageHeader } from '../../components/page-header';
import { PageMain } from '../../components/page-main';
import { Pagination } from '../../components/pagination';
import { Timestamp } from '../../components/timestamp';
import { renderPage } from '../../lib/api/page';
import { cursorFromNextLink, parseCursor } from '../../lib/list-query';

export const metadata: Metadata = { title: 'Graph' };

export interface GraphPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const PAGE_SIZE = 25;
const STATUSES: ReadonlySet<string> = new Set(GRAPH_QUERY_STATUSES);

const statusOf = (value: unknown): GraphQueryStatus | undefined =>
  typeof value === 'string' && STATUSES.has(value) ? (value as GraphQueryStatus) : undefined;

const countOf = (query: GraphQueryResource, accounts: boolean) =>
  query.attributes.nodes.filter((node) => (node.type === 'account') === accounts).length;

/**
 * The graph queries of the session's environment (C102.4, C108), newest first with a cursor, and
 * a status filter kept in the URL. Each row says its status and whether the index was complete
 * for it, in words; opening one shows the explorer. Reads `GET /graph-queries` with `graph:read`,
 * which viewers never hold.
 */
export default async function GraphPage({ searchParams }: GraphPageProps): Promise<ReactNode> {
  const params = await searchParams;
  const status = statusOf(params.status);
  const after = parseCursor(params.after, 'grphq');
  return renderPage({ permissions: ['graph:read'] }, async ({ api }) => {
    const page = await api.graphQueries.list({
      ...(status === undefined ? {} : { filter: { status: [status] } }),
      page: { size: PAGE_SIZE, ...(after === undefined ? {} : { after }) },
    });
    return (
      <PageMain>
        <PageHeader
          title="Graph"
          description="Queries over the account graph, newest first. A link between accounts is a lead for a reviewer, never a decision."
          actions={
            <Link href="/graph/templates" className={SECONDARY_LINK_BUTTON}>
              Query templates
            </Link>
          }
        />
        <form method="get" action="/graph" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
            Status
            <select
              name="status"
              defaultValue={status ?? ''}
              className="min-h-11 rounded-md border border-control bg-surface px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <option value="">Any status</option>
              {GRAPH_QUERY_STATUSES.map((each) => (
                <option key={each} value={each}>
                  {GRAPH_STATUS_WORDS[each].label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={SECONDARY_LINK_BUTTON}>
            Filter
          </button>
        </form>
        {page.data.length === 0 && status === undefined && after === undefined ? (
          <EmptyState title="No graph queries yet">
            Queries appear here once your backend runs one with the API, or you run one from a query
            template.
          </EmptyState>
        ) : (
          <DataTable
            caption="Graph queries"
            columns={[
              {
                id: 'query',
                header: 'Query',
                rowHeader: true,
                cell: (query) => (
                  <Link href={`/graph/${query.id}`} className={`${LINK_CLASS} font-mono text-xs`}>
                    {query.id}
                  </Link>
                ),
              },
              {
                id: 'status',
                header: 'Status',
                cell: (query) => <GraphQueryStatusBadge status={query.attributes.status} />,
              },
              { id: 'accounts', header: 'Accounts', cell: (query) => countOf(query, true) },
              { id: 'values', header: 'Shared values', cell: (query) => countOf(query, false) },
              {
                id: 'index',
                header: 'Index',
                cell: (query) =>
                  query.attributes['index-complete'] ? 'Complete' : 'Still being built',
              },
              {
                id: 'created',
                header: 'Created (UTC)',
                cell: (query) => <Timestamp value={query.attributes['created-at']} />,
              },
            ]}
            rows={page.data}
            getRowKey={(query) => query.id}
            emptyMessage={
              status === undefined ? 'No more queries.' : 'No queries match this status.'
            }
          />
        )}
        <Pagination
          path="/graph"
          query={status === undefined ? {} : { status }}
          after={after}
          nextCursor={cursorFromNextLink(page.links.next, 'grphq')}
        />
      </PageMain>
    );
  });
}

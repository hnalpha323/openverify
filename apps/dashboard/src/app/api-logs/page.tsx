import type { Metadata } from 'next';
import { ApiLogsTable } from '../../components/integrations/api-logs-table';
import { FilterForm } from '../../components/integrations/filter-form';
import { PageHeader } from '../../components/page-header';
import { PageMain } from '../../components/page-main';
import { Pagination } from '../../components/pagination';
import { API_LOG_METHODS, listApiLogs, parseApiLogListQuery } from '../../lib/api/api-logs';
import { hasPermission } from '../../lib/api/me';
import { renderPage } from '../../lib/api/page';
import { cursorFromNextLink } from '../../lib/list-query';
import { SavedViewsSlot } from '../../components/saved-views/saved-views-slot';

export const metadata: Metadata = { title: 'API logs' };

export interface ApiLogsPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const METHOD_OPTIONS = API_LOG_METHODS.map((method) => ({ value: method, label: method }));

/**
 * Every server API request of the environment, newest first (C12), filtered by method, status,
 * route, API key, dashboard user (C25.9) and time, with the filters in the URL.
 */
export default async function ApiLogsPage({ searchParams }: ApiLogsPageProps) {
  const query = parseApiLogListQuery(await searchParams);
  return renderPage({ permissions: ['api-logs:read'] }, async ({ api, session }) => {
    const page = await listApiLogs(api, query);
    const filtered = Object.keys(query.values).length > 0 || query.after !== undefined;
    return (
      <PageMain>
        <PageHeader
          title="API logs"
          description="Every request to the server API in this environment, newest first. Secrets read [REDACTED]; entries are kept for 30 days by default."
        />
        <SavedViewsSlot list="api-logs" />
        <FilterForm
          label="Filter API logs"
          action="/api-logs"
          values={query.values}
          errors={query.errors}
          fields={[
            {
              name: 'method',
              label: 'Method',
              type: 'select',
              allLabel: 'All methods',
              options: METHOD_OPTIONS,
            },
            { name: 'status', label: 'Status', type: 'text', placeholder: '404 or 4xx' },
            { name: 'route', label: 'Route', type: 'text', placeholder: '/api/v1/inquiries/:id' },
            { name: 'api-key-id', label: 'API key ID', type: 'text', placeholder: 'key_…' },
            { name: 'user-id', label: 'User ID', type: 'text', placeholder: 'usr_…' },
            { name: 'created-at-start', label: 'From (UTC)', type: 'datetime-local' },
            { name: 'created-at-end', label: 'To (UTC)', type: 'datetime-local' },
          ]}
        />
        <ApiLogsTable
          logs={page.data}
          canSeeApiKeys={hasPermission(session, 'api-keys:read')}
          emptyMessage={filtered ? 'No API logs match.' : 'No requests to the server API yet.'}
        />
        <Pagination
          path="/api-logs"
          query={query.values}
          after={query.after}
          nextCursor={cursorFromNextLink(page.links.next, 'alog')}
        />
      </PageMain>
    );
  });
}

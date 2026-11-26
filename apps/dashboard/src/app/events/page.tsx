import { EVENT_NAMES } from '@openverify/contracts';
import type { Metadata } from 'next';
import { EventsTable } from '../../components/integrations/events-table';
import { FilterForm } from '../../components/integrations/filter-form';
import { PageHeader } from '../../components/page-header';
import { PageMain } from '../../components/page-main';
import { Pagination } from '../../components/pagination';
import { listEvents, parseEventListQuery } from '../../lib/api/events';
import { renderPage } from '../../lib/api/page';
import { cursorFromNextLink } from '../../lib/list-query';
import { SavedViewsSlot } from '../../components/saved-views/saved-views-slot';

export const metadata: Metadata = { title: 'Events' };

export interface EventsPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const NAME_OPTIONS = EVENT_NAMES.map((name) => ({ value: name, label: name }));

/**
 * The environment's events, newest first (C12): filtered by name, the object they are about and
 * time, and real or simulated, with the filters in the URL.
 */
export default async function EventsPage({ searchParams }: EventsPageProps) {
  const query = parseEventListQuery(await searchParams);
  return renderPage({ permissions: ['events:read'] }, async ({ api }) => {
    const page = await listEvents(api, query);
    const filtered = Object.keys(query.values).length > 0 || query.after !== undefined;
    return (
      <PageMain>
        <PageHeader
          title="Events"
          description="What happened in this environment, newest first. Webhooks receive the same documents."
        />
        <SavedViewsSlot list="events" />
        <FilterForm
          label="Filter events"
          action="/events"
          values={query.values}
          errors={query.errors}
          fields={[
            {
              name: 'name',
              label: 'Event',
              type: 'select',
              allLabel: 'All events',
              options: NAME_OPTIONS,
            },
            { name: 'object-id', label: 'Object ID', type: 'text', placeholder: 'inq_…' },
            {
              name: 'simulated',
              label: 'Show',
              type: 'select',
              allLabel: 'Real events',
              options: [{ value: 'true', label: 'Simulated events' }],
            },
            { name: 'created-at-start', label: 'From (UTC)', type: 'datetime-local' },
            { name: 'created-at-end', label: 'To (UTC)', type: 'datetime-local' },
          ]}
        />
        <EventsTable
          events={page.data}
          emptyMessage={filtered ? 'No events match.' : 'No events yet.'}
        />
        <Pagination
          path="/events"
          query={query.values}
          after={query.after}
          nextCursor={cursorFromNextLink(page.links.next, 'evt')}
        />
      </PageMain>
    );
  });
}

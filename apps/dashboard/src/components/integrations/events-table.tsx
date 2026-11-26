import type { EventResource } from '@openverify/contracts';
import { cx } from '@openverify/ui';
import Link from 'next/link';
import { eventWords } from '../../lib/event-words';
import { DataTable, type Column } from '../data-table';
import { LINK_CLASS } from '../link-styles';
import { Timestamp } from '../timestamp';

/** The resource an event is about: its type and id. */
export function EventSubject({ event }: { readonly event: EventResource }) {
  const { type, id } = event.attributes.payload.data;
  return (
    <span>
      {type} <code className="font-mono text-xs">{id}</code>
    </span>
  );
}

/** Marks an event made by a webhook simulation (C14), which carries synthetic data. */
export function SimulatedTag({ className }: { readonly className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-600/20 ring-inset',
        className,
      )}
    >
      Simulated
    </span>
  );
}

const COLUMNS: readonly Column<EventResource>[] = [
  {
    id: 'id',
    header: 'Event',
    rowHeader: true,
    cell: (event) => (
      <Link href={`/events/${event.id}`} className={LINK_CLASS}>
        <code className="font-mono text-xs">{event.id}</code>
      </Link>
    ),
  },
  {
    id: 'name',
    header: 'Name',
    cell: (event) => {
      const words = eventWords(event.attributes.name);
      return (
        <span className="flex flex-col gap-0.5">
          <span className="inline-flex flex-wrap items-center gap-2">
            <code className="font-mono text-xs">{event.attributes.name}</code>
            {event.attributes.simulated === true && <SimulatedTag />}
          </span>
          {words !== undefined && <span className="text-xs text-ink-muted">{words}</span>}
        </span>
      );
    },
  },
  { id: 'subject', header: 'About', cell: (event) => <EventSubject event={event} /> },
  {
    id: 'created',
    header: 'Created (UTC)',
    cell: (event) => <Timestamp value={event.attributes['created-at']} />,
  },
];

export function EventsTable({
  events,
  emptyMessage,
}: {
  readonly events: readonly EventResource[];
  readonly emptyMessage: string;
}) {
  return (
    <DataTable
      caption="Events"
      captionHidden
      columns={COLUMNS}
      rows={events}
      getRowKey={(event) => event.id}
      emptyMessage={emptyMessage}
    />
  );
}

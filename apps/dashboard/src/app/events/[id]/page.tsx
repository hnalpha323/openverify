import { idSchema, type EventResource } from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Detail } from '../../../components/detail';
import { SimulatedTag } from '../../../components/integrations/events-table';
import { JsonView } from '../../../components/integrations/json-view';
import { DeliveriesTable } from '../../../components/integrations/webhook-tables';
import { LINK_CLASS } from '../../../components/link-styles';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import { Timestamp } from '../../../components/timestamp';
import { hasPermission, type DashboardSession } from '../../../lib/api/me';
import { eventWords } from '../../../lib/event-words';
import { renderPage } from '../../../lib/api/page';

export const metadata: Metadata = { title: 'Event' };

export interface EventPageProps {
  readonly params: Promise<{ id: string }>;
}

/** The console page of each subject an operator can open, with the permission it needs. */
const SUBJECT_PAGES: Readonly<Record<string, { path: string; permission: Permission }>> = {
  inquiry: { path: '/inquiries', permission: 'inquiries:read' },
  account: { path: '/accounts', permission: 'accounts:read' },
};

function Subject({
  event,
  session,
}: {
  readonly event: EventResource;
  readonly session: DashboardSession;
}) {
  const { type, id } = event.attributes.payload.data;
  const page = SUBJECT_PAGES[type];
  const code = <code className="font-mono text-xs">{id}</code>;
  return (
    <span>
      {type}{' '}
      {page !== undefined && hasPermission(session, page.permission) ? (
        <Link href={`${page.path}/${id}`} className={LINK_CLASS}>
          {code}
        </Link>
      ) : (
        code
      )}
    </span>
  );
}

/** When the subject was redacted (C16): its payload is then a stub with only `redacted-at`. */
function redactedAt(event: EventResource): string | null {
  const attributes: Readonly<Record<string, unknown>> = event.attributes.payload.data.attributes;
  const value = attributes['redacted-at'];
  return Object.keys(attributes).length === 1 && typeof value === 'string' ? value : null;
}

/**
 * One event (C5, C12): what it is about, its payload as JSON (values the API masked for a role
 * without `pii:view` read "Hidden"), and, for `webhooks:read`, the deliveries it caused.
 */
export default async function EventPage({ params }: EventPageProps) {
  const { id } = await params;
  if (!idSchema('evt').safeParse(id).success) {
    notFound();
  }
  return renderPage({ permissions: ['events:read'] }, async ({ api, session }) => {
    const { data: event } = await api.events.retrieve(id);
    const canSeeDeliveries = hasPermission(session, 'webhooks:read');
    const deliveries = canSeeDeliveries
      ? await api.webhookDeliveries.list({ filter: { 'event-id': id }, page: { size: 25 } })
      : null;
    const { attributes } = event;
    const redacted = redactedAt(event);
    return (
      <PageMain className="gap-8">
        <PageHeader
          title={<code className="font-mono text-2xl">{attributes.name}</code>}
          description={eventWords(attributes.name)}
          breadcrumbs={[
            { label: 'Events', href: '/events' },
            { label: <code className="font-mono text-xs">{id}</code> },
          ]}
        />
        <section aria-labelledby="event-details" className="flex flex-col gap-3">
          <h2 id="event-details" className="text-lg font-semibold">
            Details
          </h2>
          <dl className="grid gap-4 rounded-xl border border-line bg-surface p-6 sm:grid-cols-2 lg:grid-cols-3">
            <Detail term="Event ID">
              <code className="font-mono text-xs">{event.id}</code>
            </Detail>
            <Detail term="About">
              <Subject event={event} session={session} />
            </Detail>
            <Detail term="Simulated">
              {attributes.simulated === true ? (
                <span className="inline-flex items-center gap-2">
                  Yes <SimulatedTag />
                </span>
              ) : (
                'No'
              )}
            </Detail>
            <Detail term="Created (UTC)">
              <Timestamp value={attributes['created-at']} />
            </Detail>
            {redacted !== null && (
              <Detail term="Redacted (UTC)">
                <Timestamp value={redacted} />
              </Detail>
            )}
          </dl>
        </section>
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Payload</h2>
          <JsonView
            label="Payload"
            value={attributes.payload}
            masked={!hasPermission(session, 'pii:view')}
          />
        </div>
        {deliveries !== null && (
          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Webhook deliveries</h2>
            <DeliveriesTable
              deliveries={deliveries.data}
              caption="Webhook deliveries"
              emptyMessage="No webhook received this event."
              byWebhook
            />
          </div>
        )}
      </PageMain>
    );
  });
}

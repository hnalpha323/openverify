import { idSchema, type WebhookDeliveryResource } from '@openverify/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DataTable, type Column } from '../../../../../components/data-table';
import { Detail } from '../../../../../components/detail';
import { DeliveryStatusBadge } from '../../../../../components/integrations/badges';
import { AttemptResponse } from '../../../../../components/integrations/webhook-tables';
import { LINK_CLASS } from '../../../../../components/link-styles';
import { EmptyValue } from '../../../../../components/masked-value';
import { PageHeader } from '../../../../../components/page-header';
import { PageMain } from '../../../../../components/page-main';
import { Timestamp } from '../../../../../components/timestamp';
import { hasPermission } from '../../../../../lib/api/me';
import { renderPage } from '../../../../../lib/api/page';

export const metadata: Metadata = { title: 'Webhook delivery' };

export interface DeliveryPageProps {
  readonly params: Promise<{ id: string; deliveryId: string }>;
}

type Attempt = WebhookDeliveryResource['attributes']['attempts'][number] & {
  readonly number: number;
};

const ATTEMPT_COLUMNS: readonly Column<Attempt>[] = [
  { id: 'number', header: 'Attempt', rowHeader: true, cell: (attempt) => String(attempt.number) },
  {
    id: 'at',
    header: 'Attempted (UTC)',
    cell: (attempt) => <Timestamp value={attempt['attempted-at']} />,
  },
  { id: 'response', header: 'Response', cell: (attempt) => <AttemptResponse attempt={attempt} /> },
  {
    id: 'duration',
    header: 'Duration',
    cell: (attempt) =>
      attempt['duration-ms'] === null ? <EmptyValue /> : `${String(attempt['duration-ms'])} ms`,
  },
  {
    id: 'error',
    header: 'Error',
    cell: (attempt) => attempt.error ?? <EmptyValue />,
  },
];

/**
 * One delivery of a webhook (C14): its status, the event it carries, and every attempt with the
 * response status, duration and error. Attempts never record the URL or a body.
 */
export default async function DeliveryPage({ params }: DeliveryPageProps) {
  const { id, deliveryId } = await params;
  if (!idSchema('wbh').safeParse(id).success || !idSchema('whd').safeParse(deliveryId).success) {
    notFound();
  }
  return renderPage({ permissions: ['webhooks:read'] }, async ({ api, session }) => {
    const { data: delivery } = await api.webhookDeliveries.retrieve(deliveryId);
    const { attributes } = delivery;
    if (attributes['webhook-id'] !== id) {
      notFound();
    }
    const eventId = attributes['event-id'];
    const next = attributes['next-attempt-at'];
    return (
      <PageMain className="gap-8">
        <PageHeader
          title={
            <>
              Delivery <code className="font-mono text-xl">{deliveryId}</code>
            </>
          }
          breadcrumbs={[
            { label: 'Webhooks', href: '/webhooks' },
            { label: 'Webhook', href: `/webhooks/${id}` },
            { label: <code className="font-mono text-xs">{deliveryId}</code> },
          ]}
        />
        <dl className="grid gap-4 rounded-xl border border-line bg-surface p-6 sm:grid-cols-2 lg:grid-cols-3">
          <Detail term="Status">
            <DeliveryStatusBadge status={attributes.status} />
          </Detail>
          <Detail term="Event">
            <code className="font-mono text-xs">{attributes['event-name']}</code>
          </Detail>
          <Detail term="Event ID">
            {hasPermission(session, 'events:read') ? (
              <Link href={`/events/${eventId}`} className={LINK_CLASS}>
                <code className="font-mono text-xs">{eventId}</code>
              </Link>
            ) : (
              <code className="font-mono text-xs">{eventId}</code>
            )}
          </Detail>
          <Detail term="Created (UTC)">
            <Timestamp value={attributes['created-at']} />
          </Detail>
          <Detail term="Next attempt (UTC)">
            {next === null ? <EmptyValue /> : <Timestamp value={next} />}
          </Detail>
        </dl>
        <DataTable
          caption="Attempts"
          columns={ATTEMPT_COLUMNS}
          rows={attributes.attempts.map((attempt, index) => ({ ...attempt, number: index + 1 }))}
          getRowKey={(attempt) => String(attempt.number)}
          emptyMessage="No attempt yet."
        />
      </PageMain>
    );
  });
}

import type { WebhookDeliveryResource, WebhookResource } from '@openverify/contracts';
import Link from 'next/link';
import { DataTable, type Column } from '../data-table';
import { LINK_CLASS } from '../link-styles';
import { EmptyValue } from '../masked-value';
import { Timestamp } from '../timestamp';
import { DeliveryStatusBadge, HttpStatusBadge, WebhookStatusBadge } from './badges';

/** A webhook's events in a few words: all of them, up to two names, or two and how many more. */
export function eventsSummary(events: readonly string[]): string {
  if (events.includes('*')) {
    return 'All events';
  }
  if (events.length <= 2) {
    return events.join(', ');
  }
  return `${events.slice(0, 2).join(', ')} and ${String(events.length - 2)} more`;
}

const WEBHOOK_COLUMNS: readonly Column<WebhookResource>[] = [
  {
    id: 'url',
    header: 'Webhook',
    rowHeader: true,
    // C169.5, DS14 (K9-12): a named webhook by its name, its endpoint below; else by its URL.
    cell: (webhook) => {
      const name = webhook.attributes.name ?? null;
      return name === null ? (
        <Link href={`/webhooks/${webhook.id}`} className={`${LINK_CLASS} break-all`}>
          {webhook.attributes.url}
        </Link>
      ) : (
        <span className="flex flex-col">
          <Link href={`/webhooks/${webhook.id}`} className={`${LINK_CLASS} break-words`}>
            {name}
          </Link>
          <span className="text-xs break-all text-ink-muted">{webhook.attributes.url}</span>
        </span>
      );
    },
  },
  {
    id: 'status',
    header: 'Status',
    cell: (webhook) => <WebhookStatusBadge status={webhook.attributes.status} />,
  },
  {
    id: 'events',
    header: 'Events',
    cell: (webhook) => eventsSummary(webhook.attributes['enabled-events']),
  },
  {
    id: 'created',
    header: 'Created (UTC)',
    cell: (webhook) => <Timestamp value={webhook.attributes['created-at']} />,
  },
];

export function WebhooksTable({ webhooks }: { readonly webhooks: readonly WebhookResource[] }) {
  return (
    <DataTable
      caption="Webhooks"
      captionHidden
      columns={WEBHOOK_COLUMNS}
      rows={webhooks}
      getRowKey={(webhook) => webhook.id}
      emptyMessage="No webhooks on this page."
    />
  );
}

type Attempt = WebhookDeliveryResource['attributes']['attempts'][number];

/** What an attempt got back: the response status, or that none came. */
export function AttemptResponse({ attempt }: { readonly attempt: Attempt | undefined }) {
  if (attempt === undefined) {
    return <EmptyValue />;
  }
  const status = attempt['response-status'];
  return status === null ? <>No response</> : <HttpStatusBadge status={status} />;
}

const deliveryHref = (delivery: WebhookDeliveryResource) =>
  `/webhooks/${delivery.attributes['webhook-id']}/deliveries/${delivery.id}`;

function deliveryColumns(showWebhook: boolean): readonly Column<WebhookDeliveryResource>[] {
  return [
    {
      id: 'id',
      header: 'Delivery',
      rowHeader: true,
      cell: (delivery) => (
        <Link href={deliveryHref(delivery)} className={LINK_CLASS}>
          <code className="font-mono text-xs">{delivery.id}</code>
        </Link>
      ),
    },
    showWebhook
      ? {
          id: 'webhook',
          header: 'Webhook',
          cell: (delivery) => (
            <Link href={`/webhooks/${delivery.attributes['webhook-id']}`} className={LINK_CLASS}>
              <code className="font-mono text-xs">{delivery.attributes['webhook-id']}</code>
            </Link>
          ),
        }
      : {
          id: 'event',
          header: 'Event',
          cell: (delivery) => (
            <code className="font-mono text-xs">{delivery.attributes['event-name']}</code>
          ),
        },
    {
      id: 'status',
      header: 'Status',
      cell: (delivery) => <DeliveryStatusBadge status={delivery.attributes.status} />,
    },
    {
      id: 'attempts',
      header: 'Attempts',
      cell: (delivery) => String(delivery.attributes.attempts.length),
    },
    {
      id: 'response',
      header: 'Last response',
      cell: (delivery) => <AttemptResponse attempt={delivery.attributes.attempts.at(-1)} />,
    },
    {
      id: 'next',
      header: 'Next attempt (UTC)',
      cell: (delivery) => {
        const next = delivery.attributes['next-attempt-at'];
        return next === null ? <EmptyValue /> : <Timestamp value={next} />;
      },
    },
    {
      id: 'created',
      header: 'Created (UTC)',
      cell: (delivery) => <Timestamp value={delivery.attributes['created-at']} />,
    },
  ];
}

export interface DeliveriesTableProps {
  readonly deliveries: readonly WebhookDeliveryResource[];
  /** Names the table; "Deliveries" by default. */
  readonly caption?: string;
  readonly emptyMessage?: string;
  /** Deliveries of one event to several webhooks: a webhook column instead of the event one. */
  readonly byWebhook?: boolean;
}

/** Webhook deliveries with their status and last response; each links to its attempts. */
export function DeliveriesTable({
  deliveries,
  caption = 'Deliveries',
  emptyMessage = 'No deliveries match.',
  byWebhook = false,
}: DeliveriesTableProps) {
  return (
    <DataTable
      caption={caption}
      captionHidden
      columns={deliveryColumns(byWebhook)}
      rows={deliveries}
      getRowKey={(delivery) => delivery.id}
      emptyMessage={emptyMessage}
    />
  );
}

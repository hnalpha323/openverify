import {
  WEBHOOK_DELIVERY_STATUSES,
  idSchema,
  type WebhookFailureAlert,
  type WebhookResource,
} from '@openverify/contracts';
import { Alert } from '@openverify/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { Detail } from '../../../components/detail';
import {
  DELIVERY_STATUS_LABELS,
  WebhookStatusBadge,
} from '../../../components/integrations/badges';
import { FilterForm } from '../../../components/integrations/filter-form';
import { ReplayEventsForm } from '../../../components/integrations/replay-events-form';
import { SimulateEventForm } from '../../../components/integrations/simulate-event-form';
import { WebhookActions } from '../../../components/integrations/webhook-actions';
import { DeliveriesTable } from '../../../components/integrations/webhook-tables';
import { EmptyValue } from '../../../components/masked-value';
import { PageHeader } from '../../../components/page-header';
import { PageMain } from '../../../components/page-main';
import { Pagination } from '../../../components/pagination';
import { Timestamp, formatUtc } from '../../../components/timestamp';
import { eventNameGroups } from '../../../lib/api/events';
import { hasPermission } from '../../../lib/api/me';
import { renderPage } from '../../../lib/api/page';
import { SETTINGS_COPY } from '../../../lib/copy/settings';
import { listWebhookDeliveries, parseDeliveryListQuery } from '../../../lib/api/webhook-deliveries';
import { cursorFromNextLink } from '../../../lib/list-query';
import {
  archiveWebhook,
  cloneWebhook,
  disableWebhook,
  enableWebhook,
  replayWebhookEvents,
  rotateWebhookSecret,
  simulateWebhookEvent,
} from '../actions';
import { SavedViewsSlot } from '../../../components/saved-views/saved-views-slot';

export const metadata: Metadata = { title: 'Webhook' };

export interface WebhookPageProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** A list of codes, or an em dash when there is none. */
function Codes({ values }: { readonly values: readonly string[] | undefined }): ReactNode {
  if (values === undefined || values.length === 0) {
    return <EmptyValue />;
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {values.map((value) => (
        <li key={value}>
          <code className="font-mono text-xs break-all">{value}</code>
        </li>
      ))}
    </ul>
  );
}

const COPY = SETTINGS_COPY.webhooks;

/** C169.6: the failure alert in words; the numbers kept while it is off are named as off. */
function FailureAlertValue({ alert }: { readonly alert: WebhookFailureAlert | null }) {
  if (alert === null) {
    return COPY.alertOff;
  }
  return alert.enabled
    ? COPY.alertOn(alert.threshold, alert['window-minutes'])
    : COPY.alertSwitchedOff(alert.threshold, alert['window-minutes']);
}

function Configuration({ webhook }: { readonly webhook: WebhookResource }) {
  const { attributes } = webhook;
  const events: readonly string[] = attributes['enabled-events'];
  return (
    <section aria-labelledby="webhook-configuration" className="flex flex-col gap-3">
      <h2 id="webhook-configuration" className="text-lg font-semibold">
        Configuration
      </h2>
      <dl className="grid gap-4 rounded-xl border border-line bg-surface p-6 sm:grid-cols-2 lg:grid-cols-3">
        <Detail term="Status">
          <WebhookStatusBadge status={attributes.status} />
        </Detail>
        <Detail term={COPY.description}>{attributes.description ?? <EmptyValue />}</Detail>
        <Detail term={COPY.alertLegend}>
          <FailureAlertValue alert={attributes['failure-alert'] ?? null} />
        </Detail>
        <Detail term="Events">
          {events.includes('*') ? 'All events' : <Codes values={events} />}
        </Detail>
        <Detail term="API version">{attributes['api-version'] ?? <EmptyValue />}</Detail>
        <Detail term="Signing secret">
          Ends in <code className="font-mono text-xs">…{attributes['secret-last4']}</code>
        </Detail>
        <Detail term="Custom headers">
          <Codes values={Object.keys(attributes['custom-headers'] ?? {})} />
        </Detail>
        <Detail term="Inquiry template filter">
          <Codes values={attributes.filters?.['inquiry-template-ids']} />
        </Detail>
        <Detail term="Account type filter">
          <Codes values={attributes.filters?.['account-type-ids']} />
        </Detail>
        <Detail term="Attribute blocklist">
          <Codes values={attributes['attribute-blocklist']} />
        </Detail>
        <Detail term="Webhook ID">
          <code className="font-mono text-xs">{webhook.id}</code>
        </Detail>
        <Detail term="Created (UTC)">
          <Timestamp value={attributes['created-at']} />
        </Detail>
        <Detail term="Updated (UTC)">
          <Timestamp value={attributes['updated-at']} />
        </Detail>
      </dl>
    </section>
  );
}

const STATUS_OPTIONS = WEBHOOK_DELIVERY_STATUSES.map((status) => ({
  value: status,
  label: DELIVERY_STATUS_LABELS[status],
}));

/**
 * One webhook (C14): its configuration, the changes `webhooks:write` allows (edit, enable or
 * disable, rotate the secret, clone, archive, send a test event, replay events) and its
 * deliveries, filtered by status and event in the URL.
 */
export default async function WebhookPage({ params, searchParams }: WebhookPageProps) {
  const { id } = await params;
  if (!idSchema('wbh').safeParse(id).success) {
    notFound();
  }
  const query = parseDeliveryListQuery(await searchParams);
  return renderPage({ permissions: ['webhooks:read'] }, async ({ api, session }) => {
    const { data: webhook } = await api.webhooks.retrieve(id);
    const deliveries = await listWebhookDeliveries(api, id, query);
    const canWrite = hasPermission(session, 'webhooks:write');
    const { status } = webhook.attributes;
    const previousEnd = webhook.attributes['previous-secret-expires-at'] ?? null;
    const previousSigns = previousEnd !== null && Date.parse(previousEnd) > Date.now();
    return (
      <PageMain className="gap-8">
        <PageHeader
          title={
            webhook.attributes.name ?? <span className="break-all">{webhook.attributes.url}</span>
          }
          {...(webhook.attributes.name == null
            ? {}
            : { description: <span className="break-all">{webhook.attributes.url}</span> })}
          breadcrumbs={[
            { label: 'Webhooks', href: '/webhooks' },
            { label: <code className="font-mono text-xs">{id}</code> },
          ]}
        />
        {canWrite && (
          <WebhookActions
            webhookId={id}
            status={status}
            enable={enableWebhook}
            disable={disableWebhook}
            archive={archiveWebhook}
            clone={cloneWebhook}
            rotate={rotateWebhookSecret}
          />
        )}
        {/* C169.5: while the previous secret still signs, receivers must accept either signature. */}
        {previousSigns && <Alert tone="info">{COPY.previousSecret(formatUtc(previousEnd))}</Alert>}
        <Configuration webhook={webhook} />
        {canWrite && status !== 'archived' && (
          <div className="grid gap-8 lg:grid-cols-2">
            <section aria-labelledby="webhook-test-event" className="flex flex-col gap-3">
              <h2 id="webhook-test-event" className="text-lg font-semibold">
                Send a test event
              </h2>
              <p className="text-sm text-ink-muted">
                A sample event with synthetic data, flagged as simulated, delivered to this webhook
                only.
              </p>
              {status === 'enabled' ? (
                <SimulateEventForm
                  webhookId={id}
                  groups={eventNameGroups()}
                  action={simulateWebhookEvent}
                  canSeeEvents={hasPermission(session, 'events:read')}
                />
              ) : (
                <p className="text-sm text-ink-muted">Enable the webhook to send it events.</p>
              )}
            </section>
            <section aria-labelledby="webhook-replay" className="flex flex-col gap-3">
              <h2 id="webhook-replay" className="text-lg font-semibold">
                Replay events
              </h2>
              <p className="text-sm text-ink-muted">
                Deliver past events to this webhook again, as new deliveries.
              </p>
              {status === 'enabled' ? (
                <ReplayEventsForm webhookId={id} action={replayWebhookEvents} />
              ) : (
                <p className="text-sm text-ink-muted">Enable the webhook to replay events.</p>
              )}
            </section>
          </div>
        )}
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Deliveries</h2>
          <SavedViewsSlot list="webhook-deliveries" />
          <FilterForm
            label="Filter deliveries"
            action={`/webhooks/${id}`}
            values={query.values}
            errors={query.errors}
            fields={[
              {
                name: 'status',
                label: 'Status',
                type: 'select',
                allLabel: 'All statuses',
                options: STATUS_OPTIONS,
              },
              {
                name: 'event-id',
                label: 'Event ID',
                type: 'text',
                placeholder: 'evt_…',
              },
            ]}
          />
          <DeliveriesTable deliveries={deliveries.data} />
          <Pagination
            path={`/webhooks/${id}`}
            query={query.values}
            after={query.after}
            nextCursor={cursorFromNextLink(deliveries.links.next, 'whd')}
          />
        </div>
      </PageMain>
    );
  });
}

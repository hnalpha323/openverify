/**
 * A webhook's deliveries (C14) as the webhook page lists them: filtered by status and event,
 * with the filters and the cursor in the page URL (C23).
 */
import 'server-only';
import {
  WEBHOOK_DELIVERY_STATUSES,
  idSchema,
  webhookDeliveryListDocumentSchema,
  type WebhookDeliveryResource,
  type WebhookDeliverySearchBody,
} from '@openverify/contracts';
import type { OpenVerifyClient } from '@openverify/node';
import {
  matching,
  oneOf,
  readFilters,
  type ReadFilters,
  type SearchParams,
} from '../../components/integrations/filter-values';
import { cursorFromNextLink, parseCursor } from '../list-query';
import { apiRequest } from './client';

export const DELIVERY_PAGE_SIZE = 25;

export type DeliveryFilterName = 'status' | 'event-id';

export interface DeliveryListQuery extends ReadFilters<DeliveryFilterName> {
  /** The last delivery of the previous page. */
  readonly after?: string;
}

const isEventId = (value: string) => idSchema('evt').safeParse(value).success;

export const EVENT_ID_ERROR = 'Enter an event ID, such as evt_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z.';

/** The deliveries filter of the webhook page's URL: `?status=failed&event-id=evt_…&after=whd_…`. */
export function parseDeliveryListQuery(params: SearchParams): DeliveryListQuery {
  const after = parseCursor(params.after, 'whd');
  return {
    ...readFilters(params, {
      status: oneOf(WEBHOOK_DELIVERY_STATUSES, 'Choose a status from the list.'),
      'event-id': matching(isEventId, EVENT_ID_ERROR),
    }),
    ...(after === undefined ? {} : { after }),
  };
}

/** One page of `webhookId`'s deliveries, newest first. */
export function listWebhookDeliveries(
  api: OpenVerifyClient,
  webhookId: string,
  query: DeliveryListQuery,
) {
  return api.webhookDeliveries.list({
    filter: { 'webhook-id': webhookId, ...query.applied },
    page: {
      size: DELIVERY_PAGE_SIZE,
      ...(query.after === undefined ? {} : { after: query.after }),
    },
  });
}

/**
 * `POST /webhook-deliveries/search` (`webhooks:read`; C165.4): `and`, `or` and `not` over
 * `updated_at`, `status`, `webhook_id` and `event_name`, at most two levels and 20 clauses; newest
 * first. The API's next link carries an id, which is posted back as `page.after`.
 */
export async function searchWebhookDeliveries(body: WebhookDeliverySearchBody): Promise<{
  readonly deliveries: readonly WebhookDeliveryResource[];
  readonly next: string | null;
}> {
  const answer = await apiRequest({
    method: 'POST',
    path: '/webhook-deliveries/search',
    body,
    schema: webhookDeliveryListDocumentSchema,
  });
  return { deliveries: answer.data, next: cursorFromNextLink(answer.links.next, 'whd') };
}

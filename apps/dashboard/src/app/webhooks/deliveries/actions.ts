'use server';

/**
 * The delivery search (C165.4; `webhooks:read`): the builder's form as the API's grammar, posted to
 * `POST /webhook-deliveries/search`, newest first, one page at a time.
 */
import type { WebhookDeliveryResource } from '@openverify/contracts';
import { deliverySearchBodyOf } from '../../../components/integrations/delivery-search-query';
import type { ActionResult, ActionState } from '../../../lib/action-state';
import { runAction } from '../../../lib/api/action';
import { searchWebhookDeliveries } from '../../../lib/api/webhook-deliveries';

export interface DeliverySearchResult {
  readonly deliveries: readonly WebhookDeliveryResource[];
  /** The last delivery's id, to post as `after` for the next page; `null` on the last page. */
  readonly next: string | null;
}

export async function searchDeliveries(
  _previous: ActionState<DeliverySearchResult>,
  formData: FormData,
): Promise<ActionResult<DeliverySearchResult>> {
  return runAction({ permissions: ['webhooks:read'] }, () =>
    searchWebhookDeliveries(deliverySearchBodyOf(formData)),
  );
}

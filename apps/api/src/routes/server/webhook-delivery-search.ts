/**
 * C165.4 (Workflow 9B; S7; contracts B22): `POST /api/v1/webhook-deliveries/search` (`webhooks:read`),
 * ours, with the public `webhook-events/search` grammar: `and`, `or` and `not` over `updated_at`,
 * `status`, `webhook_id` and `event_name`, at most two levels and 20 clauses. Frozen by
 * `foundation-9b` (Stage 1b (X)); `api-exports` owns this file and builds the handler
 * (`services/list-filters/webhook-delivery-search.ts`), which answers 501 until then. The body holds
 * no personal data: no clause reads a body, a header or a URL.
 */
import {
  webhookDeliveryListDocumentSchema,
  webhookDeliverySearchBodySchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import { searchWebhookDeliveries } from '../../services/list-filters/webhook-delivery-search.js';
import { actingOf } from './inquiries.js';

/** C165.4 delivery search route, under `/api/v1`. */
export const webhookDeliverySearchRoutes: FastifyPluginCallbackZod<ApiDependencies> = (
  app,
  deps,
  done,
) => {
  app.post(
    '/webhook-deliveries/search',
    {
      config: { scopes: ['webhooks:read'] },
      schema: {
        summary: 'Search webhook deliveries',
        description:
          'C165.4: `and`, `or` and `not` over `updated_at` (`gt`, `gte`, `lt`, `lte`), `status`, ' +
          '`webhook_id` and `event_name` (`eq`, `in`), at most two levels of operators and 20 ' +
          'clauses; the delivery list, newest first, paged by `page`.',
        tags: ['webhooks'],
        body: webhookDeliverySearchBodySchema,
        response: {
          200: webhookDeliveryListDocumentSchema,
          ...problemResponses(400, 401, 403),
        },
      },
    },
    (request) => searchWebhookDeliveries(deps, actingOf(request), request.body),
  );

  done();
};

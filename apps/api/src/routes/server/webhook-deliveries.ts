import {
  idSchema,
  listWebhookDeliveriesQuerySchema,
  webhookDeliveryDocumentSchema,
  webhookDeliveryListDocumentSchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import { requirePrincipal } from '../../plugins/principal-auth.js';
import type { ApiDependencies } from '../../services/context.js';
import { getWebhookDelivery, listWebhookDeliveries } from '../../services/webhooks.js';

const TAGS = ['webhooks'];

/** C14 webhook delivery routes (scope `webhooks:read`), under `/api/v1`. */
export const webhookDeliveryRoutes: FastifyPluginCallbackZod<ApiDependencies> = (
  app,
  deps,
  done,
) => {
  app.get(
    '/webhook-deliveries',
    {
      config: { scopes: ['webhooks:read'] },
      schema: {
        summary: 'List webhook deliveries, newest first',
        description:
          'Filters: `webhook-id`, `event-id` and `status` (comma-separated values mean OR), and ' +
          '`created-at-start` (inclusive) and `created-at-end` (exclusive). Each delivery ' +
          'lists its attempts: time, response status, duration and a generic error, never a ' +
          'body.',
        tags: TAGS,
        querystring: listWebhookDeliveriesQuerySchema,
        response: { 200: webhookDeliveryListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) =>
      listWebhookDeliveries(deps, requirePrincipal(request).environmentId, request.query),
  );

  app.get(
    '/webhook-deliveries/:id',
    {
      config: { scopes: ['webhooks:read'] },
      schema: {
        summary: 'Fetch a webhook delivery with its attempts',
        tags: TAGS,
        params: z.object({ id: idSchema('whd') }),
        response: { 200: webhookDeliveryDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    async (request) => ({
      data: await getWebhookDelivery(
        deps,
        requirePrincipal(request).environmentId,
        request.params.id,
      ),
    }),
  );

  done();
};

import {
  eventDocumentSchema,
  eventListDocumentSchema,
  idSchema,
  listEventsQuerySchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requirePrincipal } from '../../plugins/principal-auth.js';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import { getEventDocument, listEvents } from '../../services/events.js';

const TAGS = ['events'];
const PII_NOTE =
  'Users without `pii:view` get the payload resources masked: `fields` values, `note`, ' +
  '`ip-address` and `user-agent` read `null`.';

/** C2 and C12 event routes (scope `events:read`), under `/api/v1`. */
export const eventRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.get(
    '/events',
    {
      config: { scopes: ['events:read'] },
      schema: {
        summary: 'List events, newest first',
        description:
          'Filters: `name` (comma-separated event names), `object-id` (the payload resource), ' +
          '`inquiry-id` (C25.7: events about the inquiry, one of its verifications or one of ' +
          'its inquiry sessions, for its timeline), ' +
          'the `created-at` range, and `simulated` (default `false`: events made by ' +
          '`POST /webhooks/:id/simulate` are listed only on request). A redacted subject ' +
          `leaves a stub payload \`{ data: { type, id, attributes: { redacted-at } } }\`. ${PII_NOTE}`,
        tags: TAGS,
        querystring: listEventsQuerySchema,
        response: { 200: eventListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => listEvents(deps, requirePrincipal(request), request.query),
  );

  app.get(
    '/events/:id',
    {
      config: { scopes: ['events:read'] },
      schema: {
        summary: 'Fetch an event',
        description: `The same document a webhook delivery carries in its body. ${PII_NOTE}`,
        tags: TAGS,
        params: z.object({ id: idSchema('evt') }),
        response: { 200: eventDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    (request) => getEventDocument(deps, requirePrincipal(request), request.params.id),
  );

  done();
};

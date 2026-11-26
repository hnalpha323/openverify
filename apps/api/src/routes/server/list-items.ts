/**
 * C97.1 (Workflow 7B): the list item routes under `/api/v1`: `POST /list-item/<plural>`, `GET` and
 * `DELETE` (archive) `/list-item/<plural>/:id` per kind, and, ours, `GET /list-items`. The schemas
 * and scopes are frozen (Stage 1b (L), `foundation-7b`); `api-lists` owns this file. The handlers
 * are `services/lists/items.ts`. Every value but the country code is masked without `pii:view`;
 * face and background items also need `pii:view` to create (C97.3), checked here, and each item
 * write takes the C12 policy `lists-write`.
 */
import {
  LIST_ITEM_CREATE_BODY_SCHEMAS,
  LIST_KINDS,
  LIST_KIND_REGISTRY,
  idSchema,
  listItemDocumentSchema,
  listItemListDocumentSchema,
  listListItemsQuerySchema,
  type IdPrefix,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requirePiiView } from '../../auth/pii.js';
import { problemResponses } from '../../plugins/openapi.js';
import { requirePrincipal } from '../../plugins/principal-auth.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  archiveListItem,
  createListItem,
  getListItemDocument,
  listListItems,
} from '../../services/lists/items.js';
import { actingOf } from './inquiries.js';

const TAGS = ['list-items'];

/** C97.1 list item routes, under `/api/v1`. */
export const listItemRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  for (const kind of LIST_KINDS) {
    const { plural, itemPrefix } = LIST_KIND_REGISTRY[kind];
    const params = z.object({ id: idSchema(itemPrefix as IdPrefix) });

    app.post(
      `/list-item/${plural}`,
      {
        config: { scopes: ['lists:write'] },
        schema: {
          summary: `Create a ${kind} list item`,
          tags: TAGS,
          body: LIST_ITEM_CREATE_BODY_SCHEMAS[kind],
          response: {
            201: listItemDocumentSchema,
            ...problemResponses(400, 401, 403, 404, 409, 422, 429),
          },
        },
      },
      async (request, reply) => {
        // C97.3: a face or background item embeds a person's face. 403 first.
        if (LIST_KIND_REGISTRY[kind].biometric) {
          requirePiiView(requirePrincipal(request));
        }
        const document = await createListItem(
          deps,
          actingOf(request),
          kind,
          request.body.data.attributes,
        );
        return reply.code(201).send(document);
      },
    );

    app.get(
      `/list-item/${plural}/:id`,
      {
        config: { scopes: ['lists:read'] },
        schema: {
          summary: `Fetch a ${kind} list item`,
          tags: TAGS,
          params,
          response: { 200: listItemDocumentSchema, ...problemResponses(400, 401, 403, 404) },
        },
      },
      (request) => getListItemDocument(deps, actingOf(request), kind, request.params.id),
    );

    app.delete(
      `/list-item/${plural}/:id`,
      {
        config: { scopes: ['lists:write'] },
        schema: {
          summary: `Archive a ${kind} list item`,
          description: 'C97.1: the item stops matching and stays readable.',
          tags: TAGS,
          params,
          response: { 200: listItemDocumentSchema, ...problemResponses(400, 401, 403, 404) },
        },
      },
      (request) => archiveListItem(deps, actingOf(request), kind, request.params.id),
    );
  }

  app.get(
    '/list-items',
    {
      config: { scopes: ['lists:read'] },
      schema: {
        summary: 'List the items of a list',
        description:
          'C97.1 (ours): `filter[list-id]` is required (400 `filter_required`); newest first.',
        tags: TAGS,
        querystring: listListItemsQuerySchema,
        response: { 200: listItemListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => listListItems(deps, actingOf(request), request.query),
  );

  done();
};

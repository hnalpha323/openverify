/**
 * C97.1, C99.4 (Workflow 7B): the list routes under `/api/v1`: `POST /list/<plural>` per kind,
 * `GET /lists`, `GET`, `PATCH` and `DELETE` (archive) `/lists/:id`, and `POST /lists/match`, which
 * needs `lists:read` and `pii:view` (P11) and takes the C12 policy `lists-match`. The schemas and
 * scopes are frozen (Stage 1b (L), `foundation-7b`); `api-lists` owns this file. The handlers are
 * `services/lists/lists.ts`. Face and background lists answer 409
 * `biometric_lists_not_acknowledged` until `biometric-lists-basis` is set (C97.4).
 */
import {
  LIST_CREATE_BODY_SCHEMAS,
  LIST_KINDS,
  LIST_KIND_REGISTRY,
  idSchema,
  listListsQuerySchema,
  listResourceDocumentSchema,
  listResourceListDocumentSchema,
  matchListsBodySchema,
  matchListsResponseSchema,
  updateListBodySchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requirePiiView } from '../../auth/pii.js';
import { problemResponses } from '../../plugins/openapi.js';
import { requirePrincipal } from '../../plugins/principal-auth.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  archiveList,
  createList,
  getListDocument,
  listLists,
  matchLists,
  updateList,
} from '../../services/lists/lists.js';
import { actingOf } from './inquiries.js';

const TAGS = ['lists'];

const listParams = z.object({ id: idSchema('lst') });

/** C97.1 list routes, under `/api/v1`. */
export const listRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  for (const kind of LIST_KINDS) {
    app.post(
      `/list/${LIST_KIND_REGISTRY[kind].plural}`,
      {
        config: { scopes: ['lists:write'] },
        schema: {
          summary: `Create a ${kind} list`,
          tags: TAGS,
          body: LIST_CREATE_BODY_SCHEMAS[kind],
          response: {
            201: listResourceDocumentSchema,
            ...problemResponses(400, 401, 403, 409, 422),
          },
        },
      },
      async (request, reply) => {
        const document = await createList(
          deps,
          actingOf(request),
          kind,
          request.body.data.attributes,
        );
        return reply.code(201).send(document);
      },
    );
  }

  app.get(
    '/lists',
    {
      config: { scopes: ['lists:read'] },
      schema: {
        summary: 'List the lists',
        description: 'C97.1: newest first. `filter[type]` is ours.',
        tags: TAGS,
        querystring: listListsQuerySchema,
        response: { 200: listResourceListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => listLists(deps, actingOf(request), request.query),
  );

  app.post(
    '/lists/match',
    {
      config: { scopes: ['lists:read'] },
      schema: {
        summary: 'Match values against lists on demand',
        description:
          'C99.4: exact, CIDR and radius methods only; fuzzy, face and background lists answer ' +
          '`unscreened` with `method_not_on_demand`. Answers `matches`, `unscreened` and ' +
          '`not-applicable`, and writes no record. Needs `pii:view` (P11).',
        tags: TAGS,
        body: matchListsBodySchema,
        response: { 200: matchListsResponseSchema, ...problemResponses(400, 401, 403, 422, 429) },
      },
    },
    (request) => {
      // C97.3, P11: it tells whether a value is listed. 403 first, as a report's dismissal.
      requirePiiView(requirePrincipal(request));
      return matchLists(deps, actingOf(request), request.body.data.attributes);
    },
  );

  app.get(
    '/lists/:id',
    {
      config: { scopes: ['lists:read'] },
      schema: {
        summary: 'Fetch a list',
        tags: TAGS,
        params: listParams,
        response: { 200: listResourceDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    (request) => getListDocument(deps, actingOf(request), request.params.id),
  );

  app.patch(
    '/lists/:id',
    {
      config: { scopes: ['lists:write'] },
      schema: {
        summary: 'Change a list',
        description:
          'C97.1 (ours): `name`, `item-retention-days`, `screen-at-completion` and ' +
          '`use-for-compromised-ids`.',
        tags: TAGS,
        params: listParams,
        body: updateListBodySchema,
        response: { 200: listResourceDocumentSchema, ...problemResponses(400, 401, 403, 404, 422) },
      },
    },
    (request) =>
      updateList(deps, actingOf(request), request.params.id, request.body.data.attributes),
  );

  app.delete(
    '/lists/:id',
    {
      config: { scopes: ['lists:write'] },
      schema: {
        summary: 'Archive a list',
        tags: TAGS,
        params: listParams,
        response: { 200: listResourceDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    (request) => archiveList(deps, actingOf(request), request.params.id),
  );

  done();
};

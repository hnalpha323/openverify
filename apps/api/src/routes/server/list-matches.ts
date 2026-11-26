/**
 * C99.3 (Workflow 7B): the list match routes under `/api/v1`: `GET /list-matches`, `GET /:id` and
 * `POST /:id/dismiss` (`lists:write`). The schemas and scopes are frozen (Stage 1b (L),
 * `foundation-7b`); `api-lists` owns this file. The handlers are `services/lists/matches.ts`.
 * `matched-value` and `reason` are masked without `pii:view`.
 */
import {
  dismissListMatchBodySchema,
  idSchema,
  listListMatchesQuerySchema,
  listMatchDocumentSchema,
  listMatchListDocumentSchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  dismissListMatch,
  getListMatchDocument,
  listListMatches,
} from '../../services/lists/matches.js';
import { actingOf } from './inquiries.js';

const TAGS = ['list-matches'];
const params = z.object({ id: idSchema('lmt') });

/** C99.3 list match routes, under `/api/v1`. */
export const listMatchRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.get(
    '/list-matches',
    {
      config: { scopes: ['lists:read'] },
      schema: {
        summary: 'List the list matches',
        tags: TAGS,
        querystring: listListMatchesQuerySchema,
        response: { 200: listMatchListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => listListMatches(deps, actingOf(request), request.query),
  );

  app.get(
    '/list-matches/:id',
    {
      config: { scopes: ['lists:read'] },
      schema: {
        summary: 'Fetch a list match',
        tags: TAGS,
        params,
        response: { 200: listMatchDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    (request) => getListMatchDocument(deps, actingOf(request), request.params.id),
  );

  app.post(
    '/list-matches/:id/dismiss',
    {
      config: { scopes: ['lists:write'] },
      schema: {
        summary: 'Dismiss a list match',
        tags: TAGS,
        params,
        body: dismissListMatchBodySchema,
        response: { 200: listMatchDocumentSchema, ...problemResponses(400, 401, 403, 404, 409) },
      },
    },
    (request) =>
      dismissListMatch(deps, actingOf(request), request.params.id, request.body.data.attributes),
  );

  done();
};

/**
 * C102.1 (Workflow 7B): the graph query template routes under `/api/v1`: create, list, get, update
 * the name, and archive by `DELETE`. `graph:read` for every `GET`, `graph:write` for every write
 * (P11, F29). The schemas and scopes are frozen (Stage 1b (G), `foundation-7b`); `api-graph` owns
 * this file and builds the handlers (`services/graph/templates.ts`), which answer 501 until then.
 */
import {
  createGraphQueryTemplateBodySchema,
  graphQueryTemplateDocumentSchema,
  graphQueryTemplateListDocumentSchema,
  idSchema,
  listGraphQueryTemplatesQuerySchema,
  updateGraphQueryTemplateBodySchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  archiveGraphQueryTemplate,
  createGraphQueryTemplate,
  getGraphQueryTemplateDocument,
  listGraphQueryTemplates,
  updateGraphQueryTemplate,
} from '../../services/graph/templates.js';
import { graphActingOf } from './graph-queries.js';

const TAGS = ['graph-query-templates'];
const params = z.object({ id: idSchema('grqt') });

/** C102.1 graph query template routes, under `/api/v1`. */
export const graphQueryTemplateRoutes: FastifyPluginCallbackZod<ApiDependencies> = (
  app,
  deps,
  done,
) => {
  app.post(
    '/graph-query-templates',
    {
      config: { scopes: ['graph:write'] },
      schema: {
        summary: 'Create a graph query template',
        description:
          'C102.1: a draft version comes with it. Values are bound by `{{param}}`, never ' +
          'interpreted: no SQL, Cypher or expression text comes from a caller.',
        tags: TAGS,
        body: createGraphQueryTemplateBodySchema,
        response: {
          201: graphQueryTemplateDocumentSchema,
          ...problemResponses(400, 401, 403, 422),
        },
      },
    },
    async (request, reply) => {
      const document = await createGraphQueryTemplate(
        deps,
        graphActingOf(request),
        request.body.data.attributes,
      );
      return reply.code(201).send(document);
    },
  );

  app.get(
    '/graph-query-templates',
    {
      config: { scopes: ['graph:read'] },
      schema: {
        summary: 'List the graph query templates',
        tags: TAGS,
        querystring: listGraphQueryTemplatesQuerySchema,
        response: {
          200: graphQueryTemplateListDocumentSchema,
          ...problemResponses(400, 401, 403),
        },
      },
    },
    (request) => listGraphQueryTemplates(deps, graphActingOf(request), request.query),
  );

  app.get(
    '/graph-query-templates/:id',
    {
      config: { scopes: ['graph:read'] },
      schema: {
        summary: 'Fetch a graph query template',
        tags: TAGS,
        params,
        response: {
          200: graphQueryTemplateDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) => getGraphQueryTemplateDocument(deps, graphActingOf(request), request.params.id),
  );

  app.patch(
    '/graph-query-templates/:id',
    {
      config: { scopes: ['graph:write'] },
      schema: {
        summary: 'Rename a graph query template',
        description: 'C102.1: the name only; the config is a version’s.',
        tags: TAGS,
        params,
        body: updateGraphQueryTemplateBodySchema,
        response: {
          200: graphQueryTemplateDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) =>
      updateGraphQueryTemplate(
        deps,
        graphActingOf(request),
        request.params.id,
        request.body.data.attributes,
      ),
  );

  app.delete(
    '/graph-query-templates/:id',
    {
      config: { scopes: ['graph:write'] },
      schema: {
        summary: 'Archive a graph query template',
        description: 'C102.1: an archived template runs no new query. Its queries stay.',
        tags: TAGS,
        params,
        response: {
          200: graphQueryTemplateDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) => archiveGraphQueryTemplate(deps, graphActingOf(request), request.params.id),
  );

  done();
};

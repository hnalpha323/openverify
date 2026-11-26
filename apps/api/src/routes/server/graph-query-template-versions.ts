/**
 * C102.1, C102.2 (Workflow 7B): the graph query template version routes under `/api/v1`: create a
 * draft, get, update a draft, publish. `graph:read` to read, `graph:write` to write (P11, F29).
 * Publishing refuses a weak kind without `include-weak-kinds`, the flag above 4 hops, and an
 * unbound parameter (`graphTemplateConfigProblems`). The schemas and scopes are frozen (Stage 1b
 * (G), `foundation-7b`); `api-graph` owns this file and builds the handlers
 * (`services/graph/versions.ts`), which answer 501 until then.
 */
import {
  createGraphQueryTemplateVersionBodySchema,
  graphQueryTemplateVersionDocumentSchema,
  graphQueryTemplateVersionListDocumentSchema,
  idSchema,
  listGraphQueryTemplateVersionsQuerySchema,
  publishGraphQueryTemplateVersionBodySchema,
  updateGraphQueryTemplateVersionBodySchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  createGraphQueryTemplateVersion,
  getGraphQueryTemplateVersionDocument,
  listGraphQueryTemplateVersions,
  publishGraphQueryTemplateVersion,
  updateGraphQueryTemplateVersion,
} from '../../services/graph/versions.js';
import { graphActingOf } from './graph-queries.js';
import { optionalBody } from './inquiries.js';

const TAGS = ['graph-query-templates'];
const params = z.object({ id: idSchema('grqtv') });

/** C102.1 graph query template version routes, under `/api/v1`. */
export const graphQueryTemplateVersionRoutes: FastifyPluginCallbackZod<ApiDependencies> = (
  app,
  deps,
  done,
) => {
  app.post(
    '/graph-query-template-versions',
    {
      config: { scopes: ['graph:write'] },
      schema: {
        summary: 'Create a draft graph query template version',
        tags: TAGS,
        body: createGraphQueryTemplateVersionBodySchema,
        response: {
          201: graphQueryTemplateVersionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    async (request, reply) => {
      const document = await createGraphQueryTemplateVersion(
        deps,
        graphActingOf(request),
        request.body.data.attributes,
      );
      return reply.code(201).send(document);
    },
  );

  app.get(
    '/graph-query-template-versions',
    {
      config: { scopes: ['graph:read'] },
      schema: {
        summary: 'List graph query template versions',
        description:
          'Newest first. `filter[graph-query-template-id]` narrows it to one template, the way ' +
          'inquiry template versions are listed.',
        tags: TAGS,
        querystring: listGraphQueryTemplateVersionsQuerySchema,
        response: {
          200: graphQueryTemplateVersionListDocumentSchema,
          ...problemResponses(400, 401, 403),
        },
      },
    },
    (request) => listGraphQueryTemplateVersions(deps, graphActingOf(request), request.query),
  );

  app.get(
    '/graph-query-template-versions/:id',
    {
      config: { scopes: ['graph:read'] },
      schema: {
        summary: 'Fetch a graph query template version',
        tags: TAGS,
        params,
        response: {
          200: graphQueryTemplateVersionDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) =>
      getGraphQueryTemplateVersionDocument(deps, graphActingOf(request), request.params.id),
  );

  app.patch(
    '/graph-query-template-versions/:id',
    {
      config: { scopes: ['graph:write'] },
      schema: {
        summary: 'Change a draft graph query template version',
        tags: TAGS,
        params,
        body: updateGraphQueryTemplateVersionBodySchema,
        response: {
          200: graphQueryTemplateVersionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409),
        },
      },
    },
    (request) =>
      updateGraphQueryTemplateVersion(
        deps,
        graphActingOf(request),
        request.params.id,
        request.body.data.attributes,
      ),
  );

  app.post(
    '/graph-query-template-versions/:id/publish',
    {
      config: { scopes: ['graph:write'] },
      schema: {
        summary: 'Publish a graph query template version',
        description:
          'C102.1, C102.2: under the template lock, superseding the published version. Refuses ' +
          '`weak_kind_not_allowed` and `graph_parameter_unbound` with their pointers.',
        tags: TAGS,
        params,
        body: optionalBody(publishGraphQueryTemplateVersionBodySchema),
        response: {
          200: graphQueryTemplateVersionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    (request) => publishGraphQueryTemplateVersion(deps, graphActingOf(request), request.params.id),
  );

  done();
};

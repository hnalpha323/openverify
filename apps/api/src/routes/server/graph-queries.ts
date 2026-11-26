/**
 * C102.4, C102.6, C103 (Workflow 7B): the graph query routes under `/api/v1`.
 *
 * - `POST /graph-queries` (`graph:write`; a person-identifying parameter needs `pii:view` too, P11;
 *   policy `graph-queries`): 201 with the query, `submitted`, or the result with `meta.run-sync`.
 * - `GET /graph-queries` (cursor) and `GET /graph-queries/:id` (`graph:read`).
 * - `POST /graph-queries/:id/rerun` and `/cancel` (`graph:write`).
 * - `GET /graph-queries/:id/nodes/:nodeId/value` (`graph:read` and `pii:view`; policy
 *   `graph-unmask`): the audited unmask of one node (P17). Fastify reads a hyphen in a param as a
 *   separator, so the plan's `:node-id` is `:nodeId`.
 * - `POST /graph-queries/:id/actions` (`graph:read` and each action's own scope, V18): the JSON
 *   answer, or the export as `text/csv`.
 * - `POST /graph-queries/:id/nodes/:nodeId/expand` (`graph:write`; `pii:view` for a person node;
 *   policy `graph-queries`): a new query from a stored property node (owner decision 20 after
 *   Workflow 7B; contracts B42), frozen by `foundation-9b` (Stage 1b (C)) on the stub of
 *   `services/graph/expand.ts`, which answers 501 until `integration-9b` builds it.
 *
 * `graph:read` is not for viewers (`NOT_FOR_VIEWERS`, P11). The schemas and scopes are frozen
 * (Stage 1b (G), `foundation-7b`); `api-graph` owns this file and builds the handlers
 * (`services/graph/{queries,node-values,actions}.ts`), which answer 501 until then.
 */
import {
  cancelGraphQueryBodySchema,
  createGraphQueryBodySchema,
  expandGraphNodeBodySchema,
  expandGraphNodeParamsSchema,
  graphNodeIdSchema,
  graphNodeValueDocumentSchema,
  graphQueryActionBodySchema,
  graphQueryActionResultDocumentSchema,
  graphQueryDocumentSchema,
  graphQueryListDocumentSchema,
  idSchema,
  listGraphQueriesQuerySchema,
  rerunGraphQueryBodySchema,
} from '@openverify/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requirePiiView } from '../../auth/pii.js';
import { problemResponses } from '../../plugins/openapi.js';
import { requirePrincipal } from '../../plugins/principal-auth.js';
import type { ApiDependencies } from '../../services/context.js';
import type { GraphActing } from '../../services/graph/acting.js';
import { runGraphQueryAction } from '../../services/graph/actions.js';
import { expandGraphNode } from '../../services/graph/expand.js';
import { getGraphNodeValue } from '../../services/graph/node-values.js';
import {
  cancelGraphQuery,
  createGraphQuery,
  getGraphQueryDocument,
  listGraphQueries,
  rerunGraphQuery,
} from '../../services/graph/queries.js';
import { actingOf, optionalBody } from './inquiries.js';

const TAGS = ['graph-queries'];
const params = z.object({ id: idSchema('grphq') });
const nodeParams = z.object({ id: idSchema('grphq'), nodeId: graphNodeIdSchema });

/** The acting principal of a graph route, with the principal its services check scopes on. */
export function graphActingOf(request: FastifyRequest): GraphActing {
  return { ...actingOf(request), principal: requirePrincipal(request) };
}

/** C102.4, C102.6, C103 graph query routes, under `/api/v1`. */
export const graphQueryRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.post(
    '/graph-queries',
    {
      config: { scopes: ['graph:write'] },
      schema: {
        summary: 'Run a graph query',
        description:
          'C102.4: runs a published template version with `parameter-map` bound. A parameter ' +
          'that identifies a person needs `pii:view` too (P11). Asynchronous runs answer ' +
          '`submitted`; `meta.run-sync` answers the result within 10 s, or what was gathered ' +
          'with `timed_out`, at most 2 at once per environment (429 beyond).',
        tags: TAGS,
        body: createGraphQueryBodySchema,
        response: {
          201: graphQueryDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422, 429),
        },
      },
    },
    async (request, reply) => {
      const document = await createGraphQuery(deps, graphActingOf(request), request.body);
      return reply.code(201).send(document);
    },
  );

  app.get(
    '/graph-queries',
    {
      config: { scopes: ['graph:read'] },
      schema: {
        summary: 'List the graph queries',
        description: 'Ours: newest first, with a cursor.',
        tags: TAGS,
        querystring: listGraphQueriesQuerySchema,
        response: { 200: graphQueryListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => listGraphQueries(deps, graphActingOf(request), request.query),
  );

  app.get(
    '/graph-queries/:id',
    {
      config: { scopes: ['graph:read'] },
      schema: {
        summary: 'Fetch a graph query',
        tags: TAGS,
        params,
        response: { 200: graphQueryDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    (request) => getGraphQueryDocument(deps, graphActingOf(request), request.params.id),
  );

  app.post(
    '/graph-queries/:id/rerun',
    {
      config: { scopes: ['graph:write'] },
      schema: {
        summary: 'Run a graph query again',
        description: 'Ours: emits `graph-query.reran`, then the terminal event.',
        tags: TAGS,
        params,
        body: optionalBody(rerunGraphQueryBodySchema),
        response: {
          200: graphQueryDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 410, 429),
        },
      },
    },
    (request) => rerunGraphQuery(deps, graphActingOf(request), request.params.id),
  );

  app.post(
    '/graph-queries/:id/cancel',
    {
      config: { scopes: ['graph:write'] },
      schema: {
        summary: 'Cancel a submitted graph query',
        description: 'Ours: a `submitted` query only (409 `graph_query_not_cancellable`).',
        tags: TAGS,
        params,
        body: optionalBody(cancelGraphQueryBodySchema),
        response: { 200: graphQueryDocumentSchema, ...problemResponses(400, 401, 403, 404, 409) },
      },
    },
    (request) => cancelGraphQuery(deps, graphActingOf(request), request.params.id),
  );

  app.get(
    '/graph-queries/:id/nodes/:nodeId/value',
    {
      config: { scopes: ['graph:read'] },
      schema: {
        summary: 'Unmask one node of a graph query result',
        description:
          'C102.6 (P17): the plaintext of one property node, opened from one source among the ' +
          'result’s accounts and audited. Needs `pii:view`; policy `graph-unmask`.',
        tags: TAGS,
        params: nodeParams,
        response: {
          200: graphNodeValueDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 410, 429),
        },
      },
    },
    (request) => {
      requirePiiView(requirePrincipal(request));
      return getGraphNodeValue(
        deps,
        graphActingOf(request),
        request.params.id,
        request.params.nodeId,
      );
    },
  );

  app.post(
    '/graph-queries/:id/nodes/:nodeId/expand',
    {
      config: { scopes: ['graph:write'] },
      schema: {
        summary: 'Start a graph query from a node of a result',
        description:
          'Owner decision 20 after Workflow 7B: a new query from a stored property node of the ' +
          'source query’s result, as `POST /graph-queries` runs one. A node whose kind identifies ' +
          'a person needs `pii:view` too; an account node is refused (run a template with ' +
          '`account_id` bound); policy `graph-queries`. `meta.run-sync` answers the result.',
        tags: TAGS,
        params: expandGraphNodeParamsSchema,
        body: optionalBody(expandGraphNodeBodySchema),
        response: {
          201: graphQueryDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 410, 422, 429),
        },
      },
    },
    async (request, reply) => {
      const document = await expandGraphNode(
        deps,
        graphActingOf(request),
        request.params.id,
        request.params.nodeId,
        request.body ?? {},
      );
      return reply.code(201).send(document);
    },
  );

  app.post(
    '/graph-queries/:id/actions',
    {
      config: { scopes: ['graph:read'] },
      schema: {
        summary: 'Act on accounts of a graph query result',
        description:
          'C103: on the intersection of the selection with the stored result. Each action ' +
          'checks its own scope (V18); a non-preview call needs an `Idempotency-Key`. `export` ' +
          'answers `text/csv`, at most 2,000 rows.',
        tags: TAGS,
        params,
        body: graphQueryActionBodySchema,
        response: {
          200: {
            description: 'A preview’s counts, the per-account outcomes, or the export.',
            content: {
              'application/json': { schema: graphQueryActionResultDocumentSchema },
              'text/csv': { schema: z.string() },
            },
          },
          ...problemResponses(400, 401, 403, 404, 409, 410, 422),
        },
      },
    },
    async (request, reply) => {
      const answer = await runGraphQueryAction(
        deps,
        graphActingOf(request),
        request.params.id,
        request.body.data.attributes,
        { idempotencyKey: request.headers['idempotency-key'] as string | undefined },
      );
      return answer.kind === 'csv'
        ? reply.code(200).header('content-type', 'text/csv; charset=utf-8').send(answer.csv)
        : reply.code(200).send(answer.document);
    },
  );

  done();
};

/**
 * C231 (Workflow 11A): Connect connections on the server API, under `/api/v1`, organisation-scoped
 * (C231.9: the writes are refused from a sandbox key and from a user without `environments:production`
 * by `api-connect`'s service):
 *
 * - `POST /connect/connections` (the source creates: `destination-organization-id`, `share-policy`);
 * - `GET /connect/connections` and `GET /connect/connections/:id` (both directions);
 * - `POST /connect/connections/:id/deactivate` (either side), `/reactivate` (the source) and
 *   `/share-policy` (the source: version n+1).
 *
 * Activation is the destination's, in the console only (`routes/dashboard/connect.ts`). A body whose
 * only failures lie in its share policy answers 422 `share_policy_invalid` (Stage 1a amendment 27).
 * While the install switch is off every route answers the one generic 404 (C231.10).
 *
 * Frozen by `foundation-11a` (Stage 1b (C)) with the contract schemas; built by `api-connect`
 * (`services/connect/connections.ts`). integration-11a dropped the 501 from the documented problems.
 */
import {
  changeSharePolicyBodySchema,
  connectionDocumentSchema,
  connectionListDocumentSchema,
  connectionParamsSchema,
  createConnectionBodySchema,
  listConnectionsQuerySchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { requirePrincipal } from '../../plugins/principal-auth.js';
import { problemResponses } from '../../plugins/openapi.js';
import {
  changeSharePolicy,
  createConnectionFor,
  deactivateConnection,
  getConnectionDocument,
  listConnections,
  reactivateConnection,
  type ConnectActing,
} from '../../services/connect/connections.js';
import { refuseInvalidSharePolicyBody } from '../../services/connect/share-policy-validation.js';
import { expireTokensOnDeactivation } from '../../services/connect/share-tokens.js';
import { connectSwitchHook } from '../../services/connect/switch.js';
import type { ApiDependencies } from '../../services/context.js';
import { actingOf } from './inquiries.js';

/** The caller of a Connect route: its principal, service context and audit actor. */
export function connectActingOf(request: FastifyRequest): ConnectActing {
  const acting = actingOf(request);
  return {
    principal: requirePrincipal(request),
    ctx: acting.ctx,
    actor: acting.actor,
    environmentKind: acting.environmentKind,
  };
}

const TAGS = ['connect'];

/** C231 connection routes, under `/api/v1`. */
export const connectConnectionRoutes: FastifyPluginCallbackZod<ApiDependencies> = (
  app,
  deps,
  done,
) => {
  app.addHook('onRequest', connectSwitchHook(deps.connect));

  app.post(
    '/connect/connections',
    {
      config: { scopes: ['connect-connections:write'] },
      attachValidation: true,
      schema: {
        summary: 'Create a connection',
        description:
          'C231.1: the source names the destination organisation and a share policy (version 1); ' +
          '201 `pending`. 422 `destination_not_found` for an unknown organisation or one that has ' +
          'not opted in to inbound connections (byte-identical); 409 `connection_exists`; 422 ' +
          '`share_policy_invalid` with the JSON pointers of the policy issues.',
        tags: TAGS,
        body: createConnectionBodySchema,
        response: {
          201: connectionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    async (request, reply) => {
      refuseInvalidSharePolicyBody(request, createConnectionBodySchema);
      const document = await createConnectionFor(
        deps,
        connectActingOf(request),
        request.body.data.attributes,
      );
      return reply.code(201).send(document);
    },
  );

  app.get(
    '/connect/connections',
    {
      config: { scopes: ['connect-connections:read'] },
      schema: {
        summary: 'List connections',
        description:
          'C231.2: both directions, newest first (C1), filtered by `status` and ' +
          '`destination-organization-id`.',
        tags: TAGS,
        querystring: listConnectionsQuerySchema,
        response: {
          200: connectionListDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) => listConnections(deps, connectActingOf(request), request.query),
  );

  app.get(
    '/connect/connections/:id',
    {
      config: { scopes: ['connect-connections:read'] },
      schema: {
        summary: 'Retrieve a connection',
        description:
          'C230.2, C231.2: as the caller’s side sees it; a third organisation gets the generic 404.',
        tags: TAGS,
        params: connectionParamsSchema,
        response: { 200: connectionDocumentSchema, ...problemResponses(401, 403, 404) },
      },
    },
    (request) => getConnectionDocument(deps, connectActingOf(request), request.params.id),
  );

  app.post(
    '/connect/connections/:id/deactivate',
    {
      config: { scopes: ['connect-connections:write'] },
      schema: {
        summary: 'Deactivate a connection',
        description:
          'C231.4: either side; `pending` or `active` to `inactive`, and every `created` token of ' +
          'the connection expires (`connection_deactivated`) in the same transaction. 409 ' +
          '`connection_not_active` when already inactive.',
        tags: TAGS,
        params: connectionParamsSchema,
        response: {
          200: connectionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409),
        },
      },
    },
    (request) =>
      deactivateConnection(
        deps,
        connectActingOf(request),
        request.params.id,
        expireTokensOnDeactivation(deps),
      ),
  );

  app.post(
    '/connect/connections/:id/reactivate',
    {
      config: { scopes: ['connect-connections:write'] },
      schema: {
        summary: 'Reactivate a connection',
        description:
          'C231.5: the source only; `inactive` to `pending`, and the destination must activate ' +
          'again.',
        tags: TAGS,
        params: connectionParamsSchema,
        response: {
          200: connectionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409),
        },
      },
    },
    (request) => reactivateConnection(deps, connectActingOf(request), request.params.id),
  );

  app.post(
    '/connect/connections/:id/share-policy',
    {
      config: { scopes: ['connect-connections:write'] },
      attachValidation: true,
      schema: {
        summary: 'Change a connection’s share policy',
        description:
          'C231.6: the source writes version n+1; an `active` connection returns to `pending` ' +
          'until the destination accepts it; a `created` token keeps its version. 422 ' +
          '`share_policy_invalid` with the JSON pointers of the policy issues.',
        tags: TAGS,
        params: connectionParamsSchema,
        body: changeSharePolicyBodySchema,
        response: {
          200: connectionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    (request) => {
      refuseInvalidSharePolicyBody(request, changeSharePolicyBodySchema);
      return changeSharePolicy(
        deps,
        connectActingOf(request),
        request.params.id,
        request.body.data.attributes['share-policy'],
      );
    },
  );

  done();
};

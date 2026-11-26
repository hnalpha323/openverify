/**
 * C232, C233 (Workflow 11A): Connect share tokens on the server API, under `/api/v1`:
 *
 * - `POST /connect/share-tokens` (the source: `connection-id`, `source-id`, `consent-record-id`,
 *   `expires-in-seconds`; every C232.1 check in order);
 * - `GET /connect/share-tokens` (outbound and inbound) and `GET /connect/share-tokens/:id` (as each
 *   side sees it); with `peek-source-data=true` the peek of C233 (the destination, scope
 *   `connect-share-tokens:peek` and, for a user, `pii:view`; checked by `api-connect`), under the rate
 *   policy `connect-peek`, which fails closed (503 `connect_peek_unavailable`);
 * - `POST /connect/share-tokens/:id/expire` (the source).
 *
 * The token id is a handle, not a secret (C232.8): every refusal of a token the caller may not see is
 * the one generic 404. While the install switch is off every route answers it (C231.10).
 *
 * Frozen by `foundation-11a` (Stage 1b (C)); built by `api-connect` (`services/connect/share-tokens.ts`).
 * The redeem route is `connect-redeem.ts` (`api-redeem`'s).
 */
import {
  createShareTokenBodySchema,
  getShareTokenQuerySchema,
  listShareTokensQuerySchema,
  shareTokenDocumentSchema,
  shareTokenListDocumentSchema,
  shareTokenParamsSchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { problemResponses } from '../../plugins/openapi.js';
import { requirePrincipal } from '../../plugins/principal-auth.js';
import { enforceConnectPolicy } from '../../services/connect/rate-limits.js';
import {
  createShareTokenFor,
  expireShareToken,
  getShareTokenDocument,
  listShareTokens,
  peekShareToken,
} from '../../services/connect/share-tokens.js';
import { connectSwitchHook } from '../../services/connect/switch.js';
import type { ApiDependencies } from '../../services/context.js';
import { connectActingOf } from './connect-connections.js';

const TAGS = ['connect'];

/** C232, C233 share-token routes, under `/api/v1`. */
export const connectShareTokenRoutes: FastifyPluginCallbackZod<ApiDependencies> = (
  app,
  deps,
  done,
) => {
  app.addHook('onRequest', connectSwitchHook(deps.connect));

  app.post(
    '/connect/share-tokens',
    {
      config: { scopes: ['connect-share-tokens:write'] },
      schema: {
        summary: 'Create a share token',
        description:
          'C232.1: in the source environment, over an `active` connection, citing a source-side ' +
          'consent record that covers the share (422 `consent_required` with its `reason`); 201 ' +
          '`created`, `direction: outbound`, with the categories fixed at creation.',
        tags: TAGS,
        body: createShareTokenBodySchema,
        response: {
          201: shareTokenDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    async (request, reply) => {
      const document = await createShareTokenFor(
        deps,
        connectActingOf(request),
        request.body.data.attributes,
      );
      return reply.code(201).send(document);
    },
  );

  app.get(
    '/connect/share-tokens',
    {
      config: { scopes: ['connect-share-tokens:read'] },
      schema: {
        summary: 'List share tokens',
        description:
          'C232.2: the environment’s outbound tokens and the tokens inbound to it, newest first ' +
          '(C1), filtered by `connection-id`, `status` and `direction`; never `source-data`.',
        tags: TAGS,
        querystring: listShareTokensQuerySchema,
        response: {
          200: shareTokenListDocumentSchema,
          ...problemResponses(400, 401, 403),
        },
      },
    },
    (request) => listShareTokens(deps, connectActingOf(request), request.query),
  );

  app.get(
    '/connect/share-tokens/:id',
    {
      config: { scopes: ['connect-share-tokens:read'] },
      schema: {
        summary: 'Retrieve a share token',
        description:
          'C232.3: as the caller’s side sees it. With `peek-source-data=true` (C233), the ' +
          'destination’s peek in the `{visibility, value}` envelope: scope ' +
          '`connect-share-tokens:peek` (and `pii:view` for a user), a `created` token over an ' +
          '`active` connection, at most 10 peeks per token (429 `share_token_peek_limit`), 60 a ' +
          'minute (`connect-peek`, failing closed: 503 `connect_peek_unavailable`).',
        tags: TAGS,
        params: shareTokenParamsSchema,
        querystring: getShareTokenQuerySchema,
        response: {
          200: shareTokenDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 429, 503),
        },
      },
    },
    async (request) => {
      if (request.query['peek-source-data'] === 'true') {
        await enforceConnectPolicy(deps.rateLimiter, 'connect-peek', requirePrincipal(request));
        return peekShareToken(deps, connectActingOf(request), request.params.id);
      }
      return getShareTokenDocument(deps, connectActingOf(request), request.params.id);
    },
  );

  app.post(
    '/connect/share-tokens/:id/expire',
    {
      config: { scopes: ['connect-share-tokens:write'] },
      schema: {
        summary: 'Expire a share token',
        description:
          'C232.4: the source only; `created` to `expired` (`source_expired`); 409 ' +
          '`share_token_not_expirable` in any other status.',
        tags: TAGS,
        params: shareTokenParamsSchema,
        response: {
          200: shareTokenDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409),
        },
      },
    },
    (request) => expireShareToken(deps, connectActingOf(request), request.params.id),
  );

  done();
};

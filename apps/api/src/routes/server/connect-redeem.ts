/**
 * C234.1 (Workflow 11A): `POST /api/v1/connect/share-tokens/:id/redeem`, the destination's
 * redemption: clone (no `destination-id`) or hydrate (with it), with the field mappings, the account
 * linking and the destination-side consent record; the synchronous checks under the token row lock,
 * then 202 with the token `pending` and the `connect-redeem` job. 422 `share_redeem_mode_invalid` and
 * `share_redeem_meta_conflict` come from the route's rules (`shareRedeemPairAllowed`,
 * `shareRedeemMetaConflicts`), never from validation. Rate policy `connect-redeem` (60 a minute per
 * principal and environment). While the install switch is off it answers the one generic 404.
 *
 * Frozen by `foundation-11a` (Stage 1b (C)); built by `api-redeem` over `redeemShareToken`
 * (`services/connect/redeem.ts`), over `cross-tenant.ts`'s `markInboundShareToken` (integration-11a).
 */
import {
  redeemShareTokenBodySchema,
  shareTokenDocumentSchema,
  shareTokenParamsSchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { problemResponses } from '../../plugins/openapi.js';
import { requirePrincipal } from '../../plugins/principal-auth.js';
import { enforceConnectPolicy } from '../../services/connect/rate-limits.js';
import { redeemShareToken } from '../../services/connect/redeem.js';
import { connectSwitchHook } from '../../services/connect/switch.js';
import type { ApiDependencies } from '../../services/context.js';
import { actingOf } from './inquiries.js';

/** C234.1 redeem route, under `/api/v1`. */
export const connectRedeemRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.addHook('onRequest', connectSwitchHook(deps.connect));

  app.post(
    '/connect/share-tokens/:id/redeem',
    {
      config: { scopes: ['connect-share-tokens:redeem'] },
      schema: {
        summary: 'Redeem a share token',
        description:
          'C234.1: the destination redeems a `created` token: a clone of an inquiry or a ' +
          'verification, or a hydrate of an account, inquiry or transaction, with its own consent ' +
          'record (`meta.destination-consent-record-id`); 202 with the token `pending`, and the job ' +
          'copies what the token’s policy version allows. 60 a minute (`connect-redeem`).',
        tags: ['connect'],
        params: shareTokenParamsSchema,
        body: redeemShareTokenBodySchema,
        response: {
          202: shareTokenDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422, 429),
        },
      },
    },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      await enforceConnectPolicy(deps.rateLimiter, 'connect-redeem', principal);
      const document = await redeemShareToken(
        deps,
        { ...actingOf(request), principal },
        request.params.id,
        request.body,
      );
      return reply.code(202).send(document);
    },
  );

  done();
};

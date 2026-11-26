/**
 * C57.2: `POST /api/v1/flow/verifications/:id/crypto-challenges`, the server-issued message a
 * wallet signs. The schema is frozen (C54.2); `api-crypto` built the handler over its
 * `services/crypto-challenges/`.
 */
import {
  createCryptoChallengeBodySchema,
  flowCryptoChallengeResponseSchema,
  idSchema,
} from '@openverify/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireFlowSession } from '../../auth/flow-session.js';
import { problemResponses } from '../../plugins/openapi.js';
import { dependenciesOf, type ApiDependencies } from '../../services/context.js';
import { createFlowCryptoChallenge } from '../../services/crypto-challenges/index.js';
import { FLOW_TAGS, SESSION_TOKEN_SECURITY } from './openapi.js';

export const cryptoWalletRoutes: FastifyPluginAsyncZod<ApiDependencies> = (app, options) => {
  const deps = dependenciesOf(options);
  app.post(
    '/verifications/:id/crypto-challenges',
    {
      schema: {
        summary: 'Create a wallet challenge',
        description:
          'C57.2: the message to sign for `wallet-address` on `chain-id`, returned once with its ' +
          'id and expiry (600 s); a new challenge supersedes the open one. 422 ' +
          '`crypto_chain_not_offered`, `crypto_address_invalid` or ' +
          '`crypto_expected_address_mismatch`; the 11th challenge cancels the verification (a ' +
          'retryable attempt) and answers 409 `crypto_challenge_invalid`. Requires consent.',
        tags: FLOW_TAGS,
        security: SESSION_TOKEN_SECURITY,
        params: z.object({ id: idSchema('ver') }),
        body: createCryptoChallengeBodySchema,
        response: {
          201: flowCryptoChallengeResponseSchema,
          ...problemResponses(400, 401, 404, 409, 410, 422),
        },
      },
    },
    async (request, reply) => {
      const challenge = await createFlowCryptoChallenge(
        deps,
        requireFlowSession(request),
        request.params.id,
        request.body,
      );
      return reply.code(201).send(challenge);
    },
  );
  return Promise.resolve();
};

/**
 * C62.5: `POST /api/v1/flow/verifications/:id/chip-challenges`, the server nonce a chip signs
 * for Active Authentication. The schema is frozen (C54.2); `api-nfc` built the handler over its
 * `services/chip-challenges/`.
 */
import {
  createChipChallengeBodySchema,
  flowChipChallengeResponseSchema,
  idSchema,
} from '@openverify/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireFlowSession } from '../../auth/flow-session.js';
import { problemResponses } from '../../plugins/openapi.js';
import { dependenciesOf, type ApiDependencies } from '../../services/context.js';
import { createFlowChipChallenge } from '../../services/chip-challenges/index.js';
import { FLOW_TAGS, SESSION_TOKEN_SECURITY } from './openapi.js';

export const governmentIdNfcRoutes: FastifyPluginAsyncZod<ApiDependencies> = (app, options) => {
  const deps = dependenciesOf(options);
  app.post(
    '/verifications/:id/chip-challenges',
    {
      schema: {
        summary: 'Create a chip challenge',
        description:
          'C62.5: an 8-byte nonce (16 hex characters) for Active Authentication, returned once ' +
          'with its id and expiry (300 s), stored as SHA-256; the 11th challenge cancels the ' +
          'verification (a retryable attempt). Requires consent.',
        tags: FLOW_TAGS,
        security: SESSION_TOKEN_SECURITY,
        params: z.object({ id: idSchema('ver') }),
        body: createChipChallengeBodySchema,
        response: {
          201: flowChipChallengeResponseSchema,
          ...problemResponses(400, 401, 404, 409, 410, 422),
        },
      },
    },
    async (request, reply) => {
      const challenge = await createFlowChipChallenge(
        deps,
        requireFlowSession(request),
        request.params.id,
      );
      return reply.code(201).send(challenge);
    },
  );
  return Promise.resolve();
};

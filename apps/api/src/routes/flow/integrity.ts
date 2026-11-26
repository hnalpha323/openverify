/**
 * C211.3 (Workflow 10B): the SDK's half of Play Integrity on the flow API, under session
 * authentication and the C12 policy `flow-integrity` (5 an hour per inquiry, both routes together;
 * `plugins/rate-limit.ts`), each with the `flow-session` policy too.
 *
 * - `POST /api/v1/flow/integrity-challenges` (`{}`, 201): one challenge for the inquiry's token, an
 *   `ich_` id, the `request-hash` the device binds its token to (computed by the server) and its
 *   expiry (600 s), once the session asks for a token (`integrity { request: true }`).
 * - `POST /api/v1/flow/integrity-tokens` (`{challenge-id, token}`, 202): the token for the session's
 *   open challenge, sealed for the challenge's row and decoded in the `integrity-decode` job (never in
 *   the request); a challenge unknown, another session's, used or expired answers 409
 *   `integrity_challenge_invalid`. The token is never logged, echoed or served.
 *
 * The schemas were frozen by `foundation-10b` (Stage 1b (I)); `api-integrity` built the routes over
 * `services/device-integrity/challenges.ts`; integration-10b dropped the frozen 501 from their
 * documented problems and regenerated `docs/api/openapi.json`.
 */
import {
  flowIntegrityChallengeBodySchema,
  flowIntegrityChallengeSchema,
  flowIntegrityTokenBodySchema,
  INTEGRITY_TOKEN_MAX_LENGTH,
} from '@openverify/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireFlowSession } from '../../auth/flow-session.js';
import { problemResponses } from '../../plugins/openapi.js';
import { dependenciesOf, type ApiDependencies } from '../../services/context.js';
import {
  acceptIntegrityToken,
  createIntegrityChallenge,
} from '../../services/device-integrity/challenges.js';
import { FLOW_TAGS, SESSION_TOKEN_SECURITY } from './openapi.js';

/** C211.3: the token body's cap: the token (16 KiB) with the challenge id and the JSON around them. */
export const INTEGRITY_TOKEN_MAX_BODY_BYTES = INTEGRITY_TOKEN_MAX_LENGTH + 1024;

export const integrityRoutes: FastifyPluginAsyncZod<ApiDependencies> = (app, options) => {
  const deps = dependenciesOf(options);
  app.post(
    '/integrity-challenges',
    {
      schema: {
        summary: 'Take an integrity challenge',
        description:
          "C211.3: one challenge for the inquiry's Play Integrity token: an `ich_` id, the " +
          '`request-hash` the device binds its token to, and its expiry (600 s). Only while the ' +
          'session asks for a token (`integrity.request`). 5 an hour per inquiry with the token ' +
          'route (`flow-integrity`).',
        tags: FLOW_TAGS,
        security: SESSION_TOKEN_SECURITY,
        body: flowIntegrityChallengeBodySchema,
        response: {
          201: flowIntegrityChallengeSchema,
          ...problemResponses(400, 401, 409, 429),
        },
      },
    },
    async (request, reply) => {
      const challenge = await createIntegrityChallenge(deps, requireFlowSession(request));
      return reply.code(201).send(challenge);
    },
  );

  app.post(
    '/integrity-tokens',
    {
      bodyLimit: INTEGRITY_TOKEN_MAX_BODY_BYTES,
      schema: {
        summary: 'Send an integrity token',
        description:
          "C211.3: the device's token for the session's open challenge, decoded on the server in " +
          'a job (never in this request) and judged there; the token is never echoed or logged. ' +
          '409 `integrity_challenge_invalid` for a challenge unknown, used, expired or another ' +
          "session's. 5 an hour per inquiry with the challenge route (`flow-integrity`).",
        tags: FLOW_TAGS,
        security: SESSION_TOKEN_SECURITY,
        body: flowIntegrityTokenBodySchema,
        response: {
          202: z.null().describe('The token is taken for its challenge and will be decoded.'),
          ...problemResponses(400, 401, 409, 413, 429),
        },
      },
    },
    async (request, reply) => {
      await acceptIntegrityToken(deps, requireFlowSession(request), request.body);
      return reply.code(202).send(null);
    },
  );
  return Promise.resolve();
};

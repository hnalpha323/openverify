/**
 * C207.9 (Phase 10, Workflow 10C): `POST /api/v1/flow/verifications/:id/client-unable`: the
 * session's client says it cannot read a document chip (`nfc_unavailable`, `reader_not_installed`,
 * `nfc_disabled_declined`, `platform_unsupported` or `read_failed`), so the flow takes the `nfc`
 * step's fallback.
 * Under session authentication and the `flow-session` policy. Accepted only for the current step of
 * type `nfc`, at most once per verification (409 `client_unable_not_allowed`).
 *
 * The schema was frozen by `contracts-10c` (Stage 1a (N)); `api-nfc` built it over
 * `services/client-unable.ts`.
 */
import {
  flowClientUnableBodySchema,
  flowClientUnableResponseSchema,
  idSchema,
} from '@openverify/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireFlowSession } from '../../auth/flow-session.js';
import { problemResponses } from '../../plugins/openapi.js';
import { reportClientUnable } from '../../services/client-unable.js';
import { dependenciesOf, type ApiDependencies } from '../../services/context.js';
import { FLOW_TAGS, SESSION_TOKEN_SECURITY } from './openapi.js';

export const clientUnableRoutes: FastifyPluginAsyncZod<ApiDependencies> = (app, options) => {
  const deps = dependenciesOf(options);
  app.post(
    '/verifications/:id/client-unable',
    {
      schema: {
        summary: 'Report that this client cannot read a document chip',
        description:
          'C207.9: the client cannot read a document chip (no NFC hardware, no reader installed, ' +
          'NFC off and declined, or a platform that cannot read one). Self-reported, and never a ' +
          'pass: the verification ends `canceled` and the flow takes the `nfc` step’s fallback. ' +
          'Only for the current step of type `nfc`, once per verification (409 ' +
          '`client_unable_not_allowed`).',
        tags: FLOW_TAGS,
        security: SESSION_TOKEN_SECURITY,
        params: z.object({ id: idSchema('ver') }),
        body: flowClientUnableBodySchema,
        response: {
          200: flowClientUnableResponseSchema,
          ...problemResponses(400, 401, 404, 409, 410, 422, 429),
        },
      },
    },
    async (request, reply) => {
      const answer = await reportClientUnable(
        deps,
        requireFlowSession(request),
        request.params.id,
        request.body,
      );
      return reply.code(200).send(answer);
    },
  );
  return Promise.resolve();
};

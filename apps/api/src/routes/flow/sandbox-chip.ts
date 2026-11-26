/**
 * C208.1 (Phase 10, Workflow 10C): `POST /api/v1/flow/verifications/:id/sandbox-chip`: a synthetic
 * chip's files for the session's NFC verification and challenge, so the NFC screens and the
 * server's checks run end to end without hardware. **Sandbox environments only**: anywhere else
 * the route answers the generic 404, as an unknown route does, with no code of its own. Under
 * session authentication and the C12 policy `flow-sandbox-chip` (10 an hour per inquiry;
 * `plugins/rate-limit.ts`), with `flow-session` too.
 *
 * The schema was frozen by `contracts-10c` (Stage 1a (N)); `api-nfc` built it over
 * `services/sandbox-chip.ts`, whose test-only imports stay behind the environment check below
 * (C208.3).
 */
import {
  flowSandboxChipBodySchema,
  flowSandboxChipResponseSchema,
  idSchema,
} from '@openverify/contracts';
import { getEnvironment } from '@openverify/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireFlowSession } from '../../auth/flow-session.js';
import { NotFoundError } from '../../errors.js';
import { problemResponses } from '../../plugins/openapi.js';
import { dependenciesOf, type ApiDependencies } from '../../services/context.js';
import { createSandboxChip } from '../../services/sandbox-chip.js';
import { FLOW_TAGS, SESSION_TOKEN_SECURITY } from './openapi.js';

/** The route's path below the flow prefix, as the rate limiter and the tests name it. */
export const SANDBOX_CHIP_ROUTE = '/api/v1/flow/verifications/:id/sandbox-chip';

export const sandboxChipRoutes: FastifyPluginAsyncZod<ApiDependencies> = (app, options) => {
  const deps = dependenciesOf(options);
  app.post(
    '/verifications/:id/sandbox-chip',
    {
      schema: {
        summary: 'Take a sandbox test chip (sandbox only)',
        description:
          'C208.1: **sandbox environments only** (404 anywhere else). A synthetic chip for the ' +
          'verification’s challenge: its files as base64, every file but DG2, which the server ' +
          'attaches itself (`dg2-attached`), and the Active Authentication response when the ' +
          'scenario’s chip has a key. It proves the flow and the server’s checks, never a reader. ' +
          '409 `sandbox_chip_anchor_missing` without the sandbox test anchor; 422 ' +
          '`sandbox_chip_scenario_unavailable` for a scenario this server cannot build. 10 an ' +
          'hour per inquiry (`flow-sandbox-chip`).',
        tags: FLOW_TAGS,
        security: SESSION_TOKEN_SECURITY,
        params: z.object({ id: idSchema('ver') }),
        body: flowSandboxChipBodySchema,
        response: {
          200: flowSandboxChipResponseSchema,
          ...problemResponses(400, 401, 404, 409, 410, 422, 429),
        },
      },
    },
    async (request, reply) => {
      const session = requireFlowSession(request);
      const environment = await getEnvironment(deps.db, session.environmentId);
      if (environment?.kind !== 'sandbox') {
        // C208.1: no hint that the route exists; the words of an unknown route.
        throw new NotFoundError(
          `No route matches ${request.method} ${request.url.split('?')[0] ?? ''}.`,
        );
      }
      const answer = await createSandboxChip(deps, session, request.params.id, request.body);
      return reply.code(200).send(answer);
    },
  );
  return Promise.resolve();
};

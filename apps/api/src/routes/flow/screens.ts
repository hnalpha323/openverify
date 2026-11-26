/**
 * C148.5 (Workflow 9A): `POST /api/v1/flow/screens/:stepId/submit`, a screen step's values and the
 * submit button's key, under session authentication and the existing `flow-session` policy (C174.4).
 * Only the current step accepts it (409 `flow_step_not_current`, C151.4); the server validates
 * every value again (`validateInquiryFieldsWrite`), writes `fields`, records the exit through the
 * button's port, advances (`advanceFlowInTx`) and answers the session. `values` is personal data in
 * API logs (`PII_FLOW_SCREEN_ATTRIBUTES`, C174.5). The schema is frozen by `foundation-9a` (Stage 1b
 * (S)); `api-flow-engine` owns this file; the submission is `flow-engine/screen-submission.ts`.
 */
import {
  FLOW_SPEC_HEADER,
  flowScreenParamsSchema,
  parseFlowSpecHeader,
  flowSessionResponseSchema,
  submitFlowScreenBodySchema,
} from '@openverify/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireFlowSession } from '../../auth/flow-session.js';
import { submitFlowScreen } from '../../flow-engine/screen-submission.js';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import { getFlowSession } from '../../services/flow.js';
import { FLOW_TAGS, SESSION_TOKEN_SECURITY } from './openapi.js';

export const screenRoutes: FastifyPluginAsyncZod<ApiDependencies> = (app, deps) => {
  app.post(
    '/screens/:stepId/submit',
    {
      schema: {
        summary: 'Submit a screen',
        description:
          'C148.5: the values of the current screen step by field key, and the key of the ' +
          'button pressed (absent: the primary button). Only the current step accepts it ' +
          '(409 `flow_step_not_current`); every value is validated again on the server, a ' +
          "hidden component's value is discarded, and the answer is the session at the next " +
          'step. A resubmission of a step already left answers the current session.',
        tags: FLOW_TAGS,
        security: SESSION_TOKEN_SECURITY,
        params: flowScreenParamsSchema,
        body: submitFlowScreenBodySchema,
        response: {
          200: flowSessionResponseSchema,
          ...problemResponses(400, 401, 404, 409, 410, 422, 501),
        },
      },
    },
    async (request, reply) => {
      const session = requireFlowSession(request);
      await submitFlowScreen(deps, session, request.params.stepId, request.body);
      // C151.7: the versions the client renders; the response names the one served.
      const declared = request.headers[FLOW_SPEC_HEADER.toLowerCase()];
      const answer = await getFlowSession(deps, session, {
        specVersions: parseFlowSpecHeader(typeof declared === 'string' ? declared : undefined),
      });
      void reply.header(FLOW_SPEC_HEADER, String(answer['spec-version'] ?? 1));
      return answer;
    },
  );
  return Promise.resolve();
};

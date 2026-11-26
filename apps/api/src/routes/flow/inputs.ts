/**
 * C52.3: `POST /api/v1/flow/verifications/:id/inputs`, the values a user enters for a database,
 * AAMVA form, database-business or business-website verification. The schema is frozen (C54.2);
 * Workflow 5A Stage 1b wrote the route, and `api-database` owns this file and its handler, the
 * inputs service (`services/inputs/`): the C52.1 preconditions first; the values stripped of
 * control and bidirectional characters, trimmed and length-capped, checked against the type's
 * body and the step's fields and required fields (422 with a JSON Pointer per member), sealed and
 * never echoed; a new body replaces earlier values while the verification is `initiated`.
 *
 * The documented body is the frozen union of the four bodies (C54.2), but a body none of them
 * accepts is not refused by the route: it reaches the service, whose type schema answers the 422
 * with a JSON Pointer per member that clients place on their fields (a union-level 400 could only
 * name the nearest option, sometimes at `/`). Only a body that is no JSON object keeps the 400.
 */
import {
  flowInputsBodySchema,
  flowVerificationDocumentSchema,
  idSchema,
} from '@openverify/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireFlowSession } from '../../auth/flow-session.js';
import { problemResponses } from '../../plugins/openapi.js';
import { dependenciesOf, type ApiDependencies } from '../../services/context.js';
import { enterVerificationInputs } from '../../services/inputs/index.js';
import { FLOW_TAGS, SESSION_TOKEN_SECURITY } from './openapi.js';

export { INPUT_VERIFICATION_TYPES } from '../../services/inputs/index.js';

/** A JSON object, the only shape a body of entered values can have. */
function isJsonObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const inputRoutes: FastifyPluginAsyncZod<ApiDependencies> = (app, options) => {
  const deps = dependenciesOf(options);
  app.post(
    '/verifications/:id/inputs',
    {
      // The service checks the body against its type's schema (see the file header).
      attachValidation: true,
      schema: {
        summary: 'Enter the values of a verification',
        description:
          'C52.3: the entered values of a `database`, `aamva` (form source), `database-business` ' +
          'or `business-website` verification, as the body for its type names them (kebab-case, ' +
          'strict). A field the step does not collect is refused and a required one must be ' +
          'present (422 with a JSON Pointer per field). Values are cleaned, capped, sealed and ' +
          'never echoed; a new body replaces earlier values while the verification is ' +
          '`initiated`. Requires consent. The answer is the verification with `inputs-received`.',
        tags: FLOW_TAGS,
        security: SESSION_TOKEN_SECURITY,
        params: z.object({ id: idSchema('ver') }),
        body: flowInputsBodySchema,
        response: {
          200: flowVerificationDocumentSchema,
          ...problemResponses(400, 401, 404, 409, 410, 422),
        },
      },
    },
    async (request) => {
      const session = requireFlowSession(request);
      const body: unknown = request.body;
      if (request.validationError !== undefined && !isJsonObject(body)) {
        throw request.validationError;
      }
      return {
        data: await enterVerificationInputs(
          deps,
          session,
          request.params.id,
          body as Readonly<Record<string, unknown>>,
        ),
      };
    },
  );
  return Promise.resolve();
};

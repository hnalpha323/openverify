/**
 * C156.4 (Workflow 9A): a user's simulation presets, `GET` and `POST /api/v1/dashboard/simulation-presets`
 * and `DELETE /api/v1/dashboard/simulation-presets/:id`, on the dashboard API behind the operator's
 * session (an API key has no presets): the built-in passing and failing preset per verification type,
 * and the user's own, labelled "synthetic values only", their scope sealed for the row and masked in
 * stored API logs (C174.5). Frozen by `foundation-9a` (Stage 1b (T)); built by `api-templates-carry`
 * (Workflow 9B) on `services/templates/simulation-presets.ts`. The scope of a preset is served only to
 * an operator holding `pii:view`, and `null` to any other (C174.5).
 */
import {
  createSimulationPresetBodySchema,
  simulationPresetDocumentSchema,
  simulationPresetListDocumentSchema,
} from '@openverify/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import { ulidIdGenerator } from '../../ports.js';
import {
  deleteOwnSimulationPreset,
  listSimulationPresetResources,
  saveSimulationPreset,
  type PresetReader,
} from '../../services/templates/simulation-presets.js';
import { requireOperator } from './authenticate.js';
import type { DashboardContext } from './context.js';
import { DASHBOARD_TAG, USER_SESSION_SECURITY } from './openapi.js';

/** The signed-in operator as a preset reader, in the session's environment. */
function readerOf(request: FastifyRequest): PresetReader {
  const operator = requireOperator(request);
  return {
    environmentId: operator.environmentId,
    userId: operator.user.id,
    piiVisible: operator.permissions.has('pii:view'),
  };
}

/** C156.4 preset routes, under `/api/v1/dashboard`. */
export const simulationPresetRoutes: FastifyPluginAsyncZod<DashboardContext> = (app, context) => {
  app.get(
    '/simulation-presets',
    {
      config: { scopes: ['inquiry-templates:read'] },
      schema: {
        summary: 'List my simulation presets',
        description:
          'C156.4: the built-in presets (`builtin:<name>`) and my own (`ssp_`), synthetic values only.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        response: {
          200: simulationPresetListDocumentSchema,
          ...problemResponses(401, 403),
        },
      },
    },
    async (request) => ({
      data: await listSimulationPresetResources(context.db, readerOf(request)),
      links: { next: null },
    }),
  );

  app.post(
    '/simulation-presets',
    {
      config: { scopes: ['inquiry-templates:read'] },
      schema: {
        summary: 'Save a simulation preset',
        description:
          'C156.4: a named simulated scope of my own, sealed at rest and masked in logs.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        body: createSimulationPresetBodySchema,
        response: {
          201: simulationPresetDocumentSchema,
          ...problemResponses(400, 401, 403),
        },
      },
    },
    async (request, reply) => {
      const { name, scope } = request.body.data.attributes;
      const preset = await saveSimulationPreset(context.db, readerOf(request), {
        id: ulidIdGenerator.newId('ssp'),
        name,
        scope,
      });
      return reply.code(201).send({ data: preset });
    },
  );

  app.delete(
    '/simulation-presets/:id',
    {
      config: { scopes: ['inquiry-templates:read'] },
      schema: {
        summary: 'Delete a simulation preset of mine',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        params: z.object({ id: z.string().regex(/^ssp_[0-9A-HJKMNP-TV-Z]{26}$/) }),
        response: {
          204: z.null().describe('The preset is deleted.'),
          ...problemResponses(401, 403, 404),
        },
      },
    },
    async (request, reply) => {
      await deleteOwnSimulationPreset(context.db, readerOf(request), request.params.id);
      return reply.code(204).send(null);
    },
  );
  return Promise.resolve();
};

/**
 * C127.9 (Workflow 8A): Trust Device from the API. The schema and scope are frozen (Stage 1b (A),
 * `foundation-8a`); `api-actions` owns this file and builds the handler, which answers 501 until then.
 */
import { deviceDocumentSchema, idSchema, trustDeviceBodySchema } from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import { trustDevice } from '../../workflows/actions/devices/trust.js';
import { actingOf } from './inquiries.js';

/** C127.9 route, under `/api/v1`. */
export const deviceTrustRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.post(
    '/devices/:id/trust',
    {
      config: { scopes: ['devices:write'] },
      schema: {
        summary: 'Mark a device as trusted, or clear the mark',
        description:
          'C127.9: `meta.trust-reason` sets the mark and `meta.untrust: true` clears it; both are ' +
          'audit-logged. The mark is read by workflow conditions alone: no signal or check reads it.',
        tags: ['devices'],
        params: z.object({ id: idSchema('dev') }),
        body: trustDeviceBodySchema,
        response: { 200: deviceDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    async (request) => ({
      data: await trustDevice(deps, actingOf(request), request.params.id, request.body.meta),
    }),
  );

  done();
};

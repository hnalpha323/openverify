/**
 * C91.2 (Workflow 7A): the device routes under `/api/v1`, `GET /devices` (the filter
 * `filter[inquiry-session-id]` is required: 400 `filter_required` without it) and
 * `GET /devices/:id`, both under `inquiry-sessions:read`. There is no create, update or event, as
 * in the public API. The schemas and scopes are frozen (Workflow 7A Stage 1b (S), `foundation-7a`);
 * `api-signals` owns this file and builds the handlers (`services/signals/devices.ts`), which
 * answer 501 until then. Both fingerprints are masked without `pii:view` (C91.6).
 */
import {
  deviceDocumentSchema,
  deviceListDocumentSchema,
  idSchema,
  listDevicesQuerySchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import { getDeviceResource, listDevices } from '../../services/signals/devices.js';
import { actingOf } from './inquiries.js';

const TAGS = ['devices'];

/** C91.2 device routes, under `/api/v1`. */
export const deviceRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.get(
    '/devices',
    {
      config: { scopes: ['inquiry-sessions:read'] },
      schema: {
        summary: 'List the devices of an inquiry session',
        description:
          'C91.2: `filter[inquiry-session-id]` is required (400 `filter_required`). A device ' +
          'exists only when the device-recognition tier recorded an identifier; both ' +
          'fingerprints are `null` without `pii:view`.',
        tags: TAGS,
        querystring: listDevicesQuerySchema,
        response: { 200: deviceListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => listDevices(deps, actingOf(request), request.query),
  );

  app.get(
    '/devices/:id',
    {
      config: { scopes: ['inquiry-sessions:read'] },
      schema: {
        summary: 'Fetch a device',
        tags: TAGS,
        params: z.object({ id: idSchema('dev') }),
        response: { 200: deviceDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    async (request) => ({
      data: await getDeviceResource(deps, actingOf(request), request.params.id),
    }),
  );

  done();
};

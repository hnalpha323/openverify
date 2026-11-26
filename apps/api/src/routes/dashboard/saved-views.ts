/**
 * C165.1, C165.2, C165.5 (Workflow 9B; decision 44): saved views on the dashboard API, users only,
 * under `/api/v1/dashboard`. A session is all the routes need: a view's list is the owner's to check
 * against the caller's permissions, and a shared view shows each reader only what that reader's own
 * permissions and masking allow. Frozen by `foundation-9b` (Stage 1b (X)) on the stubs of
 * `services/saved-views/service.ts`, which answer 501 until `api-exports`, the owner of this file,
 * builds them.
 *
 * - `GET /saved-views` (`filter[list]`): the caller's own and the environment's shared views;
 * - `POST /saved-views`: 201; a personal-data filter key is refused with 422 `saved_view_pii_filter`;
 * - `PATCH` and `DELETE /saved-views/:id`: the owner's only (another user's answers 403, an unknown
 *   view 404); a shared view is copied to be changed.
 */
import {
  createSavedViewBodySchema,
  idSchema,
  listSavedViewsQuerySchema,
  savedViewDocumentSchema,
  savedViewListDocumentSchema,
  updateSavedViewBodySchema,
} from '@openverify/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
  updateSavedView,
} from '../../services/saved-views/service.js';
import { operatorPrincipal, requireOperator } from './authenticate.js';
import type { DashboardContext } from './context.js';
import { DASHBOARD_TAG, USER_SESSION_SECURITY } from './openapi.js';

const params = z.object({ id: idSchema('svw') });

/** C165.1 saved view routes, under `/api/v1/dashboard`. */
export const savedViewRoutes: FastifyPluginAsyncZod<DashboardContext> = (app, { db }) => {
  app.get(
    '/saved-views',
    {
      schema: {
        summary: 'List saved views',
        description:
          'C165.1: the caller’s own views and the environment’s shared ones, of lists the caller ' +
          'can read, by list.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        querystring: listSavedViewsQuerySchema,
        response: { 200: savedViewListDocumentSchema, ...problemResponses(400, 401) },
      },
    },
    (request) => listSavedViews(db, operatorPrincipal(requireOperator(request)), request.query),
  );

  app.post(
    '/saved-views',
    {
      schema: {
        summary: 'Save a view',
        description:
          'C165.1, C165.2: a list’s filters (validated by that list’s own query), columns, sort and ' +
          'whether it is shared; a filter the list marks as personal data is refused with 422 ' +
          '`saved_view_pii_filter`, so a stored view never holds a person’s data.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        body: createSavedViewBodySchema,
        response: {
          201: savedViewDocumentSchema,
          ...problemResponses(400, 401, 403, 422),
        },
      },
    },
    async (request, reply) => {
      const document = await createSavedView(
        db,
        operatorPrincipal(requireOperator(request)),
        request.body,
      );
      return reply.code(201).send(document);
    },
  );

  app.patch(
    '/saved-views/:id',
    {
      schema: {
        summary: 'Change a saved view',
        description: 'C165.1: the owner’s only; an omitted member is unchanged.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        params,
        body: updateSavedViewBodySchema,
        response: {
          200: savedViewDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 422),
        },
      },
    },
    (request) =>
      updateSavedView(
        db,
        operatorPrincipal(requireOperator(request)),
        request.params.id,
        request.body,
      ),
  );

  app.delete(
    '/saved-views/:id',
    {
      schema: {
        summary: 'Delete a saved view',
        description: 'C165.1: the owner’s only.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        params,
        response: {
          204: z.null().describe('Deleted.'),
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    async (request, reply) => {
      await deleteSavedView(db, operatorPrincipal(requireOperator(request)), request.params.id);
      return reply.code(204).send(null);
    },
  );

  return Promise.resolve();
};

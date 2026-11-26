/**
 * C154.7 (Workflow 9A): the read-only deployment history (`deployments:read`), under `/api/v1`.
 * `filter[environment-id]` is always the caller's environment, so another id answers an empty list;
 * `filter[changes-only]` is public and changes nothing. Frozen by `foundation-9a` (Stage 1b (T));
 * `api-templates` owns this file and builds it.
 */
import {
  deploymentDocumentSchema,
  deploymentListDocumentSchema,
  idSchema,
  listDeploymentsQuerySchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requirePrincipal } from '../../plugins/principal-auth.js';
import { getDeploymentFor, listDeploymentsFor } from '../../services/templates/operations.js';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';

const TAGS = ['deployments'];

export const deploymentRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.get(
    '/deployments',
    {
      config: { scopes: ['deployments:read'] },
      schema: {
        summary: 'List deployments',
        description:
          'C154.7: one deployment per publish of a template version in its own environment, newest ' +
          'first, filtered by `filter[inquiry-template-id]`.',
        tags: TAGS,
        querystring: listDeploymentsQuerySchema,
        response: {
          200: deploymentListDocumentSchema,
          ...problemResponses(400, 401, 403),
        },
      },
    },
    (request) => listDeploymentsFor(deps, requirePrincipal(request).environmentId, request.query),
  );

  app.get(
    '/deployments/:id',
    {
      config: { scopes: ['deployments:read'] },
      schema: {
        summary: 'Retrieve a deployment',
        tags: TAGS,
        params: z.object({ id: idSchema('dply') }),
        response: {
          200: deploymentDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    async (request) => ({
      data: await getDeploymentFor(
        deps,
        requirePrincipal(request).environmentId,
        request.params.id,
      ),
    }),
  );

  done();
};

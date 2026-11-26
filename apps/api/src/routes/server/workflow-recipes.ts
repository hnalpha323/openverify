/**
 * C112.6, C140.5 (Workflow 8A, V16): the recipe routes under `/api/v1`, frozen by `foundation-8a` and
 * built by `api-workflows` (`workflows/recipes/service.ts`).
 */
import {
  listWorkflowRecipesQuerySchema,
  workflowDocumentSchema,
  workflowRecipeKeySchema,
  workflowRecipeListDocumentSchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import { installWorkflowRecipe, listWorkflowRecipes } from '../../workflows/recipes/service.js';
import { optionalBody } from './inquiries.js';
import { workflowActingOf } from './workflows.js';

const TAGS = ['workflow-recipes'];

/** C112.6 recipe routes, under `/api/v1`. */
export const workflowRecipeRoutes: FastifyPluginCallbackZod<ApiDependencies> = (
  app,
  deps,
  done,
) => {
  app.get(
    '/workflow-recipes',
    {
      config: { scopes: ['workflows:read'] },
      schema: {
        summary: 'List workflow recipes',
        description: 'C140.5: the documented recipes. Not paged.',
        tags: TAGS,
        querystring: listWorkflowRecipesQuerySchema,
        response: { 200: workflowRecipeListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    () => listWorkflowRecipes(),
  );

  app.post(
    '/workflow-recipes/:key/install',
    {
      config: { scopes: ['workflows:write'] },
      schema: {
        summary: 'Install a workflow recipe',
        description: 'C140.5: as a disabled draft in the caller’s environment.',
        tags: TAGS,
        params: z.object({ key: workflowRecipeKeySchema }),
        body: optionalBody(z.strictObject({})),
        response: {
          201: workflowDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409),
        },
      },
    },
    async (request, reply) => {
      const document = await installWorkflowRecipe(
        deps,
        workflowActingOf(request),
        request.params.key,
      );
      return reply.code(201).send(document);
    },
  );

  done();
};

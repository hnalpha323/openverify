/**
 * C118.7 (Workflow 8A): account actions under `/api/v1`, and running one on an account. The schemas
 * and scopes are frozen (Stage 1b (E), `foundation-8a`); `api-triggers` builds the handlers
 * (`workflows/triggers/account-actions.ts`).
 */
import {
  accountActionDocumentSchema,
  accountActionListDocumentSchema,
  accountAvailableActionListDocumentSchema,
  createAccountActionBodySchema,
  idSchema,
  listAccountActionsQuerySchema,
  runAccountActionBodySchema,
  runAccountActionDocumentSchema,
  updateAccountActionBodySchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  createAccountAction,
  getAccountActionDocument,
  listAccountActions,
  listAccountAvailableActions,
  runAccountAction,
  updateAccountAction,
} from '../../workflows/triggers/service.js';
import { idempotencyKeyOf } from './workflow-triggers.js';
import { workflowActingOf } from './workflows.js';

const TAGS = ['account-actions'];
const params = z.object({ id: idSchema('accac') });
const accountParams = z.object({ id: idSchema('acc') });

/** C118.7 account action routes, under `/api/v1`. */
export const accountActionRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.post(
    '/account-actions',
    {
      config: { scopes: ['workflows:write'] },
      schema: {
        summary: 'Create an account action',
        description: 'C118.7: binds a running `trigger-account` workflow to an account type.',
        tags: TAGS,
        body: createAccountActionBodySchema,
        response: {
          201: accountActionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    async (request, reply) => {
      const document = await createAccountAction(deps, workflowActingOf(request), request.body);
      return reply.code(201).send(document);
    },
  );

  app.get(
    '/account-actions',
    {
      config: { scopes: ['workflows:write'] },
      schema: {
        summary: 'List account actions',
        description: 'Newest first (C1).',
        tags: TAGS,
        querystring: listAccountActionsQuerySchema,
        response: { 200: accountActionListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => listAccountActions(deps, workflowActingOf(request), request.query),
  );

  app.get(
    '/account-actions/:id',
    {
      config: { scopes: ['workflows:write'] },
      schema: {
        summary: 'Retrieve an account action',
        description: 'C118.7.',
        tags: TAGS,
        params,
        response: { 200: accountActionDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    (request) => getAccountActionDocument(deps, workflowActingOf(request), request.params.id),
  );

  app.patch(
    '/account-actions/:id',
    {
      config: { scopes: ['workflows:write'] },
      schema: {
        summary: 'Update an account action',
        description: 'C118.7: its label, its form or its status.',
        tags: TAGS,
        params,
        body: updateAccountActionBodySchema,
        response: {
          200: accountActionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 422),
        },
      },
    },
    (request) =>
      updateAccountAction(deps, workflowActingOf(request), request.params.id, request.body),
  );

  app.post(
    '/accounts/:id/run-action',
    {
      config: { scopes: ['workflows:trigger', 'accounts:read'] },
      schema: {
        summary: 'Run an account action',
        description:
          'C118.7: validates `data.parameters` against the inputs. The caller needs the version’s ' +
          'grant as well (C121.3).',
        tags: TAGS,
        params: accountParams,
        body: runAccountActionBodySchema,
        response: {
          200: runAccountActionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422, 429),
        },
      },
    },
    (request) =>
      runAccountAction(
        deps,
        workflowActingOf(request),
        request.params.id,
        request.body,
        idempotencyKeyOf(request),
      ),
  );

  app.get(
    '/accounts/:id/available-actions',
    {
      config: { scopes: ['workflows:trigger', 'accounts:read'] },
      schema: {
        summary: 'List an account’s actions',
        description:
          'C118.7 (H14): the account actions the caller may run, by the caller’s grant. A masked ' +
          'field’s prefill stays empty (P38).',
        tags: TAGS,
        params: accountParams,
        response: {
          200: accountAvailableActionListDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) => listAccountAvailableActions(deps, workflowActingOf(request), request.params.id),
  );

  done();
};

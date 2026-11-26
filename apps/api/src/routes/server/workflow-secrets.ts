/**
 * C125.2 (Workflow 8A): the workflow secrets routes, under `/api/v1`. The schemas and scopes are frozen
 * (Stage 1b (X), `foundation-8a`); `api-egress` owns this file and builds the service, which answers
 * 501 until then. Nothing here ever answers a value: `secret-value` goes in, and a stored API log
 * redacts it. A value route's environment-rules are the service's, so its 404 for another environment
 * sits beside its other refusals.
 */
import {
  createWorkflowSecretBodySchema,
  idSchema,
  listWorkflowSecretsQuerySchema,
  putWorkflowSecretValueBodySchema,
  rotateWorkflowSecretValueBodySchema,
  updateWorkflowSecretBodySchema,
  workflowSecretDocumentSchema,
  workflowSecretKeySchema,
  workflowSecretListDocumentSchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  createWorkflowSecret,
  deleteWorkflowSecret,
  getWorkflowSecret,
  listWorkflowSecrets,
  putWorkflowSecretValue,
  rotateWorkflowSecretValue,
  updateWorkflowSecret,
} from '../../services/workflow-secrets/service.js';
import { workflowActingOf } from './workflows.js';

const TAGS = ['workflow-secrets'];

const secretParams = z.object({ key: workflowSecretKeySchema });
const valueParams = secretParams.extend({ environmentId: idSchema('env') });

/** C125.2 routes, under `/api/v1`. */
export const workflowSecretRoutes: FastifyPluginCallbackZod<ApiDependencies> = (
  app,
  deps,
  done,
) => {
  app.get(
    '/workflow-secrets',
    {
      config: { scopes: ['secrets:read'] },
      schema: {
        summary: 'List workflow secrets',
        description:
          'C125.2: metadata only, with the value metadata of the caller’s own environment.',
        tags: TAGS,
        querystring: listWorkflowSecretsQuerySchema,
        response: { 200: workflowSecretListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => listWorkflowSecrets(deps, workflowActingOf(request), request.query),
  );

  app.post(
    '/workflow-secrets',
    {
      config: { scopes: ['secrets:write'] },
      schema: {
        summary: 'Create a workflow secret',
        description: 'C125.1: a key with its hosts and placements. A value is set per environment.',
        tags: TAGS,
        body: createWorkflowSecretBodySchema,
        response: { 201: workflowSecretDocumentSchema, ...problemResponses(400, 401, 403, 409) },
      },
    },
    async (request, reply) => {
      const document = await createWorkflowSecret(deps, workflowActingOf(request), request.body);
      return reply.code(201).send(document);
    },
  );

  app.get(
    '/workflow-secrets/:key',
    {
      config: { scopes: ['secrets:read'] },
      schema: {
        summary: 'Read a workflow secret',
        description: 'C125.2: metadata only.',
        tags: TAGS,
        params: secretParams,
        response: { 200: workflowSecretDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    (request) => getWorkflowSecret(deps, workflowActingOf(request), request.params.key),
  );

  app.patch(
    '/workflow-secrets/:key',
    {
      config: { scopes: ['secrets:write'] },
      schema: {
        summary: 'Update a workflow secret',
        description:
          'C125.2: the key is immutable. Changing hosts or placements needs a production user ' +
          'session when any production value exists.',
        tags: TAGS,
        params: secretParams,
        body: updateWorkflowSecretBodySchema,
        response: { 200: workflowSecretDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    (request) =>
      updateWorkflowSecret(deps, workflowActingOf(request), request.params.key, request.body),
  );

  app.delete(
    '/workflow-secrets/:key',
    {
      config: { scopes: ['secrets:write'] },
      schema: {
        summary: 'Delete a workflow secret',
        description:
          'C125.2: refused with `secret_in_use` while a published version references the key.',
        tags: TAGS,
        params: secretParams,
        response: {
          200: workflowSecretDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409),
        },
      },
    },
    (request) => deleteWorkflowSecret(deps, workflowActingOf(request), request.params.key),
  );

  app.put(
    '/workflow-secrets/:key/values/:environmentId',
    {
      config: { scopes: ['secrets:write'] },
      schema: {
        summary: 'Set a workflow secret’s value',
        description:
          'C125.2: acts only on the caller’s own environment, and another environment id answers ' +
          '404. A production value needs a user session in production.',
        tags: TAGS,
        params: valueParams,
        body: putWorkflowSecretValueBodySchema,
        response: { 200: workflowSecretDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    (request) =>
      putWorkflowSecretValue(
        deps,
        workflowActingOf(request),
        request.params.key,
        request.params.environmentId,
        request.body,
      ),
  );

  app.post(
    '/workflow-secrets/:key/values/:environmentId/rotate',
    {
      config: { scopes: ['secrets:write'] },
      schema: {
        summary: 'Rotate a workflow secret’s value',
        description:
          'C125.2: as setting a value, and the previous value is kept up to 24 hours for a signing ' +
          'secret.',
        tags: TAGS,
        params: valueParams,
        body: rotateWorkflowSecretValueBodySchema,
        response: { 200: workflowSecretDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    (request) =>
      rotateWorkflowSecretValue(
        deps,
        workflowActingOf(request),
        request.params.key,
        request.params.environmentId,
        request.body,
      ),
  );

  done();
};

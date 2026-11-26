/**
 * C132.1 (Workflow 8B): case queues and their members under `/api/v1`. The schemas and scopes are
 * frozen (Stage 1b (Q), `foundation-8b`); `api-queues-sla` owns this file and builds the handlers
 * (`services/cases/queues/service.ts`), which answer 501 until then.
 */
import {
  caseQueueDocumentSchema,
  caseQueueListDocumentSchema,
  createCaseQueueBodySchema,
  idSchema,
  listCaseQueuesQuerySchema,
  setCaseQueueMembersBodySchema,
  updateCaseQueueBodySchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  createCaseQueue,
  getCaseQueue,
  listCaseQueues,
  setCaseQueueMembers,
  updateCaseQueue,
} from '../../services/cases/queues/service.js';
import { workflowActingOf } from './workflows.js';

const TAGS = ['case-queues'];
const params = z.object({ id: idSchema('cqueue') });

/** C132.1 queue routes, under `/api/v1`. */
export const caseQueueRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.get(
    '/case-queues',
    {
      config: { scopes: ['case-queues:read'] },
      schema: {
        summary: 'List case queues',
        description: 'C132.1: newest first (C1); `filter[member-id]` reads a person’s queues.',
        tags: TAGS,
        querystring: listCaseQueuesQuerySchema,
        response: { 200: caseQueueListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => listCaseQueues(deps, workflowActingOf(request), request.query),
  );

  app.post(
    '/case-queues',
    {
      config: { scopes: ['case-queues:write'] },
      schema: {
        summary: 'Create a case queue',
        description:
          'C132.1, C132.2: a name, the policy that pushes its cases, and its members, each of whom ' +
          'must hold `cases:write` (`case_assignee_ineligible`).',
        tags: TAGS,
        body: createCaseQueueBodySchema,
        response: { 201: caseQueueDocumentSchema, ...problemResponses(400, 401, 403, 404, 422) },
      },
    },
    async (request, reply) => {
      const document = await createCaseQueue(deps, workflowActingOf(request), request.body);
      return reply.code(201).send(document);
    },
  );

  app.get(
    '/case-queues/:id',
    {
      config: { scopes: ['case-queues:read'] },
      schema: {
        summary: 'Retrieve a case queue',
        description: 'C132.1: the public attributes, its members and its policy.',
        tags: TAGS,
        params,
        response: { 200: caseQueueDocumentSchema, ...problemResponses(401, 403, 404) },
      },
    },
    (request) => getCaseQueue(deps, workflowActingOf(request), request.params.id),
  );

  app.patch(
    '/case-queues/:id',
    {
      config: { scopes: ['case-queues:write'] },
      schema: {
        summary: 'Update a case queue',
        description:
          'C132.1: its name and policy, or `status: archived`, which is permanent and returns its ' +
          'unassigned cases to no queue (`case.queue-updated` each).',
        tags: TAGS,
        params,
        body: updateCaseQueueBodySchema,
        response: {
          200: caseQueueDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    (request) => updateCaseQueue(deps, workflowActingOf(request), request.params.id, request.body),
  );

  app.put(
    '/case-queues/:id/members',
    {
      config: { scopes: ['case-queues:write'] },
      schema: {
        summary: 'Replace a case queue’s members',
        description:
          'C132.1: the whole list; a member who leaves gives back their open cases of this queue ' +
          'at once, each unassigned and offered to the queue’s policy again.',
        tags: TAGS,
        params,
        body: setCaseQueueMembersBodySchema,
        response: {
          200: caseQueueDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    (request) =>
      setCaseQueueMembers(deps, workflowActingOf(request), request.params.id, request.body),
  );

  done();
};

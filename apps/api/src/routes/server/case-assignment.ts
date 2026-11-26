/**
 * C132.3, C132.4 (Workflow 8B): a case's manual assignment and the pull, under `/api/v1`. The schemas
 * and scopes are frozen (Stage 1b (Q), `foundation-8b`); `api-queues-sla` owns this file and builds
 * the handlers (`services/cases/assignment/service.ts`), which answer 501 until then.
 *
 * Both routes ask `cases:write`, because a route's scopes are all required: assigning oneself and
 * pulling a case need no more, and the service asks `cases:assign` to assign anyone else (C129.5).
 */
import {
  assignCaseBodySchema,
  caseDocumentSchema,
  idSchema,
  nextCaseBodySchema,
  nextCaseDocumentSchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import { assignCase, nextCase } from '../../services/cases/assignment/service.js';
import { workflowActingOf } from './workflows.js';

const TAGS = ['cases'];
const params = z.object({ id: idSchema('case') });

/** C132.3 assignment routes, under `/api/v1`. */
export const caseAssignmentRoutes: FastifyPluginCallbackZod<ApiDependencies> = (
  app,
  deps,
  done,
) => {
  app.post(
    '/cases/:id/assign',
    {
      config: { scopes: ['cases:write'] },
      schema: {
        summary: 'Assign a case',
        description:
          'C132.3: `meta.user-id` (`null` unassigns) or `meta.user-email-address`, resolved within ' +
          'the organisation. Assigning anyone but oneself needs `cases:assign`. The assignee must ' +
          'hold `cases:write` and see the template (`case_assignee_ineligible`, which never says ' +
          'whether an address exists elsewhere); `lock-version` answers `case_version_conflict`.',
        tags: TAGS,
        params,
        body: assignCaseBodySchema,
        response: {
          200: caseDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 410, 422),
        },
      },
    },
    (request) => assignCase(deps, workflowActingOf(request), request.params.id, request.body),
  );

  app.post(
    '/cases/next',
    {
      config: { scopes: ['cases:write'] },
      schema: {
        summary: 'Take the next case',
        description:
          'C132.3 (ours): the most urgent unassigned case of the caller’s queues (or of the queues ' +
          'named, each of which the caller is a member of), by `sla-expires-at`, then creation, ' +
          'assigned to the caller; `data: null` when none waits.',
        tags: TAGS,
        body: nextCaseBodySchema,
        response: { 200: nextCaseDocumentSchema, ...problemResponses(400, 401, 403, 422) },
      },
    },
    (request) => nextCase(deps, workflowActingOf(request), request.body),
  );

  done();
};

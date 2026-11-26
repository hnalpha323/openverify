/**
 * C172.2 (Workflow 9B): a case's checklist under `/api/v1`. The schemas and scope are frozen (Stage
 * 1b (C), `foundation-9b`); `api-cases-reports` owns this file and builds the handler
 * (`services/cases/checklists/service.ts`), which answers 501 until then.
 *
 * `POST /cases/:id/checklist` (`cases:write`): checks or unchecks one item of the case's pinned
 * version, under `meta.lock-version` as every case change, naming who and when (C172.7); answers the
 * case's checklist state.
 */
import {
  caseChecklistStateDocumentSchema,
  idSchema,
  setCaseChecklistItemBodySchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import { getCaseChecklist, setCaseChecklistItem } from '../../services/cases/checklists/service.js';
import type { ApiDependencies } from '../../services/context.js';
import { workflowActingOf } from './workflows.js';

const params = z.object({ id: idSchema('case') });

/** C172.2 case checklist routes, under `/api/v1`. */
export const caseChecklistRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.get(
    '/cases/:id/checklist',
    {
      config: { scopes: ['cases:read'] },
      schema: {
        summary: 'Read a case’s checklist state',
        description:
          'C172.2: every item of the checklists of the case’s version, checked or not, with who ' +
          'checked it and when, and the case’s `lock-version` for the next change.',
        tags: ['cases'],
        params,
        response: {
          200: caseChecklistStateDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) => getCaseChecklist(deps, workflowActingOf(request), request.params.id),
  );

  app.post(
    '/cases/:id/checklist',
    {
      config: { scopes: ['cases:write'] },
      schema: {
        summary: 'Check or uncheck a case checklist item',
        description:
          'C172.2: one item of the checklists of the case’s version, under `meta.lock-version`; ' +
          'a checked item names who checked it and when, an unchecked one neither. A status that ' +
          'an unchecked item names is refused with 422 `case_checklist_incomplete`.',
        tags: ['cases'],
        params,
        body: setCaseChecklistItemBodySchema,
        response: {
          200: caseChecklistStateDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 410, 422),
        },
      },
    },
    (request) =>
      setCaseChecklistItem(deps, workflowActingOf(request), request.params.id, request.body),
  );

  done();
};

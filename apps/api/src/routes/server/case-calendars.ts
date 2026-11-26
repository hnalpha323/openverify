/**
 * C133.2 (Workflow 8B): business calendars and their holiday import under `/api/v1`. The schemas and
 * scopes are frozen (Stage 1b (Q), `foundation-8b`); `api-queues-sla` owns this file and builds the
 * handlers (`services/cases/sla/calendars.ts`), which answer 501 until then. A calendar has no delete
 * route (C129.5).
 */
import {
  caseCalendarDocumentSchema,
  caseCalendarImportDocumentSchema,
  caseCalendarListDocumentSchema,
  createCaseCalendarBodySchema,
  idSchema,
  importCaseCalendarHolidaysBodySchema,
  listCaseCalendarsQuerySchema,
  updateCaseCalendarBodySchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  createCaseCalendar,
  getCaseCalendar,
  importCaseCalendarHolidays,
  listCaseCalendars,
  updateCaseCalendar,
} from '../../services/cases/sla/calendars.js';
import { workflowActingOf } from './workflows.js';

const TAGS = ['case-calendars'];
const params = z.object({ id: idSchema('ccal') });

/** C133.2 calendar routes, under `/api/v1`. */
export const caseCalendarRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.get(
    '/case-calendars',
    {
      config: { scopes: ['case-queues:read'] },
      schema: {
        summary: 'List business calendars',
        description: 'C133.2: newest first (C1).',
        tags: TAGS,
        querystring: listCaseCalendarsQuerySchema,
        response: { 200: caseCalendarListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => listCaseCalendars(deps, workflowActingOf(request), request.query),
  );

  app.post(
    '/case-calendars',
    {
      config: { scopes: ['case-queues:write'] },
      schema: {
        summary: 'Create a business calendar',
        description:
          'C133.2, C133.3: a zone the runtime knows and a week with no boundary of the next two ' +
          'years in a gap or a repeat, else `calendar_invalid` naming the dates.',
        tags: TAGS,
        body: createCaseCalendarBodySchema,
        response: { 201: caseCalendarDocumentSchema, ...problemResponses(400, 401, 403, 422) },
      },
    },
    async (request, reply) => {
      const document = await createCaseCalendar(deps, workflowActingOf(request), request.body);
      return reply.code(201).send(document);
    },
  );

  app.get(
    '/case-calendars/:id',
    {
      config: { scopes: ['case-queues:read'] },
      schema: {
        summary: 'Retrieve a business calendar',
        description: 'C133.2.',
        tags: TAGS,
        params,
        response: { 200: caseCalendarDocumentSchema, ...problemResponses(401, 403, 404) },
      },
    },
    (request) => getCaseCalendar(deps, workflowActingOf(request), request.params.id),
  );

  app.patch(
    '/case-calendars/:id',
    {
      config: { scopes: ['case-queues:write'] },
      schema: {
        summary: 'Update a business calendar',
        description:
          'C133.2: a member sent replaces the stored one whole; the running deadlines on the ' +
          'calendar are recomputed, each with a history row (decision 59).',
        tags: TAGS,
        params,
        body: updateCaseCalendarBodySchema,
        response: { 200: caseCalendarDocumentSchema, ...problemResponses(400, 401, 403, 404, 422) },
      },
    },
    (request) =>
      updateCaseCalendar(deps, workflowActingOf(request), request.params.id, request.body),
  );

  app.post(
    '/case-calendars/:id/holidays/import',
    {
      config: { scopes: ['case-queues:write'] },
      schema: {
        summary: 'Import a calendar’s holidays',
        description:
          'C133.2: a `date,label` CSV read with the importers’ parser rules; its rows join the ' +
          'stored holidays unless `replace` is true. A refused row is named by number and code, ' +
          'never by its value.',
        tags: TAGS,
        params,
        body: importCaseCalendarHolidaysBodySchema,
        response: {
          200: caseCalendarImportDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 422),
        },
      },
    },
    (request) =>
      importCaseCalendarHolidays(deps, workflowActingOf(request), request.params.id, request.body),
  );

  done();
};

/**
 * C138.1, C138.2 (Workflow 8B (F); P19, P26): case exports under `/api/v1`, `cases:export` on every
 * route, read by their creating principal alone (another gets 404). The schemas and scope are frozen
 * (Stage 1b (F), `foundation-8b`); `api-case-files` owns this file and builds the handlers
 * (`services/cases/exports/service.ts`), which answer 501 until then.
 */
import {
  caseExportDocumentSchema,
  caseExportListDocumentSchema,
  createCaseExportBodySchema,
  idSchema,
  listCaseExportsQuerySchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  createCaseExport,
  downloadCaseExport,
  getCaseExport,
  listCaseExports,
} from '../../services/cases/exports/service.js';
import { workflowActingOf } from './workflows.js';

const TAGS = ['cases'];
const params = z.object({ id: idSchema('cexp') });

/** The file's bytes, sent unserialized. */
const binaryContent = z.instanceof(Buffer);

/** C138.1 export routes, under `/api/v1`. */
export const caseExportRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.post(
    '/case-exports',
    {
      config: { scopes: ['cases:export'] },
      schema: {
        summary: 'Export cases',
        description:
          'C138.1: a filter or a search, as CSV or JSON, at most 10,000 cases; made by a job, ' +
          'its file kept 24 hours. `include-personal-data` needs `pii:view`, as a search on a ' +
          'field does. Its audit entry records the filter’s shape, never a value.',
        tags: TAGS,
        body: createCaseExportBodySchema,
        response: {
          202: caseExportDocumentSchema,
          ...problemResponses(400, 401, 403, 422, 429),
        },
      },
    },
    async (request, reply) => {
      const document = await createCaseExport(deps, workflowActingOf(request), request.body);
      return reply.code(202).send(document);
    },
  );

  app.get(
    '/case-exports',
    {
      config: { scopes: ['cases:export'] },
      schema: {
        summary: 'List my case exports',
        description: 'C138.1 (P26): the caller’s own, newest first.',
        tags: TAGS,
        querystring: listCaseExportsQuerySchema,
        response: { 200: caseExportListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => listCaseExports(deps, workflowActingOf(request), request.query),
  );

  app.get(
    '/case-exports/:id',
    {
      config: { scopes: ['cases:export'] },
      schema: {
        summary: 'Read a case export',
        description: 'C138.1 (P26): the caller’s own; another principal’s answers 404.',
        tags: TAGS,
        params,
        response: { 200: caseExportDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    (request) => getCaseExport(deps, workflowActingOf(request), request.params.id),
  );

  app.get(
    '/case-exports/:id/download',
    {
      config: { scopes: ['cases:export'] },
      schema: {
        summary: 'Download a case export',
        description:
          'C138.1 (P26): the caller’s own completed export, within its 24 hours; `cases:export`, ' +
          'and `pii:view` when it holds personal data, are checked again. Audited.',
        tags: TAGS,
        params,
        response: {
          200: {
            description: 'The CSV or the JSON bundle, as an attachment named by the server.',
            content: {
              'text/csv': { schema: binaryContent },
              'application/json': { schema: binaryContent },
            },
          },
          ...problemResponses(400, 401, 403, 404, 410),
        },
      },
    },
    async (request, reply) => {
      const file = await downloadCaseExport(deps, workflowActingOf(request), request.params.id);
      return reply
        .header('content-type', file.mediaType)
        .header('content-disposition', `attachment; filename="${file.filename}"`)
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'private, no-store')
        .send(Buffer.from(file.bytes));
    },
  );

  done();
};

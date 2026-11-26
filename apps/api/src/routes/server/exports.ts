/**
 * C166.1-C166.4 (Workflow 9B; decision 43): generic exports under `/api/v1`, read by their creating
 * principal alone (another gets 404). Frozen by `foundation-9b` (Stage 1b (X)); `api-exports` owns
 * this file and builds the handlers (`services/exports/service.ts`), which answer 501 until then.
 *
 * - `POST /exports` needs the object type's `:export` (`EXPORT_PERMISSIONS`, which no `:read` gives),
 *   checked here before anything else, then counts the `exports` policy (10 an hour per environment)
 *   and answers 202 with the export, cut by the `export` job.
 * - `GET /exports` and `GET /exports/:id`: the caller's own; the service checks the export's type
 *   permission again.
 * - `GET /exports/:id/download`: the file as an attachment, `private, no-store`, `nosniff`; the
 *   permissions (and `pii:view` for a file with personal data) are checked again and the download is
 *   audited; 410 once the file has expired.
 */
import {
  createExportBodySchema,
  exportDocumentSchema,
  exportListDocumentSchema,
  idSchema,
  listExportsQuerySchema,
} from '@openverify/contracts';
import { EXPORT_PERMISSIONS } from '@openverify/core';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import { authorizePrincipal, requirePrincipal } from '../../plugins/principal-auth.js';
import { enforceRoutePolicy } from '../../plugins/rate-limit.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  createExport,
  downloadExport,
  getExport,
  listExports,
} from '../../services/exports/service.js';
import { workflowActingOf } from './workflows.js';

const TAGS = ['exports'];
const params = z.object({ id: idSchema('exp') });

/** The file's bytes, sent unserialized. */
const binaryContent = z.instanceof(Buffer);

/** C166 export routes, under `/api/v1`. */
export const exportRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.post(
    '/exports',
    {
      schema: {
        summary: 'Export a list',
        description:
          'C166.1: one CSV of a list’s filter or a saved view, cut by a job, at most 50,000 rows ' +
          '(refused with `export_too_large` past it, never truncated), its file kept 24 hours for ' +
          'its creator alone. Needs the object type’s `:export` permission; ' +
          '`include-personal-data` needs `pii:view`, and personal columns are masked otherwise. ' +
          'Counted by the `exports` policy. Its audit entry records the filter’s keys, never a value.',
        tags: TAGS,
        body: createExportBodySchema,
        response: {
          202: exportDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 422, 429),
        },
      },
    },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      authorizePrincipal(principal, [
        EXPORT_PERMISSIONS[request.body.data.attributes['object-type']],
      ]);
      await enforceRoutePolicy(
        deps.rateLimiter,
        'exports',
        principal.environmentId,
        'Too many exports in this environment; retry later.',
      );
      const document = await createExport(deps, workflowActingOf(request), request.body);
      return reply.code(202).send(document);
    },
  );

  app.get(
    '/exports',
    {
      schema: {
        summary: 'List my exports',
        description: 'C166.4: the caller’s own, newest first.',
        tags: TAGS,
        querystring: listExportsQuerySchema,
        response: { 200: exportListDocumentSchema, ...problemResponses(400, 401) },
      },
    },
    (request) => listExports(deps, workflowActingOf(request), request.query),
  );

  app.get(
    '/exports/:id',
    {
      schema: {
        summary: 'Read an export',
        description: 'C166.4: the caller’s own; another principal’s answers 404.',
        tags: TAGS,
        params,
        response: { 200: exportDocumentSchema, ...problemResponses(400, 401, 404) },
      },
    },
    (request) => getExport(deps, workflowActingOf(request), request.params.id),
  );

  app.get(
    '/exports/:id/download',
    {
      schema: {
        summary: 'Download an export',
        description:
          'C166.4: the caller’s own completed export, within its 24 hours; its `:export` ' +
          'permission, and `pii:view` when it holds personal data, are checked again. Audited.',
        tags: TAGS,
        params,
        response: {
          200: {
            description: 'The CSV, as an attachment named by the server.',
            content: { 'text/csv': { schema: binaryContent } },
          },
          ...problemResponses(400, 401, 403, 404, 410),
        },
      },
    },
    async (request, reply) => {
      const file = await downloadExport(deps, workflowActingOf(request), request.params.id);
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${file.filename}"`)
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'private, no-store')
        .send(Buffer.from(file.bytes));
    },
  );

  done();
};

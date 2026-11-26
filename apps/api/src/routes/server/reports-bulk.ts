/**
 * C166.5, C166.6 (Workflow 9B; K13): bulk report creation under `/api/v1`, ours. Frozen by
 * `foundation-9b` (Stage 1b (X)); `api-exports` owns this file and builds the handlers
 * (`services/exports/report-bulk.ts`), which answer 501 until then.
 *
 * - `POST /reports/bulk` (`reports:write`, plus each link's scope, the service's): one multipart body
 *   of `report-template-id` and the CSV in the part `REPORT_BULK_FILE_FIELD`, at most
 *   `REPORT_BULK_LIMITS.bytes` with room for the framing, buffered by this plugin's own parser so that
 *   `Idempotency-Key` is honoured; counted by the `report-bulk` policy (5 an hour per environment)
 *   first; 202 with the job, run by the `report-bulk` job. A stored API log keeps the body's part
 *   metadata only, never the CSV (review P24).
 * - `GET /reports/bulk/:id` (`reports:read`): the job with each row created or failed.
 */
import {
  idSchema,
  REPORT_BULK_FILE_FIELD,
  REPORT_BULK_LIMITS,
  reportBulkJobDocumentSchema,
} from '@openverify/contracts';
import { validatorCompiler, type FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import { requirePrincipal } from '../../plugins/principal-auth.js';
import { enforceRoutePolicy } from '../../plugins/rate-limit.js';
import type { ApiDependencies } from '../../services/context.js';
import { createReportBulkJob, getReportBulkJob } from '../../services/exports/report-bulk.js';
import { workflowActingOf } from './workflows.js';

const TAGS = ['reports'];

/** C166.5: a 2 MiB CSV with room for the multipart framing and the template id. */
export const REPORT_BULK_BODY_LIMIT_BYTES = REPORT_BULK_LIMITS.bytes + 64 * 1024;

/**
 * The upload's validator: zod for the params; the body must be the buffered multipart bytes, which
 * the service reads. Fastify types `schema` as the whole route schema, but compiles each part with
 * that part's zod schema.
 */
function multipartBodyValidator(route: {
  schema: unknown;
  method: string;
  url: string;
  httpPart?: string;
}) {
  if (route.httpPart === 'body') {
    return (value: unknown) =>
      value instanceof Uint8Array
        ? { value }
        : { error: new Error('the body must be multipart/form-data') };
  }
  return validatorCompiler({
    schema: route.schema as z.ZodType,
    method: route.method,
    url: route.url,
  });
}

/** C166.5 bulk report routes, under `/api/v1`. */
export const reportBulkRoutes: FastifyPluginAsyncZod<ApiDependencies> = (app, deps) => {
  // Local to this plugin: the upload's body, buffered as it came. No other route reads it.
  app.addContentTypeParser(
    'multipart/form-data',
    { parseAs: 'buffer', bodyLimit: REPORT_BULK_BODY_LIMIT_BYTES },
    (_request, body, parsed) => {
      parsed(null, body);
    },
  );

  app.post(
    '/reports/bulk',
    {
      bodyLimit: REPORT_BULK_BODY_LIMIT_BYTES,
      config: { scopes: ['reports:write'] },
      validatorCompiler: multipartBodyValidator,
      schema: {
        summary: 'Create reports in bulk',
        description:
          'C166.5: a CSV whose header names the report template’s query sources, at most 1,000 ' +
          'rows and 2 MiB, each row a report created by a job with origin `bulk`, or failed with ' +
          'its code, never skipped. Needs `reports:write` and each link’s scope. Counted by the ' +
          '`report-bulk` policy. The CSV is deleted when the job ends.',
        tags: TAGS,
        consumes: ['multipart/form-data'],
        body: z.object({
          'report-template-id': idSchema('rptp'),
          [REPORT_BULK_FILE_FIELD]: z.string().meta({ format: 'binary' }),
        }),
        response: {
          202: reportBulkJobDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 413, 415, 422, 429),
        },
      },
    },
    async (request, reply) => {
      await enforceRoutePolicy(
        deps.rateLimiter,
        'report-bulk',
        requirePrincipal(request).environmentId,
        'Too many bulk report uploads in this environment; retry later.',
      );
      const document = await createReportBulkJob(deps, workflowActingOf(request), {
        body: request.body as unknown as Uint8Array,
        contentType: request.headers['content-type'] ?? '',
      });
      return reply.code(202).send(document);
    },
  );

  app.get(
    '/reports/bulk/:id',
    {
      config: { scopes: ['reports:read'] },
      schema: {
        summary: 'Read a bulk report job',
        description:
          'C166.6: the job’s status, counts and each row’s outcome: created with its report, or ' +
          'failed with its code.',
        tags: TAGS,
        params: z.object({ id: idSchema('rbulk') }),
        response: {
          200: reportBulkJobDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) => getReportBulkJob(deps, workflowActingOf(request), request.params.id),
  );

  return Promise.resolve();
};

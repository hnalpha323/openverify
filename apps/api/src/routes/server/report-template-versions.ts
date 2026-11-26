/**
 * C71, C72.1 (Phase 6): the report template version routes under `/api/v1`: drafts, their
 * configuration, and publishing under the template lock. The schemas and scopes are frozen
 * (Workflow 6A Stage 1b, `foundation-6`); `api-reports` owns this file and its handlers
 * (`services/reports/templates.ts`).
 */
import {
  createReportTemplateVersionBodySchema,
  idSchema,
  listReportTemplateVersionsQuerySchema,
  publishReportTemplateVersionBodySchema,
  reportTemplateVersionDocumentSchema,
  reportTemplateVersionListDocumentSchema,
  updateReportTemplateVersionBodySchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import { requirePrincipal } from '../../plugins/principal-auth.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  createReportTemplateVersionResource,
  getReportTemplateVersionResource,
  listReportTemplateVersionResources,
  publishReportTemplateVersionResource,
  REPORT_TEMPLATE_VERSIONS_PATH,
  updateReportTemplateVersionResource,
} from '../../services/reports/templates.js';
import { actingOf } from './inquiries.js';

const TAGS = ['report-templates'];
const params = z.object({ id: idSchema('rptpv') });

/** C71, C72.1 report template version routes, under `/api/v1`. */
export const reportTemplateVersionRoutes: FastifyPluginCallbackZod<ApiDependencies> = (
  app,
  deps,
  done,
) => {
  app.post(
    '/report-template-versions',
    {
      config: { scopes: ['report-templates:write'] },
      schema: {
        summary: 'Create a draft report template version',
        description:
          "C71.1: `config` is checked against the template's type " +
          '(`reportTemplateConfigSchema`; 422 with pointers).',
        tags: TAGS,
        body: createReportTemplateVersionBodySchema,
        response: {
          201: reportTemplateVersionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 422),
        },
      },
    },
    async (request, reply) => {
      const version = await createReportTemplateVersionResource(
        deps,
        actingOf(request),
        request.body.data.attributes,
      );
      return reply
        .code(201)
        .header('location', `${REPORT_TEMPLATE_VERSIONS_PATH}/${version.id}`)
        .send({ data: version });
    },
  );

  app.get(
    '/report-template-versions',
    {
      config: { scopes: ['report-templates:read'] },
      schema: {
        summary: 'List report template versions, newest first',
        tags: TAGS,
        querystring: listReportTemplateVersionsQuerySchema,
        response: {
          200: reportTemplateVersionListDocumentSchema,
          ...problemResponses(400, 401, 403),
        },
      },
    },
    (request) =>
      listReportTemplateVersionResources(
        deps,
        requirePrincipal(request).environmentId,
        request.query,
      ),
  );

  app.get(
    '/report-template-versions/:id',
    {
      config: { scopes: ['report-templates:read'] },
      schema: {
        summary: 'Fetch a report template version',
        tags: TAGS,
        params,
        response: {
          200: reportTemplateVersionDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    async (request) => ({
      data: await getReportTemplateVersionResource(
        deps,
        requirePrincipal(request).environmentId,
        request.params.id,
      ),
    }),
  );

  app.patch(
    '/report-template-versions/:id',
    {
      config: { scopes: ['report-templates:write'] },
      schema: {
        summary: "Replace a draft's configuration",
        description: 'Drafts only (409 for a published or superseded version).',
        tags: TAGS,
        params,
        body: updateReportTemplateVersionBodySchema,
        response: {
          200: reportTemplateVersionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    async (request) => ({
      data: await updateReportTemplateVersionResource(
        deps,
        actingOf(request),
        request.params.id,
        request.body.data.attributes,
      ),
    }),
  );

  app.post(
    '/report-template-versions/:id/publish',
    {
      config: { scopes: ['report-templates:publish'] },
      schema: {
        summary: 'Publish a draft report template version',
        description:
          'C71.1, C71.2: supersedes the published version under the template lock and writes ' +
          'an audit entry (no event). The publish rules answer 422 with pointers ' +
          '(`watchlist_source_unknown`, `watchlist_source_not_allowed`, ' +
          '`watchlist_sources_empty`, recurrence on a type that does not recur, ' +
          "`max-list-age-hours` below a selected source's refresh interval); a version that is " +
          'not a draft answers 409. Reports keep the version they pinned.',
        tags: TAGS,
        params,
        body: publishReportTemplateVersionBodySchema,
        response: {
          200: reportTemplateVersionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    async (request) => ({
      data: await publishReportTemplateVersionResource(deps, actingOf(request), request.params.id),
    }),
  );

  done();
};

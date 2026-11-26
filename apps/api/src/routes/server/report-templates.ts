/**
 * C71, C72.1 (Phase 6): the report template routes under `/api/v1`. A template has one report type
 * and versioned configurations; creating it publishes version 1. The schemas and scopes are frozen
 * (Workflow 6A Stage 1b, `foundation-6`); `api-reports` owns this file and its handlers
 * (`services/reports/templates.ts`).
 */
import {
  createReportTemplateBodySchema,
  idSchema,
  listReportTemplatesQuerySchema,
  reportTemplateDocumentSchema,
  reportTemplateListDocumentSchema,
  updateReportTemplateBodySchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { UnprocessableContentError } from '../../errors.js';
import { problemResponses } from '../../plugins/openapi.js';
import { requirePrincipal } from '../../plugins/principal-auth.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  createReportTemplateResource,
  getReportTemplateResource,
  listReportTemplateResources,
  REPORT_TEMPLATES_PATH,
  updateReportTemplateResource,
} from '../../services/reports/templates.js';
import { refuseInvalidMember } from '../../services/reports/validation.js';
import { actingOf } from './inquiries.js';

const TAGS = ['report-templates'];
const params = z.object({ id: idSchema('rptp') });

/** C71, C72.1 report template routes, under `/api/v1`. */
export const reportTemplateRoutes: FastifyPluginCallbackZod<ApiDependencies> = (
  app,
  deps,
  done,
) => {
  app.post(
    '/report-templates',
    {
      config: { scopes: ['report-templates:write'] },
      // C71.1: a `config` the type does not take answers 422 with pointers, not 400.
      attachValidation: true,
      schema: {
        summary: 'Create a report template and its first version',
        description:
          'C71.1, C71.2: version 1 is published at once, with the `config` checked against ' +
          '`report-type` (422 with pointers) and the defaults served resolved. An omitted ' +
          '`search-lists` is resolved and pinned: the sandbox lists in a sandbox environment, ' +
          'never a sandbox-only list in production (422 `watchlist_source_not_allowed`); an ' +
          'unknown source answers 422 `watchlist_source_unknown`, an empty list 422 ' +
          '`watchlist_sources_empty`, and recurrence on a type that does not recur 422.',
        tags: TAGS,
        body: createReportTemplateBodySchema,
        response: {
          201: reportTemplateDocumentSchema,
          ...problemResponses(400, 401, 403, 422),
        },
      },
    },
    async (request, reply) => {
      refuseInvalidMember(
        request.validationError,
        request.body,
        createReportTemplateBodySchema,
        ['data', 'attributes', 'config'],
        (errors) =>
          new UnprocessableContentError('The configuration is not one this type takes.', errors),
      );
      const template = await createReportTemplateResource(
        deps,
        actingOf(request),
        request.body.data.attributes,
      );
      return reply
        .code(201)
        .header('location', `${REPORT_TEMPLATES_PATH}/${template.id}`)
        .send({ data: template });
    },
  );

  app.get(
    '/report-templates',
    {
      config: { scopes: ['report-templates:read'] },
      schema: {
        summary: 'List report templates, newest first',
        tags: TAGS,
        querystring: listReportTemplatesQuerySchema,
        response: { 200: reportTemplateListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) =>
      listReportTemplateResources(deps, requirePrincipal(request).environmentId, request.query),
  );

  app.get(
    '/report-templates/:id',
    {
      config: { scopes: ['report-templates:read'] },
      schema: {
        summary: 'Fetch a report template',
        description: 'With its `current-version`, the published one, resolved.',
        tags: TAGS,
        params,
        response: { 200: reportTemplateDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    async (request) => ({
      data: await getReportTemplateResource(
        deps,
        requirePrincipal(request).environmentId,
        request.params.id,
      ),
    }),
  );

  app.patch(
    '/report-templates/:id',
    {
      config: { scopes: ['report-templates:write'] },
      schema: {
        summary: 'Rename, archive or restore a report template',
        description:
          'C71.1: an archived template refuses new API reports (422 ' +
          '`report_template_not_published`); inquiry templates that list it still run its ' +
          'published version on completion.',
        tags: TAGS,
        params,
        body: updateReportTemplateBodySchema,
        response: {
          200: reportTemplateDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 422),
        },
      },
    },
    async (request) => ({
      data: await updateReportTemplateResource(
        deps,
        actingOf(request),
        request.params.id,
        request.body.data.attributes,
      ),
    }),
  );

  done();
};

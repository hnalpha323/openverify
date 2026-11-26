import {
  createInquiryTemplateVersionBodySchema,
  idSchema,
  ifMatchHeadersSchema,
  inquiryTemplateVersionDocumentSchema,
  inquiryTemplateVersionListDocumentSchema,
  listInquiryTemplateVersionsQuerySchema,
  publishInquiryTemplateVersionBodySchema,
  updateInquiryTemplateVersionBodySchema,
  diffInquiryTemplateVersionQuerySchema,
  previewInquiryTemplateVersionBodySchema,
  simulateInquiryTemplateVersionBodySchema,
  templatePreviewDocumentSchema,
  templateSimulationDocumentSchema,
  templateVersionDiffDocumentSchema,
  templateVersionValidationDocumentSchema,
  validateInquiryTemplateVersionBodySchema,
} from '@openverify/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { BadRequestError } from '../../errors.js';
import { enforceRoutePolicy, principalSubject } from '../../plugins/rate-limit.js';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import { requirePrincipal } from '../../plugins/principal-auth.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  createInquiryTemplateVersion,
  getInquiryTemplateVersionResource,
  INQUIRY_TEMPLATE_VERSIONS_PATH,
  listInquiryTemplateVersions,
  publishTemplateVersion,
  updateInquiryTemplateVersion,
} from '../../services/inquiry-templates.js';
import { actingOf, optionalBody } from './inquiries.js';
import {
  diffTemplateVersions,
  validateTemplateVersion,
} from '../../services/templates/operations.js';
import { previewTemplateVersion } from '../../services/templates/preview.js';
import { simulateTemplateVersion } from '../../services/templates/simulate-version.js';

const TAGS = ['inquiry-template-versions'];

/**
 * C154.3: the `If-Match` header, a strong ETag (`ifMatchHeadersSchema`); anything else is refused
 * with 400, never compared. Read from the headers, so the route schemas stay as frozen.
 */
function ifMatchOf(request: FastifyRequest): string | undefined {
  const parsed = ifMatchHeadersSchema.safeParse(request.headers);
  if (!parsed.success) {
    throw new BadRequestError('If-Match must be one strong ETag, as the version answers it.');
  }
  return parsed.data['if-match'];
}
const params = z.object({ id: idSchema('itmplv') });

/**
 * C11 inquiry template version routes (scopes `inquiry-templates:*`), under `/api/v1`. A
 * version starts as a draft, is edited, then published (`inquiry-templates:publish`), which
 * supersedes the previous published version.
 */
export const inquiryTemplateVersionRoutes: FastifyPluginCallbackZod<ApiDependencies> = (
  app,
  deps,
  done,
) => {
  app.post(
    '/inquiry-template-versions',
    {
      config: { scopes: ['inquiry-templates:write'] },
      schema: {
        summary: 'Draft a new template version',
        description:
          'The draft is numbered after the latest version. Validation is the same as for a ' +
          'new template; the current version does not change until the draft is published.',
        tags: TAGS,
        body: createInquiryTemplateVersionBodySchema,
        response: {
          201: inquiryTemplateVersionDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    async (request, reply) => {
      const { resource, etag } = await createInquiryTemplateVersion(
        deps,
        actingOf(request),
        request.body.data.attributes,
      );
      return reply
        .code(201)
        .header('location', `${INQUIRY_TEMPLATE_VERSIONS_PATH}/${resource.id}`)
        .header('etag', etag)
        .send({ data: resource });
    },
  );

  app.get(
    '/inquiry-template-versions',
    {
      config: { scopes: ['inquiry-templates:read'] },
      schema: {
        summary: 'List template versions, newest first',
        tags: TAGS,
        querystring: listInquiryTemplateVersionsQuerySchema,
        response: {
          200: inquiryTemplateVersionListDocumentSchema,
          ...problemResponses(400, 401, 403),
        },
      },
    },
    (request) =>
      listInquiryTemplateVersions(deps, requirePrincipal(request).environmentId, request.query),
  );

  app.get(
    '/inquiry-template-versions/:id',
    {
      config: { scopes: ['inquiry-templates:read'] },
      schema: {
        summary: 'Fetch a template version',
        description: 'The settings carry the defaults for what the version leaves out.',
        tags: TAGS,
        params,
        response: {
          200: inquiryTemplateVersionDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    async (request, reply) => {
      const { resource, etag } = await getInquiryTemplateVersionResource(
        deps,
        requirePrincipal(request).environmentId,
        request.params.id,
      );
      return reply.header('etag', etag).send({ data: resource });
    },
  );

  app.patch(
    '/inquiry-template-versions/:id',
    {
      config: { scopes: ['inquiry-templates:write'] },
      schema: {
        summary: 'Update a draft template version',
        description:
          'Drafts only (409 `invalid-transition` otherwise). The members sent replace the ' +
          'stored ones; the result must still be a valid template (422 otherwise).',
        tags: TAGS,
        params,
        body: updateInquiryTemplateVersionBodySchema,
        response: {
          200: inquiryTemplateVersionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    async (request, reply) => {
      const { resource, etag } = await updateInquiryTemplateVersion(
        deps,
        actingOf(request),
        request.params.id,
        request.body.data.attributes,
        {
          allowInvalid: request.body.meta?.['allow-invalid'] === true,
          ifMatch: ifMatchOf(request),
        },
      );
      return reply.header('etag', etag).send({ data: resource });
    },
  );

  app.post(
    '/inquiry-template-versions/:id/publish',
    {
      config: { scopes: ['inquiry-templates:publish'] },
      schema: {
        summary: 'Publish a draft template version',
        description:
          'The draft becomes the template current version and the previous published ' +
          'version `superseded`. Existing inquiries keep the version they pinned.',
        tags: TAGS,
        params,
        body: optionalBody(publishInquiryTemplateVersionBodySchema),
        response: {
          200: inquiryTemplateVersionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409),
        },
      },
    },
    async (request, reply) => {
      const { resource, etag } = await publishTemplateVersion(
        deps,
        actingOf(request),
        request.params.id,
        {
          ifMatch: ifMatchOf(request),
          acknowledgements: request.body?.meta?.acknowledgements,
          publishNote: request.body?.meta?.['publish-note'],
        },
      );
      return reply.header('etag', etag).send({ data: resource });
    },
  );

  // C154.4, C156 (Workflow 9A Stage 1b (T)): validate, diff, preview and simulate, frozen by
  // `foundation-9a`; validate and diff built by `api-templates`, simulate by `api-templates-carry`
  // and preview by `api-templates-finish` (Workflow 9B). Preview, simulate and validate (which runs
  // every async publish hook) count `template-preview` per principal first (C174.4).
  const previewPolicy = (request: FastifyRequest) =>
    enforceRoutePolicy(
      deps.rateLimiter,
      'template-preview',
      principalSubject(requirePrincipal(request)),
      'Too many previews, simulations or validations; retry later.',
    );

  app.post(
    '/inquiry-template-versions/:id/validate',
    {
      config: { scopes: ['inquiry-templates:read'] },
      schema: {
        summary: 'Validate a template version',
        description:
          'C154.4: a dry run of every rule, the async publish hooks included, on the stored draft ' +
          'or on an unsaved body of the members `PATCH` takes; `meta.mode` is `save` or `publish`. ' +
          'Counted by the `template-preview` policy.',
        tags: TAGS,
        params,
        body: optionalBody(validateInquiryTemplateVersionBodySchema),
        response: {
          200: templateVersionValidationDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 429),
        },
      },
    },
    async (request) => {
      await previewPolicy(request);
      return validateTemplateVersion(
        deps,
        actingOf(request),
        request.params.id,
        request.body ?? {},
      );
    },
  );

  app.get(
    '/inquiry-template-versions/:id/diff',
    {
      config: { scopes: ['inquiry-templates:read'] },
      schema: {
        summary: 'Compare two versions of a template',
        description:
          'C154.6: steps, edges, route order, check configuration, settings, fields, copy, theme and ' +
          'locales between this version and `against` (any version of the same template), keyed by ' +
          'step and edge ids, with the changes that have consequences named in words.',
        tags: TAGS,
        params,
        querystring: diffInquiryTemplateVersionQuerySchema,
        response: {
          200: templateVersionDiffDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) =>
      diffTemplateVersions(
        deps,
        requirePrincipal(request).environmentId,
        request.params.id,
        request.query.against,
      ),
  );

  app.post(
    '/inquiry-template-versions/:id/preview',
    {
      config: { scopes: ['inquiry-templates:read'] },
      schema: {
        summary: 'Preview a template version',
        description:
          'C156.1: every renderable step as a client view, the resolved theme, the copy for ' +
          '`meta.locale` (or a pseudo-locale) and synthetic guidance values, from the stored version ' +
          'or an unsaved body; never inquiry data. Counted by the `template-preview` policy.',
        tags: TAGS,
        params,
        body: previewInquiryTemplateVersionBodySchema,
        response: {
          200: templatePreviewDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 422, 429),
        },
      },
    },
    async (request) => {
      await previewPolicy(request);
      return previewTemplateVersion(
        deps,
        requirePrincipal(request).environmentId,
        request.params.id,
        request.body,
      );
    },
  );

  app.post(
    '/inquiry-template-versions/:id/simulate',
    {
      config: { scopes: ['inquiry-templates:read'] },
      schema: {
        summary: 'Simulate a template version',
        description:
          'C156.4: the path the server engine would take over a simulated scope or a preset, with ' +
          "each route, wait and `onNull` used and the outcome, computed by the engine's own " +
          'functions; labelled simulated and never stored. Counted by the `template-preview` policy.',
        tags: TAGS,
        params,
        body: simulateInquiryTemplateVersionBodySchema,
        response: {
          200: templateSimulationDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 422, 429),
        },
      },
    },
    async (request) => {
      await previewPolicy(request);
      return simulateTemplateVersion(
        deps,
        requirePrincipal(request),
        request.params.id,
        request.body.meta,
      );
    },
  );

  done();
};

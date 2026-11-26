import {
  createInquiryTemplateBodySchema,
  idSchema,
  inquiryTemplateDocumentSchema,
  inquiryTemplateListDocumentSchema,
  listInquiryTemplatesQuerySchema,
  updateInquiryTemplateBodySchema,
  copyInquiryTemplateBodySchema,
  inquiryTemplateVersionDocumentSchema,
  promoteInquiryTemplateBodySchema,
  promoteMetaSchema,
  restoreInquiryTemplateBodySchema,
  templateUsageDocumentSchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import { requirePrincipal } from '../../plugins/principal-auth.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  copyTemplate,
  promoteTemplate,
  restoreTemplateVersion,
  templateUsage,
} from '../../services/templates/operations.js';
import {
  createInquiryTemplate,
  getInquiryTemplate,
  INQUIRY_TEMPLATE_VERSIONS_PATH,
  INQUIRY_TEMPLATES_PATH,
  listInquiryTemplates,
  updateInquiryTemplate,
} from '../../services/inquiry-templates.js';
import { actingOf } from './inquiries.js';

const TAGS = ['inquiry-templates'];
const params = z.object({ id: idSchema('itmpl') });

/** C2 and C11 inquiry template routes, under `/api/v1`. */
export const inquiryTemplateRoutes: FastifyPluginCallbackZod<ApiDependencies> = (
  app,
  deps,
  done,
) => {
  app.post(
    '/inquiry-templates',
    {
      config: { scopes: ['inquiry-templates:write'] },
      schema: {
        summary: 'Create an inquiry template and its first version',
        description: 'Version 1 is published at once; `settings` default when left out.',
        tags: TAGS,
        body: createInquiryTemplateBodySchema,
        response: { 201: inquiryTemplateDocumentSchema, ...problemResponses(400, 401, 403, 422) },
      },
    },
    async (request, reply) => {
      const template = await createInquiryTemplate(
        deps,
        actingOf(request),
        request.body.data.attributes,
      );
      return reply
        .code(201)
        .header('location', `${INQUIRY_TEMPLATES_PATH}/${template.id}`)
        .send({ data: template });
    },
  );

  app.get(
    '/inquiry-templates/:id',
    {
      config: { scopes: ['inquiry-templates:read'] },
      schema: {
        summary: 'Fetch an inquiry template',
        tags: TAGS,
        params,
        response: { 200: inquiryTemplateDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    async (request) => ({
      data: await getInquiryTemplate(
        deps,
        requirePrincipal(request).environmentId,
        request.params.id,
      ),
    }),
  );

  app.get(
    '/inquiry-templates',
    {
      config: { scopes: ['inquiry-templates:read'] },
      schema: {
        summary: 'List inquiry templates, newest first',
        tags: TAGS,
        querystring: listInquiryTemplatesQuerySchema,
        response: { 200: inquiryTemplateListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => listInquiryTemplates(deps, requirePrincipal(request).environmentId, request.query),
  );

  app.patch(
    '/inquiry-templates/:id',
    {
      config: { scopes: ['inquiry-templates:write'] },
      schema: {
        summary: 'Rename, archive or restore an inquiry template',
        description:
          'Inquiries cannot be created from an `archived` template (422 `template-archived`).',
        tags: TAGS,
        params,
        body: updateInquiryTemplateBodySchema,
        response: { 200: inquiryTemplateDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    async (request) => ({
      data: await updateInquiryTemplate(
        deps,
        actingOf(request),
        request.params.id,
        request.body.data.attributes,
      ),
    }),
  );

  // C154.4, C154.5 (Workflow 9A): restore, copy, used by and promote (`api-templates`).

  app.post(
    '/inquiry-templates/:id/restore',
    {
      config: { scopes: ['inquiry-templates:write'] },
      schema: {
        summary: 'Restore a template version as a draft',
        description:
          'C154.4: a new draft that copies `meta.version-id`, to be published as any draft is; ' +
          '409 `draft_exists` while the template has a draft.',
        tags: TAGS,
        params,
        body: restoreInquiryTemplateBodySchema,
        response: {
          201: inquiryTemplateVersionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409),
        },
      },
    },
    async (request, reply) => {
      const { resource, etag } = await restoreTemplateVersion(
        deps,
        actingOf(request),
        request.params.id,
        request.body.meta['version-id'],
      );
      return reply
        .code(201)
        .header('location', `${INQUIRY_TEMPLATE_VERSIONS_PATH}/${resource.id}`)
        .header('etag', etag)
        .send({ data: resource });
    },
  );

  app.post(
    '/inquiry-templates/:id/copy',
    {
      config: { scopes: ['inquiry-templates:write'] },
      schema: {
        summary: 'Copy a template',
        description:
          'C154.4: a new template named `meta.name` whose draft copies `meta.version-id` (the ' +
          'current version when absent).',
        tags: TAGS,
        params,
        body: copyInquiryTemplateBodySchema,
        response: {
          201: inquiryTemplateDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    async (request, reply) => {
      const template = await copyTemplate(
        deps,
        actingOf(request),
        request.params.id,
        request.body.meta,
      );
      return reply
        .code(201)
        .header('location', `${INQUIRY_TEMPLATES_PATH}/${template.id}`)
        .send({ data: template });
    },
  );

  app.get(
    '/inquiry-templates/:id/used-by',
    {
      config: { scopes: ['inquiry-templates:read'] },
      schema: {
        summary: 'List what uses a template',
        description:
          'C154.4: the workflows, report templates and case templates that name it, each by name ' +
          'only for a caller who can read it and otherwise counted, and its embed origins.',
        tags: TAGS,
        params,
        response: {
          200: templateUsageDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) => templateUsage(deps, requirePrincipal(request), request.params.id),
  );

  app.post(
    '/inquiry-templates/:id/promote',
    {
      config: { scopes: ['inquiry-templates:write'] },
      schema: {
        summary: 'Promote a template version to another environment',
        description:
          'C154.5: a published version copied as a draft of the template of the same name in ' +
          '`meta.environment-id` (created on the first promote), references re-resolved by key or ' +
          'name; users only, with `inquiry-templates:write` in both environments and ' +
          '`environments:production` when either is production; never replaces a draft.',
        tags: TAGS,
        params,
        body: promoteInquiryTemplateBodySchema,
        response: {
          201: inquiryTemplateVersionDocumentSchema.safeExtend({ meta: promoteMetaSchema }),
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    async (request, reply) => {
      const { resource, etag, copied } = await promoteTemplate(
        deps,
        actingOf(request),
        requirePrincipal(request),
        request.params.id,
        request.body.meta,
      );
      return reply
        .code(201)
        .header('location', `${INQUIRY_TEMPLATE_VERSIONS_PATH}/${resource.id}`)
        .header('etag', etag)
        .send({ data: resource, meta: { copied } });
    },
  );

  done();
};

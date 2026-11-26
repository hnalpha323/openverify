/**
 * C130 (Workflow 8B): case templates and their versions under `/api/v1`, following owner decision 7
 * after Workflow 7B for the versions (Stage 1a amendment 19). The schemas and scopes are frozen
 * (Stage 1b (C), `foundation-8b`); `api-cases` owns this file and builds the handlers
 * (`services/cases/templates.ts`), which answer 501 until then.
 *
 * Workflow 9B (C172.1-C172.4): a version's `layout`, `checklists`, `preset-comments` and a status's
 * `requires-fields` are stored, served and checked at publish by the template service
 * (`api-cases-reports`, `services/cases/layout/version-members.ts`). The 501 the routes still
 * declare is foundation-9b's fail-closed answer, kept in the snapshot until `integration-9b`
 * regenerates it.
 */
import {
  archiveCaseTemplateBodySchema,
  caseTemplateDocumentSchema,
  caseTemplateListDocumentSchema,
  caseTemplateVersionDocumentSchema,
  caseTemplateVersionListDocumentSchema,
  createCaseTemplateBodySchema,
  createCaseTemplateVersionBodySchema,
  idSchema,
  listCaseTemplatesQuerySchema,
  listCaseTemplateVersionsQuerySchema,
  publishCaseTemplateVersionBodySchema,
  updateCaseTemplateBodySchema,
  updateCaseTemplateVersionBodySchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  archiveCaseTemplate,
  createCaseTemplate,
  createCaseTemplateVersion,
  getCaseTemplate,
  getCaseTemplateVersion,
  listCaseTemplates,
  listCaseTemplateVersions,
  publishCaseTemplateVersion,
  updateCaseTemplate,
  updateCaseTemplateVersion,
} from '../../services/cases/templates.js';
import { workflowActingOf } from './workflows.js';

const TAGS = ['case-templates'];

const params = z.object({ id: idSchema('ctmpl') });
const versionParams = z.object({ id: idSchema('ctmplv') });

/** C130 case template routes, under `/api/v1`. */
export const caseTemplateRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.get(
    '/case-templates',
    {
      config: { scopes: ['case-templates:read'] },
      schema: {
        summary: 'List case templates',
        description: 'C130.1: newest first (C1); a template the reader may not see is left out.',
        tags: TAGS,
        querystring: listCaseTemplatesQuerySchema,
        response: { 200: caseTemplateListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => listCaseTemplates(deps, workflowActingOf(request), request.query),
  );

  app.post(
    '/case-templates',
    {
      config: { scopes: ['case-templates:write'] },
      schema: {
        summary: 'Create a case template',
        description:
          'C130.1, C130.2: a key unique in the environment, and a first draft holding the ' +
          'defaults unless the body says otherwise.',
        tags: TAGS,
        body: createCaseTemplateBodySchema,
        response: {
          201: caseTemplateDocumentSchema,
          ...problemResponses(400, 401, 403, 409, 422),
        },
      },
    },
    async (request, reply) => {
      const document = await createCaseTemplate(deps, workflowActingOf(request), request.body);
      return reply.code(201).send(document);
    },
  );

  app.get(
    '/case-templates/:id',
    {
      config: { scopes: ['case-templates:read'] },
      schema: {
        summary: 'Retrieve a case template',
        description: 'C130.4: the public attributes and ours.',
        tags: TAGS,
        params,
        response: { 200: caseTemplateDocumentSchema, ...problemResponses(401, 403, 404) },
      },
    },
    (request) => getCaseTemplate(deps, workflowActingOf(request), request.params.id),
  );

  app.patch(
    '/case-templates/:id',
    {
      config: { scopes: ['case-templates:write'] },
      schema: {
        summary: 'Update a case template',
        description: 'C130.1: its name and the roles that see its cases; the key never changes.',
        tags: TAGS,
        params,
        body: updateCaseTemplateBodySchema,
        response: {
          200: caseTemplateDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    (request) =>
      updateCaseTemplate(deps, workflowActingOf(request), request.params.id, request.body),
  );

  app.post(
    '/case-templates/:id/archive',
    {
      config: { scopes: ['case-templates:write'] },
      schema: {
        summary: 'Archive a case template',
        description: 'C130.1: it takes no new case and keeps the ones it has.',
        tags: TAGS,
        params,
        body: archiveCaseTemplateBodySchema,
        response: { 200: caseTemplateDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    (request) =>
      archiveCaseTemplate(deps, workflowActingOf(request), request.params.id, request.body),
  );

  app.get(
    '/case-template-versions',
    {
      config: { scopes: ['case-templates:read'] },
      schema: {
        summary: 'List case template versions',
        description: 'C130.2: one template’s versions, newest first (C1).',
        tags: TAGS,
        querystring: listCaseTemplateVersionsQuerySchema,
        response: {
          200: caseTemplateVersionListDocumentSchema,
          ...problemResponses(400, 401, 403),
        },
      },
    },
    (request) => listCaseTemplateVersions(deps, workflowActingOf(request), request.query),
  );

  app.post(
    '/case-template-versions',
    {
      config: { scopes: ['case-templates:write'] },
      schema: {
        summary: 'Create a case template version',
        description: 'C130.2: a draft, at most one per template, from the published version.',
        tags: TAGS,
        body: createCaseTemplateVersionBodySchema,
        response: {
          201: caseTemplateVersionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    async (request, reply) => {
      const document = await createCaseTemplateVersion(
        deps,
        workflowActingOf(request),
        request.body,
      );
      return reply.code(201).send(document);
    },
  );

  app.get(
    '/case-template-versions/:id',
    {
      config: { scopes: ['case-templates:read'] },
      schema: {
        summary: 'Retrieve a case template version',
        description: 'C130.2.',
        tags: TAGS,
        params: versionParams,
        response: { 200: caseTemplateVersionDocumentSchema, ...problemResponses(401, 403, 404) },
      },
    },
    (request) => getCaseTemplateVersion(deps, workflowActingOf(request), request.params.id),
  );

  app.patch(
    '/case-template-versions/:id',
    {
      config: { scopes: ['case-templates:write'] },
      schema: {
        summary: 'Update a case template version',
        description: 'C130.2: a draft only (409 `case_template_version_not_draft`).',
        tags: TAGS,
        params: versionParams,
        body: updateCaseTemplateVersionBodySchema,
        response: {
          200: caseTemplateVersionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    (request) =>
      updateCaseTemplateVersion(deps, workflowActingOf(request), request.params.id, request.body),
  );

  app.post(
    '/case-template-versions/:id/publish',
    {
      config: { scopes: ['case-templates:publish'] },
      schema: {
        summary: 'Publish a case template version',
        description:
          'C130.2, C130.3: under the template’s lock; the published version is superseded, and a ' +
          'field it drops fires `case-template.deleted-field`.',
        tags: TAGS,
        params: versionParams,
        body: publishCaseTemplateVersionBodySchema,
        response: {
          200: caseTemplateVersionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    (request) =>
      publishCaseTemplateVersion(deps, workflowActingOf(request), request.params.id, request.body),
  );

  done();
};

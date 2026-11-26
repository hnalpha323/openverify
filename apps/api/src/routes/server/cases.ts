/**
 * C129.5, C131-C137 (Workflow 8B): the case routes under `/api/v1`. The schemas and scopes are frozen
 * (Stage 1b (C), `foundation-8b`); `api-cases` owns this file and builds the handlers
 * (`services/cases/service.ts`), which answer 501 until then. `assign` and `next` are (Q)'s
 * (`case-assignment.ts`), attachments (F)'s (`case-attachments.ts`), print `case-print.ts`, and
 * `run-action` and `available-actions` `case-actions.ts`.
 *
 * Template visibility (P14) is the services' to apply in each query, so a limit counts what is
 * visible. `PATCH` takes up to 14 MiB, because its attachments carry up to 10 MiB of base64 (C135.1).
 */
import {
  addCaseCommentBodySchema,
  addCaseObjectsBodySchema,
  addCaseTagBodySchema,
  caseBulkActionDocumentSchema,
  caseDocumentSchema,
  caseHeldObjectListDocumentSchema,
  caseHistoryListDocumentSchema,
  caseIncludeDocumentSchema,
  caseListDocumentSchema,
  caseSearchBodySchema,
  caseSearchDocumentSchema,
  createCaseBodySchema,
  createCaseBulkActionBodySchema,
  getCaseQuerySchema,
  idSchema,
  listCaseHeldObjectsQuerySchema,
  listCaseHistoryQuerySchema,
  listCasesQuerySchema,
  removeCaseObjectsBodySchema,
  removeCaseTagBodySchema,
  setCaseStatusBodySchema,
  setCaseTagsBodySchema,
  updateCaseBodySchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  addCaseComment,
  addCaseObjects,
  addCaseTag,
  createCase,
  createCaseBulkAction,
  getCase,
  getCaseBulkAction,
  listCaseHeldObjects,
  listCaseHistory,
  listCases,
  redactCase,
  removeCaseObjects,
  removeCaseTag,
  searchCases,
  setCaseStatus,
  setCaseTags,
  updateCase,
} from '../../services/cases/service.js';
import { idempotencyKeyOf } from './workflow-triggers.js';
import { workflowActingOf } from './workflows.js';

const TAGS = ['cases'];
const params = z.object({ id: idSchema('case') });

/** C135.1: a `PATCH` body carries up to 10 MiB of attachments as base64. */
export const CASE_PATCH_BODY_LIMIT = 14 * 1024 * 1024;

/** C129.5 case routes, under `/api/v1`. */
export const caseRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.get(
    '/cases',
    {
      config: { scopes: ['cases:read'] },
      schema: {
        summary: 'List cases',
        description:
          'C129.5, C137.1: newest first (C1), with the public filters and ours. A case of a ' +
          'template the reader may not see is left out (C129.4).',
        tags: TAGS,
        querystring: listCasesQuerySchema,
        response: { 200: caseListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => listCases(deps, workflowActingOf(request), request.query),
  );

  app.post(
    '/cases',
    {
      config: { scopes: ['cases:write'] },
      schema: {
        summary: 'Create a case',
        description:
          'C129.2, C136: on the template’s published version, named from its key and counter, ' +
          'holding `meta.object-ids` (at most 1,000) with an optional `meta.sla-expires-in-seconds`. ' +
          'Limited by `case-create` (C143.3).',
        tags: TAGS,
        body: createCaseBodySchema,
        response: {
          201: caseDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422, 429),
        },
      },
    },
    async (request, reply) => {
      const document = await createCase(
        deps,
        workflowActingOf(request),
        request.body,
        idempotencyKeyOf(request),
      );
      return reply.code(201).send(document);
    },
  );

  app.get(
    '/cases/:id',
    {
      config: { scopes: ['cases:read'] },
      schema: {
        summary: 'Retrieve a case',
        description:
          'C129.2: fields are masked member-wise without PII visibility (C136.4); each held ' +
          'kind names its newest 50 (Stage 1a amendment 20). `?include=` adds the template and ' +
          'the newest 50 comments, and the queue and each held kind as their own routes serve ' +
          'them to the caller; a kind whose read scope the caller lacks is left out, never ' +
          'refused (C143.6).',
        tags: TAGS,
        params,
        querystring: getCaseQuerySchema,
        response: { 200: caseIncludeDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    (request) => getCase(deps, workflowActingOf(request), request.params.id, request.query),
  );

  app.patch(
    '/cases/:id',
    {
      bodyLimit: CASE_PATCH_BODY_LIMIT,
      config: { scopes: ['cases:write'] },
      schema: {
        summary: 'Update a case',
        description:
          'C129.5, C135.1, C136.4: the queue, fields and attachments; the SLA and ' +
          '`lock-version` in `meta` (409 `case_version_conflict` on a stale one).',
        tags: TAGS,
        params,
        body: updateCaseBodySchema,
        response: {
          200: caseDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 410, 413, 422),
        },
      },
    },
    (request) => updateCase(deps, workflowActingOf(request), request.params.id, request.body),
  );

  app.delete(
    '/cases/:id',
    {
      config: { scopes: ['cases:redact'] },
      schema: {
        summary: 'Redact a case',
        description:
          'C139.1: comments, fields, attachments and tags; held objects are not redacted with ' +
          'it. Irreversible; fires `case.redacted`.',
        tags: TAGS,
        params,
        response: { 200: caseDocumentSchema, ...problemResponses(401, 403, 404) },
      },
    },
    (request) => redactCase(deps, workflowActingOf(request), request.params.id),
  );

  app.post(
    '/cases/:id/set-status',
    {
      config: { scopes: ['cases:write'] },
      schema: {
        summary: 'Set a case’s status',
        description:
          'C131.1: by the version’s transitions, with a resolution, comment and status tag where ' +
          'the status asks for them.',
        tags: TAGS,
        params,
        body: setCaseStatusBodySchema,
        response: {
          200: caseDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 410, 422),
        },
      },
    },
    (request) => setCaseStatus(deps, workflowActingOf(request), request.params.id, request.body),
  );

  app.post(
    '/cases/:id/add-comment',
    {
      config: { scopes: ['cases:write'] },
      schema: {
        summary: 'Comment on a case',
        description:
          'C134.1, C134.3: plain text with `@[usr_…]` mentions; fires `case-comment.created`.',
        tags: TAGS,
        params,
        body: addCaseCommentBodySchema,
        response: {
          200: caseDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 410, 422),
        },
      },
    },
    (request) => addCaseComment(deps, workflowActingOf(request), request.params.id, request.body),
  );

  app.post(
    '/cases/:id/add-objects',
    {
      config: { scopes: ['cases:write'] },
      schema: {
        summary: 'Attach objects to a case',
        description:
          'C136.1-C136.3: each once, with its state as attached, at most 1,000 per case ' +
          '(`case_objects_limit`).',
        tags: TAGS,
        params,
        body: addCaseObjectsBodySchema,
        response: {
          200: caseDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 410, 422),
        },
      },
    },
    (request) => addCaseObjects(deps, workflowActingOf(request), request.params.id, request.body),
  );

  app.post(
    '/cases/:id/remove-objects',
    {
      config: { scopes: ['cases:write'] },
      schema: {
        summary: 'Remove objects from a case',
        description: 'C136.2: removing an object the case does not hold changes nothing.',
        tags: TAGS,
        params,
        body: removeCaseObjectsBodySchema,
        response: {
          200: caseDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 410, 422),
        },
      },
    },
    (request) =>
      removeCaseObjects(deps, workflowActingOf(request), request.params.id, request.body),
  );

  app.post(
    '/cases/:id/add-tag',
    {
      config: { scopes: ['cases:write'] },
      schema: {
        summary: 'Tag a case',
        description: 'C136.5: at most 50 tags; fires `case.updated-tags`.',
        tags: TAGS,
        params,
        body: addCaseTagBodySchema,
        response: {
          200: caseDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 410, 422),
        },
      },
    },
    (request) => addCaseTag(deps, workflowActingOf(request), request.params.id, request.body),
  );

  app.post(
    '/cases/:id/remove-tag',
    {
      config: { scopes: ['cases:write'] },
      schema: {
        summary: 'Remove a tag from a case',
        description: 'C136.5.',
        tags: TAGS,
        params,
        body: removeCaseTagBodySchema,
        response: {
          200: caseDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 410, 422),
        },
      },
    },
    (request) => removeCaseTag(deps, workflowActingOf(request), request.params.id, request.body),
  );

  app.post(
    '/cases/:id/set-tags',
    {
      config: { scopes: ['cases:write'] },
      schema: {
        summary: 'Set a case’s tags',
        description: 'C136.5: replaces every tag.',
        tags: TAGS,
        params,
        body: setCaseTagsBodySchema,
        response: {
          200: caseDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 410, 422),
        },
      },
    },
    (request) => setCaseTags(deps, workflowActingOf(request), request.params.id, request.body),
  );

  app.post(
    '/cases/search',
    {
      config: { scopes: ['cases:read'] },
      schema: {
        summary: 'Search cases',
        description:
          'C137.2: an and/or/not tree of at most two levels, read-after-write. A `fields.*` leaf ' +
          'needs PII visibility (403 naming `pii:view`). Limited by `case-search` (C143.3).',
        tags: TAGS,
        body: caseSearchBodySchema,
        response: { 200: caseSearchDocumentSchema, ...problemResponses(400, 401, 403, 422, 429) },
      },
    },
    (request) => searchCases(deps, workflowActingOf(request), request.body),
  );

  app.post(
    '/cases/bulk',
    {
      config: { scopes: ['cases:write'] },
      schema: {
        summary: 'Apply an action to many cases',
        description:
          'C137.4: at most 500 cases, by ids or a search, applied asynchronously through the ' +
          'single-case rules; assignment needs `cases:assign` too. Read the outcomes with ' +
          '`GET /case-bulk-actions/:id`.',
        tags: TAGS,
        body: createCaseBulkActionBodySchema,
        response: {
          202: caseBulkActionDocumentSchema,
          ...problemResponses(400, 401, 403, 422),
        },
      },
    },
    async (request, reply) => {
      const document = await createCaseBulkAction(deps, workflowActingOf(request), request.body);
      return reply.code(202).send(document);
    },
  );

  app.get(
    '/case-bulk-actions/:id',
    {
      config: { scopes: ['cases:read'] },
      schema: {
        summary: 'Retrieve a bulk action',
        description:
          'C137.4: its counts and per-case outcomes, for the principal that made it alone ' +
          '(Stage 1a amendment 19).',
        tags: TAGS,
        params: z.object({ id: idSchema('cblk') }),
        response: { 200: caseBulkActionDocumentSchema, ...problemResponses(401, 403, 404) },
      },
    },
    (request) => getCaseBulkAction(deps, workflowActingOf(request), request.params.id),
  );

  app.get(
    '/cases/:id/history',
    {
      config: { scopes: ['cases:read'] },
      schema: {
        summary: 'List a case’s history',
        description:
          'C131.4: the timeline, newest first, paged by the row’s number. It holds keys, ids and ' +
          'statuses, never a value.',
        tags: TAGS,
        params,
        querystring: listCaseHistoryQuerySchema,
        response: { 200: caseHistoryListDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    (request) => listCaseHistory(deps, workflowActingOf(request), request.params.id, request.query),
  );

  app.get(
    '/cases/:id/objects',
    {
      config: { scopes: ['cases:read'] },
      schema: {
        summary: 'List a case’s held objects',
        description:
          'C136.3: each with its state as attached. Holding grants nothing: the live object is ' +
          'read through its own route and scope.',
        tags: TAGS,
        params,
        querystring: listCaseHeldObjectsQuerySchema,
        response: {
          200: caseHeldObjectListDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) =>
      listCaseHeldObjects(deps, workflowActingOf(request), request.params.id, request.query),
  );

  done();
};

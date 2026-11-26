import {
  addTagBodySchema,
  approveInquiryBodySchema,
  createInquiryBodySchema,
  declineInquiryBodySchema,
  expireInquiryBodySchema,
  generateOneTimeLinkBodySchema,
  generateOneTimeLinkDocumentSchema,
  filterValues,
  getInquiryQuerySchema,
  idSchema,
  inquiryIncludeDocumentSchema,
  inquiryIncludeSchema,
  inquiryDocumentSchema,
  inquiryListDocumentSchema,
  listInquiriesQuerySchema,
  type INQUIRY_INCLUDES,
  markInquiryForReviewBodySchema,
  performSimulateActionsBodySchema,
  redactInquiryBodySchema,
  removeTagBodySchema,
  resumeInquiryDocumentSchema,
  setTagsBodySchema,
  updateInquiryBodySchema,
} from '@openverify/contracts';
import type { InquiryStatus, Permission } from '@openverify/core';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { piiMaskFor } from '../../auth/pii.js';
import { PermissionDeniedError } from '../../errors.js';
import { NO_STORE, problemResponses } from '../../plugins/openapi.js';
import { authorizePrincipal, requirePrincipal } from '../../plugins/principal-auth.js';
import { actorOf } from '../../ports.js';
import { serviceContextOf, type ApiDependencies } from '../../services/context.js';
import {
  changeInquiryTags,
  createInquiry,
  getInquiryDocument,
  INQUIRIES_PATH,
  listInquiries,
  performInquiryAction,
  redactInquiry,
  resumeInquiry,
  updateInquiry,
  type Acting,
} from '../../services/inquiries.js';
import type { InquiryDecisionInput } from '../../services/decisions/record.js';
import { generateOneTimeLink } from '../../services/one-time-links.js';
import { performSimulateActions } from '../../services/simulate.js';
import { createInquiryWithShareToken } from '../../services/connect/client-side.js';

/**
 * An action body that may be left out. Fastify validates a request without a body as `null`
 * (not `undefined`), which the contract's optional action bodies refuse, so `null` is accepted
 * here and means "no body".
 */
export function optionalBody<Schema extends z.ZodType>(schema: Schema) {
  return schema.nullable();
}

const TAGS = ['inquiries'];
const params = z.object({ id: idSchema('inq') });
const WRITE: { scopes: readonly Permission[] } = { scopes: ['inquiries:write'] };

/**
 * What each `include` of `GET /inquiries/:id` needs beyond `inquiries:read` (Workflow 2D K001):
 * included resources are their own route's view, so they need that route's permission.
 */
const INCLUDE_PERMISSIONS: Record<(typeof INQUIRY_INCLUDES)[number], readonly Permission[]> = {
  verifications: ['verifications:read'],
  // C40.1: the captures are the `GET /selfies/:id` view.
  selfies: ['verifications:read'],
  // C70.5 (Phase 6, F08): the inquiry's reports, masked as `GET /reports/:id` serves them. Until
  // Workflow 6A Stage 1b adds `includedReportsFor`, no report exists to include.
  reports: ['reports:read'],
  // C107.6 (Workflow 7B): the `GET /list-matches` view; `api-lists` serves them.
  'list-matches': ['lists:read'],
  // C128.1 (Workflow 8A): `inquiries:read` alone; `api-actions` serves them, comments masked.
  decisions: [],
};

/**
 * Who the request acts for (C12, C15): the principal's tenant with the request id, client
 * address and user agent for audit entries, the audit actor, and the PII it may see.
 */
export function actingOf(request: FastifyRequest): Acting {
  const principal = requirePrincipal(request);
  return {
    ctx: serviceContextOf(principal, {
      requestId: request.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    }),
    actor: actorOf(principal),
    mask: piiMaskFor(principal),
    environmentKind: principal.environmentKind,
  };
}

/** C128.1, C128.2: what an API decision declares, from the body of its status action. */
function decisionOf(body: unknown): InquiryDecisionInput {
  const meta = (body as { meta?: { 'solely-automated'?: boolean; comment?: string } } | undefined)
    ?.meta;
  return {
    ...(meta?.['solely-automated'] === undefined
      ? {}
      : { solelyAutomated: meta['solely-automated'] }),
    ...(meta?.comment === undefined ? {} : { comment: meta.comment }),
  };
}

/** C10 status actions: the target status and a description for OpenAPI. */
const STATUS_ACTIONS = [
  {
    path: 'approve',
    to: 'approved',
    body: optionalBody(approveInquiryBodySchema),
    summary: 'Approve an inquiry',
    description: '`completed`, `failed` or `needs_review` → `approved`.',
  },
  {
    path: 'decline',
    to: 'declined',
    body: optionalBody(declineInquiryBodySchema),
    summary: 'Decline an inquiry',
    description: '`completed`, `failed` or `needs_review` → `declined`.',
  },
  {
    path: 'mark-for-review',
    to: 'needs_review',
    body: optionalBody(markInquiryForReviewBodySchema),
    summary: 'Mark an inquiry for review',
    description: '`completed` or `failed` → `needs_review`.',
  },
  {
    path: 'expire',
    to: 'expired',
    body: optionalBody(expireInquiryBodySchema),
    summary: 'Expire an inquiry',
    description:
      '`created` or `pending` → `expired`. Active sessions and `initiated` verifications ' +
      'are canceled.',
  },
] as const satisfies readonly {
  path: string;
  to: InquiryStatus;
  body: unknown;
  summary: string;
  description: string;
}[];

/** C2 and C10 inquiry routes, under `/api/v1`. */
export const inquiryRoutes: FastifyPluginCallbackZod<ApiDependencies> = (app, deps, done) => {
  app.post(
    '/inquiries',
    {
      config: WRITE,
      schema: {
        summary: 'Create an inquiry',
        description:
          'The inquiry starts in status `created` on the template current version and ' +
          '`inquiry.created` is emitted. Its account is `account-id`, else the account with ' +
          '`reference-id` (created when missing), else a new account (C13).',
        tags: TAGS,
        body: createInquiryBodySchema,
        response: {
          201: inquiryDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 422),
        },
      },
    },
    async (request, reply) => {
      // C238.5 (Workflow 11A Stage 1b (K), `foundation-11a`'s hook): an inquiry for a share token is
      // created and the token reserved in one transaction (`api-consent`'s client-side.ts).
      const meta = request.body.meta;
      // C238.5 (integration-11a, api-consent's deviation): reserving a share token is a redemption,
      // so the principal also needs connect-share-tokens:redeem.
      if (
        meta?.['share-token-id'] !== undefined &&
        !requirePrincipal(request).permissions.has('connect-share-tokens:redeem')
      ) {
        throw new PermissionDeniedError(
          'Creating an inquiry for a share token needs connect-share-tokens:redeem.',
          ['connect-share-tokens:redeem'],
        );
      }
      // C151.10 (Workflow 9B): `meta`'s expiry windows, for this inquiry only.
      const inquiry =
        meta?.['share-token-id'] === undefined
          ? await createInquiry(deps, actingOf(request), request.body.data.attributes, meta)
          : await createInquiryWithShareToken(
              deps,
              actingOf(request),
              request.body.data.attributes,
              meta,
            );
      return reply
        .code(201)
        .header('location', `${INQUIRIES_PATH}/${inquiry.id}`)
        .send({ data: inquiry });
    },
  );

  app.get(
    '/inquiries/:id',
    {
      config: { scopes: ['inquiries:read'] },
      schema: {
        summary: 'Fetch an inquiry',
        description:
          '`?include=verifications` adds the verifications with their checks, and ' +
          '`?include=selfies` the selfie captures, newest first (C40.1); both may be given, ' +
          'comma-separated. Each also needs `verifications:read`, else 403 `forbidden` ' +
          '(Workflow 2D K001). `relationships.selfies` lists the captures. Without ' +
          '`pii:view`, a user sees `fields` values and `note` as null.',
        tags: TAGS,
        params,
        querystring: getInquiryQuerySchema,
        response: { 200: inquiryIncludeDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    (request) => {
      const include = filterValues(request.query.include, inquiryIncludeSchema) ?? [];
      for (const name of include) {
        authorizePrincipal(requirePrincipal(request), INCLUDE_PERMISSIONS[name]);
      }
      return getInquiryDocument(deps, actingOf(request), request.params.id, include);
    },
  );

  app.get(
    '/inquiries',
    {
      config: { scopes: ['inquiries:read'] },
      schema: {
        summary: 'List inquiries, newest first',
        description:
          'Filters take comma-separated values meaning OR, except `reference-id`. C165.3: ' +
          '`filter[list-match]`, `filter[list-id]`, `filter[check]` with `filter[check-status]` and ' +
          '`filter[next-step-name]` (with PII visibility) answer 501 until built, never an ' +
          'unfiltered list.',
        tags: TAGS,
        querystring: listInquiriesQuerySchema,
        response: { 200: inquiryListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => listInquiries(deps, actingOf(request), request.query),
  );

  app.patch(
    '/inquiries/:id',
    {
      config: WRITE,
      schema: {
        summary: 'Update an inquiry',
        description:
          '`fields` are merged and change only while the inquiry is `created` or `pending`; ' +
          '`reference-id` and `note` (encrypted) change at any time.',
        tags: TAGS,
        params,
        body: updateInquiryBodySchema,
        response: {
          200: inquiryDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 410),
        },
      },
    },
    async (request) => ({
      data: await updateInquiry(
        deps,
        actingOf(request),
        request.params.id,
        request.body.data.attributes,
      ),
    }),
  );

  app.post(
    '/inquiries/:id/resume',
    {
      config: WRITE,
      schema: {
        summary: 'Open a hosted-flow session for an inquiry',
        description:
          'Returns a new session token (valid for the template `session-expiration-seconds`, ' +
          '24 hours by default) and the flow URL that carries it in its fragment. Only open ' +
          'inquiries (`created`, `pending`) can be resumed; a redacted one answers 410 `redacted`.',
        tags: TAGS,
        params,
        response: {
          200: resumeInquiryDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 410),
        },
      },
    },
    async (request, reply) => {
      const document = await resumeInquiry(deps, actingOf(request), request.params.id);
      return reply.header('cache-control', NO_STORE).send(document);
    },
  );

  for (const action of STATUS_ACTIONS) {
    app.post(
      `/inquiries/:id/${action.path}`,
      {
        config: WRITE,
        schema: {
          summary: action.summary,
          description: `${action.description} Emits the status event and \`inquiry.transitioned\`.`,
          tags: TAGS,
          params,
          body: action.body,
          response: { 200: inquiryDocumentSchema, ...problemResponses(400, 401, 403, 404, 409) },
        },
      },
      async (request) => ({
        data: await performInquiryAction(
          deps,
          actingOf(request),
          request.params.id,
          action.to,
          decisionOf(request.body),
        ),
      }),
    );
  }

  app.post(
    '/inquiries/:id/add-tag',
    {
      config: WRITE,
      schema: {
        summary: 'Add a tag to an inquiry',
        description: 'A tag already present, ignoring case, changes nothing.',
        tags: TAGS,
        params,
        body: addTagBodySchema,
        response: { 200: inquiryDocumentSchema, ...problemResponses(400, 401, 403, 404, 422) },
      },
    },
    async (request) => ({
      data: await changeInquiryTags(deps, actingOf(request), request.params.id, {
        kind: 'add',
        tag: request.body.meta['tag-name'],
      }),
    }),
  );

  app.post(
    '/inquiries/:id/remove-tag',
    {
      config: WRITE,
      schema: {
        summary: 'Remove a tag from an inquiry',
        description: 'Ignores case.',
        tags: TAGS,
        params,
        body: removeTagBodySchema,
        response: { 200: inquiryDocumentSchema, ...problemResponses(400, 401, 403, 404) },
      },
    },
    async (request) => ({
      data: await changeInquiryTags(deps, actingOf(request), request.params.id, {
        kind: 'remove',
        tag: request.body.meta['tag-name'],
      }),
    }),
  );

  app.post(
    '/inquiries/:id/set-tags',
    {
      config: WRITE,
      schema: {
        summary: 'Replace the tags of an inquiry',
        description: 'Duplicates, ignoring case, keep their first spelling.',
        tags: TAGS,
        params,
        body: setTagsBodySchema,
        response: { 200: inquiryDocumentSchema, ...problemResponses(400, 401, 403, 404, 422) },
      },
    },
    async (request) => ({
      data: await changeInquiryTags(deps, actingOf(request), request.params.id, {
        kind: 'set',
        tags: request.body.meta['tag-names'],
      }),
    }),
  );

  app.post(
    '/inquiries/:id/generate-one-time-link',
    {
      config: WRITE,
      schema: {
        summary: 'Generate a single-use link to the hosted flow',
        description:
          'For `created` or `pending` inquiries. Older unused links are revoked. The link ' +
          'lives `expires-in-seconds`, else the inquiry `one-time-link-expiration-seconds`, else ' +
          'the template `one-time-link-expiration-seconds`, ' +
          'and never past the inquiry `expires-at`. A redacted inquiry answers 410 `redacted`.',
        tags: TAGS,
        params,
        body: optionalBody(generateOneTimeLinkBodySchema),
        response: {
          200: generateOneTimeLinkDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 410),
        },
      },
    },
    async (request, reply) => {
      const document = await generateOneTimeLink(
        deps,
        actingOf(request),
        request.params.id,
        request.body?.meta?.['expires-in-seconds'],
      );
      return reply.header('cache-control', NO_STORE).send(document);
    },
  );

  app.post(
    '/inquiries/:id/perform-simulate-actions',
    {
      config: WRITE,
      schema: {
        summary: 'Run simulated lifecycle actions (sandbox only)',
        description:
          'The actions run in order, each through the normal transitions and with their ' +
          'events. If one is not allowed, none is applied. Production answers 403 `sandbox-only`.',
        tags: TAGS,
        params,
        body: performSimulateActionsBodySchema,
        response: { 200: inquiryDocumentSchema, ...problemResponses(400, 401, 403, 404, 409) },
      },
    },
    async (request) => ({
      data: await performSimulateActions(
        deps,
        actingOf(request),
        request.params.id,
        request.body.meta.actions,
      ),
    }),
  );

  app.post(
    '/inquiries/:id/redact',
    {
      config: { scopes: ['inquiries:redact'] },
      schema: {
        summary: 'Redact an inquiry',
        description:
          'Irreversible and idempotent: files, fields, notes and stored event payloads of the ' +
          'inquiry are removed (C16). When a file could not be deleted from storage the answer ' +
          'is 503, and repeating the request finishes the redaction.',
        tags: TAGS,
        params,
        body: optionalBody(redactInquiryBodySchema),
        response: { 200: inquiryDocumentSchema, ...problemResponses(400, 401, 403, 404, 503) },
      },
    },
    async (request) => ({
      data: await redactInquiry(deps, actingOf(request), request.params.id),
    }),
  );

  done();
};

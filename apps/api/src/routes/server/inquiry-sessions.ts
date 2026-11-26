import {
  expireAllInquirySessionsBodySchema,
  expireAllInquirySessionsResponseSchema,
  expireInquirySessionBodySchema,
  filterValues,
  generateOneTimeLinkBodySchema,
  generateSessionOneTimeLinkDocumentSchema,
  getInquirySessionQuerySchema,
  idSchema,
  inquirySessionDocumentSchema,
  inquirySessionIncludeDocumentSchema,
  inquirySessionIncludeSchema,
  inquirySessionListDocumentSchema,
  listInquirySessionsQuerySchema,
} from '@openverify/contracts';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problemResponses } from '../../plugins/openapi.js';
import type { ApiDependencies } from '../../services/context.js';
import {
  expireAllInquirySessions,
  expireInquirySession,
  getInquirySessionDocument,
  listInquirySessions,
} from '../../services/inquiry-sessions.js';
import {
  expireSessionsForInquiries,
  generateSessionOneTimeLink,
} from '../../services/signals/sessions.js';
import { NO_STORE } from '../../plugins/openapi.js';
import { actingOf, optionalBody } from './inquiries.js';

const TAGS = ['inquiry-sessions'];
const params = z.object({ id: idSchema('iqse') });

/**
 * C10 inquiry session routes (scopes `inquiry-sessions:*`), under `/api/v1`. Session tokens
 * are never readable; `ip-address` and `user-agent` are null for a user without `pii:view`.
 */
export const inquirySessionRoutes: FastifyPluginCallbackZod<ApiDependencies> = (
  app,
  deps,
  done,
) => {
  app.get(
    '/inquiry-sessions',
    {
      config: { scopes: ['inquiry-sessions:read'] },
      schema: {
        summary: 'List inquiry sessions, newest first',
        tags: TAGS,
        querystring: listInquirySessionsQuerySchema,
        response: { 200: inquirySessionListDocumentSchema, ...problemResponses(400, 401, 403) },
      },
    },
    (request) => listInquirySessions(deps, actingOf(request), request.query),
  );

  app.get(
    '/inquiry-sessions/:id',
    {
      config: { scopes: ['inquiry-sessions:read'] },
      schema: {
        summary: 'Fetch an inquiry session',
        description:
          'C91.1 (Workflow 7A): the network facts, parsed device fields and collection tiers, and ' +
          'the `device` and `network` relationships. `?include=device,network` adds both ' +
          'resources (each needs `inquiry-sessions:read`); without `pii:view` the address, user ' +
          'agent, region, point and fingerprints are `null`.',
        tags: TAGS,
        params,
        querystring: getInquirySessionQuerySchema,
        response: {
          200: inquirySessionIncludeDocumentSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    (request) =>
      getInquirySessionDocument(
        deps,
        actingOf(request),
        request.params.id,
        filterValues(request.query.include, inquirySessionIncludeSchema) ?? [],
      ),
  );

  app.post(
    '/inquiry-sessions/:id/expire',
    {
      config: { scopes: ['inquiry-sessions:write'] },
      schema: {
        summary: 'Expire an inquiry session',
        description:
          'Its token stops working at once (`session_expired`). Emits `inquiry-session.expired`.',
        tags: TAGS,
        params,
        body: optionalBody(expireInquirySessionBodySchema),
        response: {
          200: inquirySessionDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409),
        },
      },
    },
    async (request) => ({
      data: await expireInquirySession(deps, actingOf(request), request.params.id),
    }),
  );

  app.post(
    '/inquiry-sessions/expire-all',
    {
      config: { scopes: ['inquiry-sessions:write'] },
      schema: {
        summary: 'Expire every active session of an inquiry, or of several',
        description:
          'Emits `inquiry-session.expired` for each and returns how many there were. ' +
          '`meta.inquiry-id` names one inquiry; the public `meta.inquiry-ids` names 1 to 100 ' +
          '(C91.5).',
        tags: TAGS,
        body: expireAllInquirySessionsBodySchema,
        response: {
          200: expireAllInquirySessionsResponseSchema,
          ...problemResponses(400, 401, 403, 404),
        },
      },
    },
    async (request) => {
      const { meta } = request.body;
      if ('inquiry-ids' in meta) {
        const { expiredCount } = await expireSessionsForInquiries(
          deps,
          actingOf(request),
          meta['inquiry-ids'],
        );
        return { meta: { 'expired-count': expiredCount } };
      }
      return expireAllInquirySessions(deps, actingOf(request), meta['inquiry-id']);
    },
  );

  app.post(
    '/inquiry-sessions/:id/generate-one-time-link',
    {
      config: { scopes: ['inquiries:write'] },
      schema: {
        summary: "Generate a single-use link to the session's inquiry",
        description:
          "C91.5: a C10 one-time link for the inquiry of the session, with C10's revocation of " +
          'older unused links. The link lives `expires-in-seconds`, else the template ' +
          '`one-time-link-expiration-seconds`. `meta.one-time-link-short` is always `null`.',
        tags: TAGS,
        params,
        body: optionalBody(generateOneTimeLinkBodySchema),
        response: {
          200: generateSessionOneTimeLinkDocumentSchema,
          ...problemResponses(400, 401, 403, 404, 409, 410),
        },
      },
    },
    async (request, reply) => {
      const acting = actingOf(request);
      const link = await generateSessionOneTimeLink(
        deps,
        acting,
        request.params.id,
        request.body?.meta?.['expires-in-seconds'],
      );
      const document = await getInquirySessionDocument(deps, acting, request.params.id);
      return reply.header('cache-control', NO_STORE).send({
        data: document.data,
        meta: {
          'one-time-link': link.oneTimeLink,
          'one-time-link-short': null,
          'expires-at': link.expiresAt.toISOString(),
        },
      });
    },
  );

  done();
};

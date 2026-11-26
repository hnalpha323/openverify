import {
  dashboardAcceptInvitationBodySchema,
  dashboardInvitationResponseSchema,
  idSchema,
  resendInvitationBodySchema,
  toTimestamp,
  userDocumentSchema,
} from '@openverify/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { NO_STORE, problemResponses } from '../../plugins/openapi.js';
import { enforceRoutePolicy } from '../../plugins/rate-limit.js';
import { acceptInvitation, resendInvitation } from '../../services/users.js';
import { operatorChange, type AdminRouteContext } from './admin-context.js';
import { DASHBOARD_TAG, USER_SESSION_SECURITY } from './openapi.js';

/** `POST /invitations/accept` (C15): takes no session; the `ovi_` token is the credential. */
export const invitationRoutes: FastifyPluginAsyncZod<AdminRouteContext> = (app, context) => {
  app.post(
    '/invitations/accept',
    {
      schema: {
        summary: 'Accept an invitation',
        description:
          'Sets the name and password (at least 12 characters, stored as Argon2id) of the ' +
          'invited user, who can then sign in. The token works once, for 7 days.',
        tags: [DASHBOARD_TAG],
        security: [],
        body: dashboardAcceptInvitationBodySchema,
        response: { 200: userDocumentSchema, ...problemResponses(400, 404) },
      },
    },
    async (request, reply) => {
      const userAgent = request.headers['user-agent'];
      const user = await acceptInvitation(
        { ...context, hasher: context.operatorAuth.hasher },
        request.body,
        {
          requestId: request.id,
          ipAddress: context.operatorAuth.clientAddress(request),
          ...(userAgent === undefined ? {} : { userAgent }),
        },
      );
      return reply.header('cache-control', NO_STORE).send({ data: user });
    },
  );
  return Promise.resolve();
};

/**
 * C168.1 (Workflow 9B): `POST /invitations/:id/resend` behind the operator's session (`users:write`).
 * Invitations live on the user row, so the id is the invited user's `usr_` (contracts B26): a new
 * `ovi_` token, the old one revoked, 7 days. The `invitations-resend` policy (5 an hour per
 * invitation) is counted first. Frozen at 501 by `foundation-9b` (Stage 1b (U)), built by
 * `api-access`.
 */
export const invitationResendRoutes: FastifyPluginAsyncZod<AdminRouteContext> = (app, context) => {
  app.post(
    '/invitations/:id/resend',
    {
      config: { scopes: ['users:write'] },
      schema: {
        summary: 'Resend an invitation',
        description:
          'Emails a new link to the invited user, valid 7 days, and revokes the old one; the token ' +
          'is never returned. At most 5 an hour per invitation (429).',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        params: z.strictObject({ id: idSchema('usr') }),
        body: resendInvitationBodySchema,
        response: {
          201: dashboardInvitationResponseSchema,
          ...problemResponses(400, 401, 403, 404, 409, 429, 502, 503),
        },
      },
    },
    async (request, reply) => {
      if (context.rateLimiter !== undefined) {
        await enforceRoutePolicy(
          context.rateLimiter,
          'invitations-resend',
          request.params.id,
          'This invitation was resent too often; try again later.',
        );
      }
      const invitation = await resendInvitation(
        context,
        operatorChange(request, context),
        request.params.id,
      );
      return reply
        .code(201)
        .header('cache-control', NO_STORE)
        .send({
          email: invitation.email,
          'role-ids': invitation.roleIds,
          'expires-at': toTimestamp(invitation.expiresAt),
        });
    },
  );
  return Promise.resolve();
};

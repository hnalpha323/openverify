import {
  dashboardLoginBodySchema,
  dashboardMeDocumentSchema,
  dashboardMfaChallengeResponseSchema,
  dashboardMfaLoginBodySchema,
  dashboardSessionResponseSchema,
  dashboardWebauthnLoginOptionsBodySchema,
  dashboardWebauthnLoginOptionsResponseSchema,
  dashboardWebauthnLoginVerifyBodySchema,
  STEP_UP_WINDOW_SECONDS,
  idSchema,
  revokeOtherSessionsResponseSchema,
  stepUpBodySchema,
  stepUpResponseSchema,
  toTimestamp,
  userSessionListDocumentSchema,
  webauthnRequestOptionsSchema,
} from '@openverify/contracts';
import { PERMISSIONS } from '@openverify/core';
import { listEnvironments, listUserRoles } from '@openverify/db';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { MfaSessionResult, SessionResult } from '../../operator-auth/index.js';
import { NO_STORE, problemResponses } from '../../plugins/openapi.js';
import {
  listMySessions,
  revokeMyOtherSessions,
  revokeMySession,
} from '../../services/access/sessions.js';
import { createAuditLogger } from '../../services/audit-log.js';
import { auditEntryOf } from '../../services/context.js';
import { toUserResource } from '../../services/users.js';
import { dashboardContextOf, requireOperator, userActor } from './authenticate.js';
import type { DashboardContext } from './context.js';
import { DASHBOARD_TAG, USER_SESSION_SECURITY } from './openapi.js';

/** Audit `resource_type` of operator sessions. */
const USER_SESSION_RESOURCE = 'user-session';

/** The DB-backed audit logger: these routes run with the dashboard context only. */
const audit = createAuditLogger();

/** Records the new session and answers 201 with its token, uncached. */
async function sendSession(
  context: DashboardContext,
  request: FastifyRequest,
  reply: FastifyReply,
  result: SessionResult | MfaSessionResult,
) {
  const { token, expiresAt, session, user } = result;
  await audit.record(
    context.db,
    auditEntryOf(dashboardContextOf(request, context.operatorAuth, session), userActor(user.id), {
      action: 'user-session.created',
      resourceType: USER_SESSION_RESOURCE,
      resourceId: session.id,
      ...('method' in result ? { metadata: { mfa: result.method } } : {}),
    }),
  );
  // The body carries a bearer token: no cache may keep it (RFC 6749 §5.1).
  return reply
    .code(201)
    .header('cache-control', NO_STORE)
    .send({ token, 'expires-at': toTimestamp(expiresAt), user: toUserResource(user) });
}

const credentialOf = (credential: unknown) => credential as AuthenticationResponseJSON;

/**
 * The dashboard routes without a session: `POST /sessions` (C4, answering 202 with an
 * `mfa-token` for users with MFA) and the C15 second-factor routes that complete it.
 */
export const loginRoutes: FastifyPluginAsyncZod<DashboardContext> = (app, context) => {
  const { operatorAuth } = context;

  app.post(
    '/sessions',
    {
      schema: {
        summary: 'Sign an operator in',
        description:
          'Verifies the email and password (Argon2id). Without MFA it opens a 12 hour user ' +
          'session (201). A user with an active MFA factor gets 202 with an `mfa-token` (5 ' +
          'minutes) and the factors to choose from; complete with `POST /sessions/mfa` or the ' +
          'WebAuthn pair. Every failure returns the same 401. Attempts are rate-limited per ' +
          'client address and per email (429 with Retry-After).',
        tags: [DASHBOARD_TAG],
        security: [],
        body: dashboardLoginBodySchema,
        response: {
          201: dashboardSessionResponseSchema,
          202: dashboardMfaChallengeResponseSchema,
          ...problemResponses(400, 401, 429),
        },
      },
    },
    async (request, reply) => {
      const outcome = await operatorAuth.login({
        email: request.body.email,
        password: request.body.password,
        ip: operatorAuth.clientAddress(request),
        // C248.8 (Workflow 11B, sso-oidc's borrowed edit): the optional sign-in name.
        organization: request.body.organization,
      });
      if (outcome.kind === 'mfa') {
        return reply
          .code(202)
          .header('cache-control', NO_STORE)
          .send({ 'mfa-token': outcome.mfaToken, factors: outcome.factors });
      }
      return sendSession(context, request, reply, outcome);
    },
  );

  app.post(
    '/sessions/mfa',
    {
      schema: {
        summary: 'Complete an MFA sign-in with a code',
        description:
          'Presents a TOTP code or a recovery code with the `mfa-token`. A recovery code works ' +
          'once. Five wrong codes revoke the `mfa-token`. A failure answers 401 with a `code`: ' +
          '`mfa_code_invalid` (a wrong code; the token can still be used), ' +
          '`mfa_attempts_exhausted` (the wrong code that revoked the token) or ' +
          '`mfa_token_invalid` (an unknown, expired, used or revoked token).',
        tags: [DASHBOARD_TAG],
        security: [],
        body: dashboardMfaLoginBodySchema,
        response: { 201: dashboardSessionResponseSchema, ...problemResponses(400, 401) },
      },
    },
    async (request, reply) => {
      const { body } = request;
      const result = await operatorAuth.completeMfa(
        'totp-code' in body
          ? { mfaToken: body['mfa-token'], totpCode: body['totp-code'] }
          : { mfaToken: body['mfa-token'], recoveryCode: body['recovery-code'] },
      );
      return sendSession(context, request, reply, result);
    },
  );

  app.post(
    '/sessions/mfa/webauthn/options',
    {
      schema: {
        summary: 'Start an MFA sign-in with a security key',
        description:
          'WebAuthn assertion options for the `mfa-token`, to pass to ' +
          '`navigator.credentials.get()`. Their challenge is bound to the token for 5 minutes.',
        tags: [DASHBOARD_TAG],
        security: [],
        body: dashboardWebauthnLoginOptionsBodySchema,
        response: {
          200: dashboardWebauthnLoginOptionsResponseSchema,
          ...problemResponses(400, 401, 409, 503),
        },
      },
    },
    async (request, reply) => {
      const options = await operatorAuth.webauthnLoginOptions(request.body['mfa-token']);
      // The library's W3C JSON types are interfaces; the contract states them as loose objects.
      return reply
        .header('cache-control', NO_STORE)
        .send({ options: options as unknown as z.infer<typeof webauthnRequestOptionsSchema> });
    },
  );

  app.post(
    '/sessions/mfa/webauthn/verify',
    {
      schema: {
        summary: 'Complete an MFA sign-in with a security key',
        description:
          'Verifies the WebAuthn assertion (origin, RP ID, signature and counter) for the ' +
          '`mfa-token` and opens the session. A failed assertion counts towards revoking the ' +
          'token. A failure answers 401 with the `code` of `POST /sessions/mfa`: ' +
          '`mfa_code_invalid`, `mfa_attempts_exhausted` or `mfa_token_invalid`.',
        tags: [DASHBOARD_TAG],
        security: [],
        body: dashboardWebauthnLoginVerifyBodySchema,
        response: { 201: dashboardSessionResponseSchema, ...problemResponses(400, 401, 503) },
      },
    },
    async (request, reply) => {
      const result = await operatorAuth.completeWebauthnMfa({
        mfaToken: request.body['mfa-token'],
        credential: credentialOf(request.body.credential),
      });
      return sendSession(context, request, reply, result);
    },
  );
  return Promise.resolve();
};

const PERMISSION_ORDER = new Map(PERMISSIONS.map((permission, index) => [permission, index]));

/**
 * `DELETE /sessions/current` and `GET /me`, behind operator authentication. C168.1, C168.4 (Workflow
 * 9B): the caller's own sessions, their revocation and the step-up, frozen at 501 by `foundation-9b`
 * (Stage 1b (U)) and built by `api-access`.
 */
export const sessionRoutes: FastifyPluginAsyncZod<DashboardContext> = (app, context) => {
  const { db, operatorAuth } = context;

  app.delete(
    '/sessions/current',
    {
      config: { allowWithoutMfa: true },
      schema: {
        summary: 'Sign the current operator out',
        description: 'Revokes the user session that authenticates this request.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        response: { 204: z.null().describe('The session is revoked.'), ...problemResponses(401) },
      },
    },
    async (request, reply) => {
      const operator = requireOperator(request);
      await operatorAuth.logout(operator.sessionId);
      await audit.record(
        db,
        auditEntryOf(
          dashboardContextOf(request, operatorAuth, operator),
          userActor(operator.user.id),
          {
            action: 'user-session.revoked',
            resourceType: USER_SESSION_RESOURCE,
            resourceId: operator.sessionId,
          },
        ),
      );
      return reply.code(204).send(null);
    },
  );

  const ownerOf = (operator: ReturnType<typeof requireOperator>) => ({
    organizationId: operator.organizationId,
    userId: operator.user.id,
    sessionId: operator.sessionId,
  });

  app.get(
    '/sessions',
    {
      schema: {
        summary: 'List my sessions',
        description:
          'C168.4: the caller’s own live sessions, newest first, each with a device summary from ' +
          'its user agent (never the agent itself), when it was created and last seen, when it ' +
          'expires and when a second factor was last checked on it; the current one is marked.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        response: { 200: userSessionListDocumentSchema, ...problemResponses(401) },
      },
    },
    async (request, reply) => {
      const operator = requireOperator(request);
      const document = await listMySessions(db, ownerOf(operator), operatorAuth.clock.now());
      return reply.header('cache-control', NO_STORE).send(document);
    },
  );

  app.post(
    '/sessions/revoke-others',
    {
      schema: {
        summary: 'Revoke my other sessions',
        description: 'C168.4: revokes every session of the caller but the current one.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        body: z.strictObject({}),
        response: { 200: revokeOtherSessionsResponseSchema, ...problemResponses(400, 401) },
      },
    },
    async (request) => {
      const operator = requireOperator(request);
      const revoked = await revokeMyOtherSessions(
        { db, audit },
        ownerOf(operator),
        dashboardContextOf(request, operatorAuth, operator),
        operatorAuth.clock.now(),
      );
      return { meta: { revoked } };
    },
  );

  app.post(
    '/sessions/:id/revoke',
    {
      schema: {
        summary: 'Revoke one of my sessions',
        description: 'C168.4: revokes one of the caller’s own sessions (404 for any other).',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        params: z.strictObject({ id: idSchema('uss') }),
        body: z.strictObject({}),
        response: {
          204: z.null().describe('The session is revoked.'),
          ...problemResponses(400, 401, 404),
        },
      },
    },
    async (request, reply) => {
      const operator = requireOperator(request);
      await revokeMySession(
        { db, audit },
        ownerOf(operator),
        dashboardContextOf(request, operatorAuth, operator),
        request.params.id,
        operatorAuth.clock.now(),
      );
      return reply.code(204).send(null);
    },
  );

  app.post(
    '/sessions/current/step-up',
    {
      schema: {
        summary: 'Verify a second factor again',
        description:
          'C168.1 (contracts B26): a TOTP code or a passkey assertion, never a recovery code, ' +
          'verified on the current session, so it may reset another user’s MFA or reactivate a ' +
          'user for the next ten minutes.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        body: stepUpBodySchema,
        response: { 200: stepUpResponseSchema, ...problemResponses(400, 401, 429) },
      },
    },
    async (request, reply) => {
      const operator = requireOperator(request);
      const { body } = request;
      const result = await operatorAuth.stepUp({
        sessionId: operator.sessionId,
        user: operator.user,
        ip: operatorAuth.clientAddress(request),
        ...('totp-code' in body
          ? { totpCode: body['totp-code'] }
          : { credential: credentialOf(body.credential) }),
      });
      await audit.record(
        db,
        auditEntryOf(
          dashboardContextOf(request, operatorAuth, operator),
          userActor(operator.user.id),
          {
            action: 'user-session.stepped-up',
            resourceType: USER_SESSION_RESOURCE,
            resourceId: operator.sessionId,
            metadata: { mfa: result.method },
          },
        ),
      );
      return reply.header('cache-control', NO_STORE).send({
        'mfa-verified-at': toTimestamp(result.verifiedAt),
        'step-up-expires-at': toTimestamp(
          new Date(result.verifiedAt.getTime() + STEP_UP_WINDOW_SECONDS * 1000),
        ),
      });
    },
  );

  app.post(
    '/sessions/current/step-up/webauthn/options',
    {
      schema: {
        summary: 'Start a passkey step-up',
        description:
          'C168.1 (contracts B26): the WebAuthn request options for the current user’s passkeys.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        body: z.strictObject({}),
        response: {
          200: dashboardWebauthnLoginOptionsResponseSchema,
          ...problemResponses(400, 401),
        },
      },
    },
    async (request, reply) => {
      const operator = requireOperator(request);
      const options = await operatorAuth.stepUpWebauthnOptions(operator.user);
      // The library's W3C JSON types are interfaces; the contract states them as loose objects.
      return reply
        .header('cache-control', NO_STORE)
        .send({ options: options as unknown as z.infer<typeof webauthnRequestOptionsSchema> });
    },
  );

  app.get(
    '/me',
    {
      config: { allowWithoutMfa: true },
      schema: {
        summary: 'Get the current operator',
        description:
          'The user with its roles, and the session context: the environment, every environment ' +
          'of the organization (oldest first, for the switcher), the permissions the roles grant, ' +
          'and whether the session satisfied MFA.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        response: { 200: dashboardMeDocumentSchema, ...problemResponses(401) },
      },
    },
    async (request) => {
      const operator = requireOperator(request);
      const [roles, environments] = await Promise.all([
        listUserRoles(db, operator.organizationId, operator.user.id),
        listEnvironments(db, operator.organizationId),
      ]);
      const permissions = [...operator.permissions].sort(
        (a, b) => (PERMISSION_ORDER.get(a) ?? 0) - (PERMISSION_ORDER.get(b) ?? 0),
      );
      return {
        data: toUserResource(
          operator.user,
          roles.map(({ id }) => id),
        ),
        meta: {
          environment: { id: operator.environmentId, kind: operator.environmentKind },
          environments: environments.map(({ id, kind }) => ({ id, kind })),
          permissions,
          'mfa-satisfied': operator.mfaSatisfied,
        },
      };
    },
  );
  return Promise.resolve();
};

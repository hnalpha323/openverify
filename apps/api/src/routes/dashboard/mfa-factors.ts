import {
  buildMfaFactorResource,
  confirmTotpBodySchema,
  confirmTotpResponseSchema,
  enrollTotpBodySchema,
  enrollTotpResponseSchema,
  idSchema,
  mfaFactorListDocumentSchema,
  recoveryCodesResponseSchema,
  webauthnRegistrationOptionsBodySchema,
  webauthnRegistrationOptionsResponseSchema,
  webauthnRegistrationVerifyBodySchema,
  type MfaFactorResource,
  webauthnCreationOptionsSchema,
} from '@openverify/contracts';
import {
  markUserSessionMfaVerified,
  revokeOtherUserSessions,
  type MfaFactor,
} from '@openverify/db';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import type { preHandlerAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { MfaRequiredError } from '../../errors.js';
import { NO_STORE, problemResponses } from '../../plugins/openapi.js';
import { auditEntryOf } from '../../services/context.js';
import type { FactorActivation } from '../../services/mfa.js';
import { operatorChange, type AdminRouteContext } from './admin-context.js';
import { requireOperator } from './authenticate.js';
import { DASHBOARD_TAG, USER_SESSION_SECURITY } from './openapi.js';

/** The C15 factor resource; never the secret or the credential's key. */
export function toMfaFactorResource(factor: MfaFactor): MfaFactorResource {
  return buildMfaFactorResource({
    id: factor.id,
    kind: factor.type,
    name: factor.name,
    status: factor.confirmedAt === null ? 'pending' : 'active',
    createdAt: factor.createdAt,
    confirmedAt: factor.confirmedAt,
    lastUsedAt: factor.lastUsedAt,
  });
}

/** Routes a session that has not satisfied required MFA may call (C15). */
const ENROLMENT = { allowWithoutMfa: true } as const;

/**
 * C15 meant unsatisfied sessions for users without a factor, to enrol their first one. A
 * session that has not satisfied MFA while the user already has an active factor (a
 * password-only session from before the enrolment) must log in with that factor: it may not
 * enrol another factor, which would satisfy it, nor remove one (Workflow 2B F002).
 */
function firstFactorOnly(
  mfa: AdminRouteContext['operatorAuth']['mfa'],
): preHandlerAsyncHookHandler {
  return async (request) => {
    const operator = requireOperator(request);
    if (operator.mfaSatisfied) {
      return;
    }
    const factors = await mfa.listFactors(operator.organizationId, operator.user.id);
    if (factors.some((factor) => factor.confirmedAt !== null)) {
      throw new MfaRequiredError();
    }
  };
}

/**
 * C15 MFA enrolment for the signed-in user: TOTP (secret shown once, active after a code),
 * WebAuthn security keys, factor removal and recovery codes. Activating a factor satisfies
 * the current session's MFA requirement.
 */
export const mfaFactorRoutes: FastifyPluginAsyncZod<AdminRouteContext> = (app, context) => {
  const { db, audit, operatorAuth } = context;
  const { mfa } = operatorAuth;
  const preHandler = firstFactorOnly(mfa);

  /** Audits the activation, satisfies the session, and shapes the response. */
  async function activated(
    request: Parameters<typeof operatorChange>[0],
    activation: FactorActivation,
    action: string,
  ) {
    const operator = requireOperator(request);
    const change = operatorChange(request, context);
    const at = context.clock.now();
    // C168.1: the factor was just checked on this session; C168.4: every other session of the user
    // is revoked, so a session opened with a stolen password does not outlive the enrolment.
    await markUserSessionMfaVerified(db, operator.sessionId, at);
    const revoked = await revokeOtherUserSessions(
      db,
      operator.organizationId,
      operator.user.id,
      operator.sessionId,
      at,
    );
    await audit.record(
      db,
      auditEntryOf(change.ctx, change.actor, {
        action,
        resourceType: 'mfa-factor',
        resourceId: activation.factor.id,
        metadata: { kind: activation.factor.type },
      }),
    );
    if (revoked > 0) {
      await audit.record(
        db,
        auditEntryOf(change.ctx, change.actor, {
          action: 'user-session.others-revoked',
          resourceType: 'user-session',
          resourceId: operator.sessionId,
          metadata: { revoked, reason: 'mfa-factor-enrolled' },
        }),
      );
    }
    return {
      data: toMfaFactorResource(activation.factor),
      ...(activation.recoveryCodes === null
        ? {}
        : { meta: { 'recovery-codes': activation.recoveryCodes } }),
    };
  }

  app.get(
    '/me/mfa-factors',
    {
      config: ENROLMENT,
      schema: {
        summary: 'List my MFA factors',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        response: { 200: mfaFactorListDocumentSchema, ...problemResponses(401) },
      },
    },
    async (request) => {
      const operator = requireOperator(request);
      const factors = await mfa.listFactors(operator.organizationId, operator.user.id);
      return { data: factors.map(toMfaFactorResource), links: { next: null } };
    },
  );

  app.post(
    '/me/mfa-factors/totp',
    {
      config: ENROLMENT,
      preHandler,
      schema: {
        summary: 'Start enrolling an authenticator app',
        description:
          'Creates a pending TOTP factor and returns its secret and `otpauth-uri` this once. ' +
          'It becomes active with `POST /me/mfa-factors/totp/confirm`.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        body: enrollTotpBodySchema,
        response: { 201: enrollTotpResponseSchema, ...problemResponses(400, 401) },
      },
    },
    async (request, reply) => {
      const operator = requireOperator(request);
      const change = operatorChange(request, context);
      const enrolment = await mfa.enrollTotp(
        operator.organizationId,
        operator.user,
        request.body.name,
      );
      await audit.record(
        db,
        auditEntryOf(change.ctx, change.actor, {
          action: 'mfa-factor.created',
          resourceType: 'mfa-factor',
          resourceId: enrolment.factor.id,
          metadata: { kind: 'totp' },
        }),
      );
      return reply
        .code(201)
        .header('cache-control', NO_STORE)
        .send({
          data: toMfaFactorResource(enrolment.factor),
          meta: { 'otpauth-uri': enrolment.otpauthUri, secret: enrolment.secret },
        });
    },
  );

  app.post(
    '/me/mfa-factors/totp/confirm',
    {
      config: ENROLMENT,
      preHandler,
      schema: {
        summary: 'Activate an authenticator app',
        description:
          'Activates a pending TOTP factor with a current code. The first active factor comes ' +
          'with 10 recovery codes, shown this once.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        body: confirmTotpBodySchema,
        response: { 200: confirmTotpResponseSchema, ...problemResponses(400, 401, 404, 409, 422) },
      },
    },
    async (request, reply) => {
      const operator = requireOperator(request);
      const activation = await mfa.confirmTotp(
        operator.organizationId,
        operator.user.id,
        request.body['factor-id'],
        request.body['totp-code'],
      );
      const body = await activated(request, activation, 'mfa-factor.activated');
      return reply.header('cache-control', NO_STORE).send(body);
    },
  );

  app.post(
    '/me/mfa-factors/webauthn/options',
    {
      config: ENROLMENT,
      preHandler,
      schema: {
        summary: 'Start registering a security key',
        description:
          'WebAuthn creation options for `navigator.credentials.create()`; the challenge is ' +
          'valid for 5 minutes. A name goes with the verify call.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        body: webauthnRegistrationOptionsBodySchema,
        response: {
          200: webauthnRegistrationOptionsResponseSchema,
          ...problemResponses(400, 401, 503),
        },
      },
    },
    async (request, reply) => {
      const operator = requireOperator(request);
      const options = await mfa.webauthnRegistrationOptions(operator.organizationId, operator.user);
      // The library's W3C JSON types are interfaces; the contract states them as loose objects.
      return reply
        .header('cache-control', NO_STORE)
        .send({ options: options as unknown as z.infer<typeof webauthnCreationOptionsSchema> });
    },
  );

  app.post(
    '/me/mfa-factors/webauthn/verify',
    {
      config: ENROLMENT,
      preHandler,
      schema: {
        summary: 'Register a security key',
        description:
          'Verifies the registration for the issued challenge and stores the active factor. ' +
          'The first active factor comes with 10 recovery codes, shown this once.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        body: webauthnRegistrationVerifyBodySchema,
        response: { 201: confirmTotpResponseSchema, ...problemResponses(400, 401, 409, 422, 503) },
      },
    },
    async (request, reply) => {
      const operator = requireOperator(request);
      const activation = await mfa.verifyWebauthnRegistration(
        operator.organizationId,
        operator.user.id,
        request.body.credential as unknown as RegistrationResponseJSON,
        request.body.name,
      );
      const body = await activated(request, activation, 'mfa-factor.created');
      return reply.code(201).header('cache-control', NO_STORE).send(body);
    },
  );

  app.delete(
    '/me/mfa-factors/:id',
    {
      config: ENROLMENT,
      preHandler,
      schema: {
        summary: 'Remove one of my MFA factors',
        description: 'Removing the last active factor also removes the recovery codes.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        params: z.strictObject({ id: idSchema('mfa') }),
        response: {
          204: z.null().describe('The factor is removed.'),
          ...problemResponses(400, 401, 404),
        },
      },
    },
    async (request, reply) => {
      const operator = requireOperator(request);
      const change = operatorChange(request, context);
      await mfa.deleteFactor(operator.organizationId, operator.user.id, request.params.id);
      await audit.record(
        db,
        auditEntryOf(change.ctx, change.actor, {
          action: 'mfa-factor.deleted',
          resourceType: 'mfa-factor',
          resourceId: request.params.id,
        }),
      );
      return reply.code(204).send(null);
    },
  );

  app.post(
    '/me/recovery-codes',
    {
      schema: {
        summary: 'Regenerate my recovery codes',
        description:
          'A new set of 10 single-use recovery codes, shown this once; the previous codes stop ' +
          'working. Needs an active MFA factor.',
        tags: [DASHBOARD_TAG],
        security: USER_SESSION_SECURITY,
        body: z.strictObject({}).optional(),
        response: { 201: recoveryCodesResponseSchema, ...problemResponses(400, 401, 409) },
      },
    },
    async (request, reply) => {
      const operator = requireOperator(request);
      const change = operatorChange(request, context);
      const codes = await mfa.regenerateRecoveryCodes(operator.organizationId, operator.user.id);
      await audit.record(
        db,
        auditEntryOf(change.ctx, change.actor, {
          action: 'recovery-codes.regenerated',
          resourceType: 'user',
          resourceId: operator.user.id,
        }),
      );
      return reply.code(201).header('cache-control', NO_STORE).send({ 'recovery-codes': codes });
    },
  );
  return Promise.resolve();
};

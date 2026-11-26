import type { AuditActor } from '@openverify/contracts';
import type { FastifyRequest, onRequestAsyncHookHandler } from 'fastify';
import { MfaRequiredError, UnauthorizedError } from '../../errors.js';
import { enterRequestEventCause, eventCauseOf } from '../../events/cause-context.js';
import type { AuthenticatedOperator, OperatorAuth } from '../../operator-auth/index.js';
import { authorizePrincipal, parseBearerToken } from '../../plugins/principal-auth.js';
import type { ServiceContext, UserPrincipal } from '../../ports.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /**
     * C15: a session that has not satisfied the organization's required MFA may call this
     * dashboard route (`/me`, `/me/mfa-factors*`, `DELETE /sessions/current`). Every other
     * route answers such a session 401 `mfa-required`.
     */
    allowWithoutMfa?: boolean;
  }

  interface FastifyRequest {
    /** The signed-in operator on authenticated dashboard routes; `null` elsewhere. */
    operator: AuthenticatedOperator | null;
  }
}

/**
 * `onRequest` hook for the authenticated dashboard routes: resolves the `ovu_` bearer token
 * to its operator (C1, C4), then applies C15: a session that has not satisfied required MFA
 * reaches only routes marked `allowWithoutMfa` (else 401 `mfa-required`), and the operator
 * must hold the route's `config.scopes` permissions (else 403 `forbidden`). API keys are not
 * user sessions, so they never pass.
 */
export function authenticateOperator(auth: OperatorAuth): onRequestAsyncHookHandler {
  return async (request) => {
    const token = parseBearerToken(request.headers.authorization);
    // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
    if (token === undefined) {
      throw new UnauthorizedError(
        'A dashboard session is required. Send it as "Authorization: Bearer <token>".',
      );
    }
    // C245.2 (Workflow 11B Stage 1b (A)): a route marked `activity: false` does not slide the session.
    const operator = await auth.authenticate(token, {
      activity: request.routeOptions.config.activity !== false,
    });
    if (operator === null) {
      throw new UnauthorizedError('The dashboard session is not valid or has expired.', {
        error: 'invalid_token',
      });
    }
    request.operator = operator;
    const { config } = request.routeOptions;
    if (!operator.mfaSatisfied && config.allowWithoutMfa !== true) {
      throw new MfaRequiredError();
    }
    const principal = operatorPrincipal(operator);
    authorizePrincipal(principal, config.scopes ?? []);
    enterRequestEventCause(eventCauseOf(principal));
  };
}

/**
 * The operator of a request that passed {@link authenticateOperator}.
 * @throws {Error} when the route was registered without that hook: a programming error.
 */
export function requireOperator(request: FastifyRequest): AuthenticatedOperator {
  if (request.operator === null) {
    throw new Error('This route is not behind dashboard operator authentication');
  }
  return request.operator;
}

/** The operator as the C12 user principal, for permission checks and PII masking. */
export function operatorPrincipal(operator: AuthenticatedOperator): UserPrincipal {
  return {
    kind: 'user',
    userId: operator.user.id,
    userSessionId: operator.sessionId,
    organizationId: operator.organizationId,
    environmentId: operator.environmentId,
    environmentKind: operator.environmentKind,
    permissions: operator.permissions,
    mfaSatisfied: operator.mfaSatisfied,
  };
}

/** The audit actor of a user (C15): the user, not the session. */
export function userActor(userId: string): AuditActor {
  return { type: 'user', id: userId };
}

/**
 * The service context of a dashboard request: the tenant of `operator` (or of a user signing
 * in), and the request metadata audit entries record, with the operator's real address
 * behind the BFF (C15).
 */
export function dashboardContextOf(
  request: FastifyRequest,
  auth: OperatorAuth,
  tenant: { organizationId: string; environmentId: string },
): ServiceContext {
  const userAgent = request.headers['user-agent'];
  return {
    organizationId: tenant.organizationId,
    environmentId: tenant.environmentId,
    requestId: request.id,
    ipAddress: auth.clientAddress(request),
    ...(userAgent === undefined ? {} : { userAgent }),
  };
}

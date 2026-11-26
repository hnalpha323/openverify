import type { Db } from '@openverify/db';
import type { FastifyRequest } from 'fastify';
import { systemClock, type Clock, type PrincipalResolver } from '../ports.js';
import {
  DEFAULT_SESSION_RESOLUTION,
  findUserSessionContext,
  userPrincipalOf,
} from './session-context.js';
import type { SessionTimeouts } from './session-policy.js';

export interface UserSessionPrincipalResolverOptions {
  db: Db;
  clock?: Clock;
  /** C245.1 (Workflow 11B): the console's session limits; C245.1's defaults when left out. */
  sessionTimeouts?: SessionTimeouts;
}

/**
 * Resolves `ovu_` dashboard user session tokens to user principals for the server API (C12):
 * the session's current environment, the union of the user's role permissions (C15) and
 * whether the session satisfies the organization's MFA requirement (the principal plugin
 * answers 401 `mfa-required` when it does not). Returns `null` for malformed, unknown,
 * expired or revoked sessions and for deactivated users.
 */
export function createUserSessionPrincipalResolver(
  options: UserSessionPrincipalResolverOptions,
): PrincipalResolver {
  const clock = options.clock ?? systemClock;
  const timeouts = options.sessionTimeouts ?? DEFAULT_SESSION_RESOLUTION.timeouts;
  return async (token, request) => {
    // C245.2 (Workflow 11B Stage 1b (A)): a route marked `activity: false` does not slide the session.
    const activity = activityOf(request);
    const context = await findUserSessionContext(options.db, token, clock.now(), {
      activity,
      timeouts,
    });
    return context === null ? null : userPrincipalOf(context);
  };
}

/** Whether the request counts as activity (C245.2): every route but one marked `activity: false`. */
function activityOf(request: FastifyRequest): boolean {
  // A caller outside Fastify (a test, a job) passes no route options: that request is activity.
  const options = request.routeOptions as FastifyRequest['routeOptions'] | undefined;
  return options?.config.activity !== false;
}

/**
 * What a live `ovu_` user session may do where it is (contracts C12 and C15): its environment
 * and that environment's kind, its user's permissions there (C167.2: the assignments that reach the
 * session's environment, `permissionsForEnvironment`), and whether it satisfies the organization's
 * MFA requirement.
 */
import { CONSOLE_SESSION_TIMEOUTS, userSessionTokenSchema } from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import {
  environments,
  hashSessionToken,
  listUserRoleAssignments,
  organizations,
  users,
  userSessions,
  type Db,
  type EnvironmentKind,
  type User,
  type UserSession,
} from '@openverify/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { UserPrincipal } from '../ports.js';
import { permissionsForEnvironment } from '../services/access/permissions.js';
import { enforceSessionPolicy, type SessionTimeouts } from './session-policy.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /**
     * C245.2 (Workflow 11B; Stage 1a amendment 6): `false` on a route a page calls in the background
     * (a poll): the session is checked against both limits, but the request does not count as
     * activity, so it does not move `last_seen_at`.
     */
    activity?: boolean;
  }
}

/** How a request resolves its session (C245): whether it counts as activity, and the limits. */
export interface SessionResolution {
  readonly activity: boolean;
  readonly timeouts: SessionTimeouts;
}

/** C245.1's defaults: a request that counts as activity, the 30-minute and 12-hour limits. */
export const DEFAULT_SESSION_RESOLUTION: SessionResolution = Object.freeze({
  activity: true,
  timeouts: Object.freeze({
    idleTimeoutSeconds: CONSOLE_SESSION_TIMEOUTS.idleSeconds.default,
    absoluteTimeoutSeconds: CONSOLE_SESSION_TIMEOUTS.absoluteSeconds.default,
  }),
});

export interface UserSessionContext {
  session: UserSession;
  user: User;
  environmentKind: EnvironmentKind;
  permissions: ReadonlySet<Permission>;
  /**
   * The session passed MFA, or its organization does not require MFA. A session that is not
   * satisfied may only enrol a factor, read `/me` and log out (C15).
   */
  mfaSatisfied: boolean;
}

/**
 * The context of the session `token` authenticates, or `null` when the token is malformed,
 * unknown or revoked, its user is not active, or it is in a production environment
 * its user may no longer enter. `environments:production` is checked when a session switches
 * environment, and again here on every request, so a user demoted while in production does
 * not keep production access until the session expires (Workflow 2B F003); they sign in again.
 * @throws {SessionExpiredError} for a session past its idle or absolute limit (C245.2).
 */
export async function findUserSessionContext(
  db: Db,
  token: string,
  now: Date,
  resolution: SessionResolution = DEFAULT_SESSION_RESOLUTION,
): Promise<UserSessionContext | null> {
  if (!userSessionTokenSchema.safeParse(token).success) {
    return null;
  }
  const [row] = await db
    .select({
      session: userSessions,
      user: users,
      environmentKind: environments.kind,
      requireMfa: organizations.requireMfa,
    })
    .from(userSessions)
    .innerJoin(
      users,
      and(eq(users.organizationId, userSessions.organizationId), eq(users.id, userSessions.userId)),
    )
    .innerJoin(
      environments,
      and(
        eq(environments.organizationId, userSessions.organizationId),
        eq(environments.id, userSessions.environmentId),
      ),
    )
    .innerJoin(organizations, eq(organizations.id, userSessions.organizationId))
    .where(
      and(
        eq(userSessions.tokenHash, hashSessionToken(token)),
        isNull(userSessions.revokedAt),
        // C245.1, C245.2 (Workflow 11B, auth-sessions): a session past its `expires_at` reaches the
        // policy, which refuses it as `session_expired` with reason `absolute`.
        eq(users.status, 'active'),
      ),
    )
    .limit(1);
  if (row === undefined) {
    return null;
  }
  // C245.1, C245.2 (Workflow 11B Stage 1b (A); auth-sessions' session-policy.ts): the idle and
  // absolute limits and the sliding last-seen write, before any permission is read.
  await enforceSessionPolicy(db, {
    session: row.session,
    now,
    activity: resolution.activity,
    timeouts: resolution.timeouts,
  });
  // C167.2 (Workflow 9B Stage 1b (U); review F29): the hook `api-access` builds; the union of every
  // role was taken here before.
  const assignments = await listUserRoleAssignments(db, row.session.organizationId, row.user.id);
  const permissions = permissionsForEnvironment(assignments, row.session.environmentId);
  if (row.environmentKind === 'production' && !permissions.has('environments:production')) {
    return null;
  }
  return {
    session: row.session,
    user: row.user,
    environmentKind: row.environmentKind,
    permissions,
    mfaSatisfied: row.session.mfaSatisfied || !row.requireMfa,
  };
}

/** The server API principal (C12) of a session context. */
export function userPrincipalOf(context: UserSessionContext): UserPrincipal {
  return {
    kind: 'user',
    userId: context.user.id,
    userSessionId: context.session.id,
    organizationId: context.session.organizationId,
    environmentId: context.session.environmentId,
    environmentKind: context.environmentKind,
    permissions: context.permissions,
    mfaSatisfied: context.mfaSatisfied,
  };
}

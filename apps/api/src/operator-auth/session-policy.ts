/**
 * C245 (G-IDLE; decision 9): the console session's idle and absolute limits, and the events that end
 * a user's sessions.
 *
 * - `enforceSessionPolicy` runs where a session is resolved (`findUserSessionContext`, for both the
 *   dashboard and the server API), before any permission is read: it refuses a session idle past
 *   `idleTimeoutSeconds` or older than `absoluteTimeoutSeconds` (401 `session_expired` with its
 *   reason), and slides `last_seen_at` at most once a minute unless the route says `activity:
 *   false` (a background poll; C245.2, Stage 1a amendment 6).
 * - `endUserSessions` revokes sessions (Phase 9 revokes, never deletes; amendment 3): with cause
 *   `role-change`, those working in an environment where the user no longer holds a role (amendment
 *   4); with `admin`, every live session of the user (`POST /dashboard/users/:id/end-sessions`).
 *
 * The decision is a pure function of the row and the injected clock's time ({@link sessionExpiryOf}),
 * so a session refused once stays refused. The slide is one conditional `UPDATE`: it never writes a
 * revoked session, nor one that has expired by the writing request's own clock, so a request racing
 * an idle expiry cannot revive the session (`session-policy.integration.test.ts`).
 *
 * Provisional (decision 9, ours): 30 minutes idle and 12 hours in all, both configurable
 * (`OPENVERIFY_CONSOLE_IDLE_TIMEOUT_SECONDS`, `OPENVERIFY_CONSOLE_ABSOLUTE_TIMEOUT_SECONDS`). An idle
 * timeout limits the window of an unattended browser; it does not protect a token stolen while the
 * session is in use (C245.5).
 */
import { SESSION_LAST_SEEN_WRITE_SECONDS, type SessionExpiredReason } from '@openverify/contracts';
import { listUserRoleAssignments, userSessions, type Db, type UserSession } from '@openverify/db';
import { and, eq, gt, inArray, isNull, lte } from 'drizzle-orm';
import { UnauthorizedError } from '../errors.js';
import { permissionsForEnvironment } from '../services/access/permissions.js';

/** C245.1: the two limits, in seconds (`config.consoleSessions`). */
export interface SessionTimeouts {
  readonly idleTimeoutSeconds: number;
  readonly absoluteTimeoutSeconds: number;
}

export interface SessionPolicyInput {
  /** The live session row, already checked for revocation. */
  readonly session: UserSession;
  /** The injected clock's time (never the database's). */
  readonly now: Date;
  /** `false` for a route marked `activity: false`: checked against both limits, not slid. */
  readonly activity: boolean;
  readonly timeouts: SessionTimeouts;
}

/** The words of each refusal (`contracts/fixtures/problems/sessions/`). */
export const SESSION_EXPIRED_DETAIL: Readonly<Record<SessionExpiredReason, string>> = Object.freeze(
  {
    idle: 'You were signed out after a period without activity. Sign in again.',
    absolute: 'Your session reached its maximum length. Sign in again.',
  },
);

/** C245.2: 401 `session_expired` with `reason: idle | absolute`, as an invalid token's challenge. */
export class SessionExpiredError extends UnauthorizedError {
  override name = 'SessionExpiredError';

  constructor(reason: SessionExpiredReason) {
    super(SESSION_EXPIRED_DETAIL[reason], { error: 'invalid_token' }, 'session_expired', reason);
  }
}

/**
 * Which limit the session has reached at `now`, or `null`: `absolute` from the earlier of its
 * sign-in plus `absoluteTimeoutSeconds` and its own `expires_at` (whatever its activity), else
 * `idle` from `idleTimeoutSeconds` after its last activity. A limit is reached at its instant.
 */
export function sessionExpiryOf(
  session: Pick<UserSession, 'createdAt' | 'lastSeenAt' | 'expiresAt'>,
  now: Date,
  timeouts: SessionTimeouts,
): SessionExpiredReason | null {
  const at = now.getTime();
  const absoluteEnd = Math.min(
    session.createdAt.getTime() + timeouts.absoluteTimeoutSeconds * 1000,
    session.expiresAt.getTime(),
  );
  if (at >= absoluteEnd) {
    return 'absolute';
  }
  if (at >= session.lastSeenAt.getTime() + timeouts.idleTimeoutSeconds * 1000) {
    return 'idle';
  }
  return null;
}

/**
 * Refuses a session past either limit and slides its `last_seen_at`.
 * @throws {SessionExpiredError} for a session past a limit.
 */
export async function enforceSessionPolicy(db: Db, input: SessionPolicyInput): Promise<void> {
  const { session, now, timeouts } = input;
  const expiry = sessionExpiryOf(session, now, timeouts);
  if (expiry !== null) {
    throw new SessionExpiredError(expiry);
  }
  const writeEvery = SESSION_LAST_SEEN_WRITE_SECONDS * 1000;
  if (!input.activity || now.getTime() - session.lastSeenAt.getTime() < writeEvery) {
    return;
  }
  await db
    .update(userSessions)
    .set({ lastSeenAt: now, updatedAt: now })
    .where(
      and(
        eq(userSessions.id, session.id),
        isNull(userSessions.revokedAt),
        lte(userSessions.lastSeenAt, new Date(now.getTime() - writeEvery)),
        gt(userSessions.lastSeenAt, new Date(now.getTime() - timeouts.idleTimeoutSeconds * 1000)),
      ),
    );
}

/** Why sessions end (C245.3). */
export type SessionEndCause = 'role-change' | 'admin';

export interface EndUserSessionsInput {
  readonly organizationId: string;
  readonly userId: string;
  readonly now: Date;
  readonly cause: SessionEndCause;
}

/** Revokes the user's sessions the cause ends, in the caller's transaction; how many it revoked. */
export async function endUserSessions(db: Db, input: EndUserSessionsInput): Promise<number> {
  const { organizationId, userId, now } = input;
  const live = and(
    eq(userSessions.organizationId, organizationId),
    eq(userSessions.userId, userId),
    isNull(userSessions.revokedAt),
    gt(userSessions.expiresAt, now),
  );
  if (input.cause === 'admin') {
    const rows = await db
      .update(userSessions)
      .set({ revokedAt: now })
      .where(live)
      .returning({ id: userSessions.id });
    return rows.length;
  }
  const sessions = await db
    .select({ id: userSessions.id, environmentId: userSessions.environmentId })
    .from(userSessions)
    .where(live);
  if (sessions.length === 0) {
    return 0;
  }
  const assignments = await listUserRoleAssignments(db, organizationId, userId);
  const roleless = sessions
    .filter(({ environmentId }) => permissionsForEnvironment(assignments, environmentId).size === 0)
    .map(({ id }) => id);
  if (roleless.length === 0) {
    return 0;
  }
  const rows = await db
    .update(userSessions)
    .set({ revokedAt: now })
    .where(and(live, inArray(userSessions.id, roleless)))
    .returning({ id: userSessions.id });
  return rows.length;
}

/**
 * C168.4 (Phase 9, Workflow 9B; contracts B27): an operator's own sessions.
 *
 * - The device summary is read from the user agent its sign-in recorded in the audit log (sealed at
 *   rest), reduced to a browser and an operating system, such as "Firefox on Linux"; the agent
 *   itself is never served. `null` when it names neither (the console's server, a script).
 * - "Last seen" is the session's `updated_at`, which each authenticated request moves at most once
 *   per {@link SESSION_LAST_SEEN_RESOLUTION_SECONDS} (ours, provisional: one write a minute per
 *   session is the cost; the list shows minutes).
 */
import { toTimestamp, userSessionResourceSchema } from '@openverify/contracts';
import {
  listEnvironments,
  listLiveUserSessions,
  revokeOtherUserSessions,
  revokeOwnUserSession,
  sessionSignInAgents,
  type Db,
  type UserSession,
} from '@openverify/db';
import { z } from 'zod';
import { NotFoundError } from '../../errors.js';
import type { AuditLogger, ServiceContext } from '../../ports.js';
import { auditEntryOf } from '../context.js';

/** How often a session's "last seen" may move: once a minute (ours, provisional). */
export const SESSION_LAST_SEEN_RESOLUTION_SECONDS = 60;

const BROWSERS: readonly [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\b(?:OPR|Opera)\//, 'Opera'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:Chrome|CriOS|Chromium)\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
];

const SYSTEMS: readonly [RegExp, string][] = [
  [/\b(?:iPhone|iPad|iPod)\b/, 'iOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

const first = (patterns: readonly [RegExp, string][], agent: string) =>
  patterns.find(([pattern]) => pattern.test(agent))?.[1] ?? null;

/** "Firefox on Linux", "Firefox", "Linux", or `null` when the agent names neither. */
export function deviceSummary(userAgent: string | null | undefined): string | null {
  if (userAgent === null || userAgent === undefined) {
    return null;
  }
  const agent = userAgent.slice(0, 1024);
  const browser = first(BROWSERS, agent);
  const system = first(SYSTEMS, agent);
  if (browser !== null && system !== null) {
    return `${browser} on ${system}`;
  }
  return browser ?? system;
}

type UserSessionResource = z.infer<typeof userSessionResourceSchema>;

function sessionResource(
  session: UserSession,
  currentId: string,
  agent: string | undefined,
): UserSessionResource {
  return userSessionResourceSchema.parse({
    type: 'user-session',
    id: session.id,
    attributes: {
      device: deviceSummary(agent),
      'created-at': toTimestamp(session.createdAt),
      // C245.1 (Workflow 11B Stage 1b (A); Stage 1a amendment 5): the column the idle limit reads.
      'last-seen-at': toTimestamp(session.lastSeenAt),
      'expires-at': toTimestamp(session.expiresAt),
      current: session.id === currentId,
      'mfa-verified-at': session.mfaVerifiedAt === null ? null : toTimestamp(session.mfaVerifiedAt),
      // C248.6 (KP11-26): the provider's amr an SSO sign-in kept.
      'provider-amr': session.providerAmr ?? null,
    },
  });
}

/** The signed-in operator whose sessions these are. */
export interface SessionOwner {
  organizationId: string;
  userId: string;
  sessionId: string;
}

/** `GET /dashboard/sessions`: the caller's live sessions, newest first (not paged: they are few). */
export async function listMySessions(
  db: Db,
  owner: SessionOwner,
  now: Date,
): Promise<{ data: UserSessionResource[]; links: { next: null } }> {
  const sessions = await listLiveUserSessions(db, owner.organizationId, owner.userId, now);
  const environments = await listEnvironments(db, owner.organizationId);
  const agents = await sessionSignInAgents(
    db,
    environments.map(({ id }) => id),
    sessions.map(({ id }) => id),
  );
  return {
    data: sessions.map((session) =>
      sessionResource(session, owner.sessionId, agents.get(session.id)),
    ),
    links: { next: null },
  };
}

export interface SessionChangeDeps {
  db: Db;
  audit: AuditLogger;
}

/**
 * `POST /dashboard/sessions/:id/revoke`: revokes one of the caller's own live sessions, audited as
 * `user-session.revoked` where the caller works.
 * @throws {NotFoundError} for a session that is not the caller's or not live.
 */
export async function revokeMySession(
  deps: SessionChangeDeps,
  owner: SessionOwner,
  ctx: ServiceContext,
  sessionId: string,
  now: Date,
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    if (!(await revokeOwnUserSession(tx, owner.organizationId, owner.userId, sessionId, now))) {
      throw new NotFoundError('No session of yours with this id is live.');
    }
    await deps.audit.record(
      tx,
      auditEntryOf(
        ctx,
        { type: 'user', id: owner.userId },
        {
          action: 'user-session.revoked',
          resourceType: 'user-session',
          resourceId: sessionId,
        },
      ),
    );
  });
}

/**
 * `POST /dashboard/sessions/revoke-others`: revokes every session of the caller but the current one,
 * audited as `user-session.others-revoked` with the count. Returns the count.
 */
export async function revokeMyOtherSessions(
  deps: SessionChangeDeps,
  owner: SessionOwner,
  ctx: ServiceContext,
  now: Date,
): Promise<number> {
  return deps.db.transaction(async (tx) => {
    const revoked = await revokeOtherUserSessions(
      tx,
      owner.organizationId,
      owner.userId,
      owner.sessionId,
      now,
    );
    await deps.audit.record(
      tx,
      auditEntryOf(
        ctx,
        { type: 'user', id: owner.userId },
        {
          action: 'user-session.others-revoked',
          resourceType: 'user-session',
          resourceId: owner.sessionId,
          metadata: { revoked, reason: 'requested' },
        },
      ),
    );
    return revoked;
  });
}

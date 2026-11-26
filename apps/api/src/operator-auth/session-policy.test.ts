/**
 * C245 (Workflow 11B, auth-sessions): the console session's idle and absolute limits, the sliding
 * `last_seen_at` written at most once a minute, and the session ends Phase 9 left out (an admin's
 * end-sessions and a role change), on PGlite with a frozen clock. Every value is synthetic.
 */
import { newId, newUserSessionToken } from '@openverify/contracts';
import { BUILTIN_ROLES } from '@openverify/core';
import {
  createEnvironment,
  createUser,
  createUserSession,
  hashSessionToken,
  setUserRoleAssignments,
  syncBuiltinRoles,
  userSessions,
  type UserSession,
} from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  endUserSessions,
  enforceSessionPolicy,
  SESSION_EXPIRED_DETAIL,
  SessionExpiredError,
  sessionExpiryOf,
  type SessionTimeouts,
} from './session-policy.js';

const T0 = new Date('2026-10-20T12:00:00.000Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DEFAULTS: SessionTimeouts = { idleTimeoutSeconds: 1_800, absoluteTimeoutSeconds: 43_200 };

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

const at = (ms: number) => new Date(T0.getTime() + ms);

async function tenant() {
  const { organization, environment } = await createTestTenant(database.db);
  const user = await createUser(database.db, {
    id: newId('usr'),
    organizationId: organization.id,
    email: `policy-${newId('usr').slice(-8).toLowerCase()}@example.com`,
    passwordHash: '$argon2id$fake$unused',
  });
  return { organization, environment, user };
}

async function session(
  owner: { organizationId: string; userId: string; environmentId: string },
  options: { at?: Date; expiresAt?: Date } = {},
): Promise<UserSession> {
  const start = options.at ?? T0;
  return createUserSession(database.db, {
    id: newId('uss'),
    organizationId: owner.organizationId,
    userId: owner.userId,
    environmentId: owner.environmentId,
    tokenHash: hashSessionToken(newUserSessionToken()),
    expiresAt: options.expiresAt ?? new Date(start.getTime() + 12 * HOUR),
    at: start,
  });
}

async function reread(id: string): Promise<UserSession> {
  const [row] = await database.db.select().from(userSessions).where(eq(userSessions.id, id));
  if (row === undefined) {
    throw new Error(`no session ${id}`);
  }
  return row;
}

describe('sessionExpiryOf (C245.1)', () => {
  const row = { createdAt: T0, lastSeenAt: T0, expiresAt: at(12 * HOUR) };

  it('answers null inside both limits and idle from 30 minutes without activity', () => {
    expect(sessionExpiryOf(row, at(30 * MINUTE - 1), DEFAULTS)).toBeNull();
    expect(sessionExpiryOf(row, at(30 * MINUTE), DEFAULTS)).toBe('idle');
    expect(
      sessionExpiryOf({ ...row, lastSeenAt: at(11 * HOUR) }, at(11 * HOUR + 29 * MINUTE), DEFAULTS),
    ).toBeNull();
  });

  it('answers absolute from 12 hours after the sign-in, whatever the activity, and before idle', () => {
    const busy = { ...row, lastSeenAt: at(12 * HOUR - MINUTE) };
    expect(sessionExpiryOf(busy, at(12 * HOUR - 1), DEFAULTS)).toBeNull();
    expect(sessionExpiryOf(busy, at(12 * HOUR), DEFAULTS)).toBe('absolute');
    expect(sessionExpiryOf(row, at(13 * HOUR), DEFAULTS)).toBe('absolute');
  });

  it('takes the configured limits, and the session’s own expiry when it comes first', () => {
    const short: SessionTimeouts = { idleTimeoutSeconds: 300, absoluteTimeoutSeconds: 3_600 };
    expect(sessionExpiryOf(row, at(5 * MINUTE), short)).toBe('idle');
    expect(sessionExpiryOf({ ...row, lastSeenAt: at(59 * MINUTE) }, at(HOUR), short)).toBe(
      'absolute',
    );
    const early = { ...row, lastSeenAt: at(HOUR), expiresAt: at(2 * HOUR) };
    expect(sessionExpiryOf(early, at(2 * HOUR), DEFAULTS)).toBe('absolute');
  });

  it('never counts a last-seen time after now as idle', () => {
    expect(sessionExpiryOf({ ...row, lastSeenAt: at(HOUR) }, at(MINUTE), DEFAULTS)).toBeNull();
  });
});

describe('enforceSessionPolicy (C245.1, C245.2)', () => {
  it('refuses an idle session with 401 session_expired, reason idle, the golden’s words and a Bearer challenge', async () => {
    const { organization, environment, user } = await tenant();
    const row = await session({
      organizationId: organization.id,
      userId: user.id,
      environmentId: environment.id,
    });

    const refusal = enforceSessionPolicy(database.db, {
      session: row,
      now: at(30 * MINUTE),
      activity: true,
      timeouts: DEFAULTS,
    });

    await expect(refusal).rejects.toBeInstanceOf(SessionExpiredError);
    await expect(refusal).rejects.toMatchObject({
      status: 401,
      code: 'session_expired',
      reason: 'idle',
      message: SESSION_EXPIRED_DETAIL.idle,
      headers: { 'www-authenticate': expect.stringContaining('invalid_token') as unknown },
    });
    expect((await reread(row.id)).lastSeenAt).toEqual(T0);
  });

  it('refuses a session past its absolute limit with reason absolute, even right after activity', async () => {
    const { organization, environment, user } = await tenant();
    const row = await session({
      organizationId: organization.id,
      userId: user.id,
      environmentId: environment.id,
    });
    await database.db
      .update(userSessions)
      .set({ lastSeenAt: at(12 * HOUR - MINUTE) })
      .where(eq(userSessions.id, row.id));

    await expect(
      enforceSessionPolicy(database.db, {
        session: await reread(row.id),
        now: at(12 * HOUR),
        activity: true,
        timeouts: DEFAULTS,
      }),
    ).rejects.toMatchObject({
      code: 'session_expired',
      reason: 'absolute',
      message: SESSION_EXPIRED_DETAIL.absolute,
    });
  });

  it('slides last_seen_at at most once a minute, from the injected clock', async () => {
    const { organization, environment, user } = await tenant();
    const row = await session({
      organizationId: organization.id,
      userId: user.id,
      environmentId: environment.id,
    });
    const request = async (now: Date) => {
      await enforceSessionPolicy(database.db, {
        session: await reread(row.id),
        now,
        activity: true,
        timeouts: DEFAULTS,
      });
      return (await reread(row.id)).lastSeenAt;
    };

    await expect(request(at(59_999))).resolves.toEqual(T0);
    await expect(request(at(MINUTE))).resolves.toEqual(at(MINUTE));
    await expect(request(at(MINUTE + 30_000))).resolves.toEqual(at(MINUTE));
    await expect(request(at(29 * MINUTE))).resolves.toEqual(at(29 * MINUTE));
    // Sliding keeps the session alive past 30 minutes from the sign-in.
    await expect(request(at(58 * MINUTE))).resolves.toEqual(at(58 * MINUTE));
  });

  it('checks a request that is not activity against both limits without sliding it', async () => {
    const { organization, environment, user } = await tenant();
    const row = await session({
      organizationId: organization.id,
      userId: user.id,
      environmentId: environment.id,
    });
    const poll = (now: Date) =>
      enforceSessionPolicy(database.db, {
        session: row,
        now,
        activity: false,
        timeouts: DEFAULTS,
      });

    await expect(poll(at(10 * MINUTE))).resolves.toBeUndefined();
    await expect(poll(at(29 * MINUTE))).resolves.toBeUndefined();
    expect((await reread(row.id)).lastSeenAt).toEqual(T0);
    await expect(poll(at(30 * MINUTE))).rejects.toMatchObject({ reason: 'idle' });
  });

  it('never revives a session that has expired by its own clock, nor slides a revoked one', async () => {
    const { organization, environment, user } = await tenant();
    const row = await session({
      organizationId: organization.id,
      userId: user.id,
      environmentId: environment.id,
    });
    // A request that read the row before another request revoked it slides nothing.
    await database.db
      .update(userSessions)
      .set({ revokedAt: at(MINUTE) })
      .where(eq(userSessions.id, row.id));

    await enforceSessionPolicy(database.db, {
      session: row,
      now: at(2 * MINUTE),
      activity: true,
      timeouts: DEFAULTS,
    });

    expect((await reread(row.id)).lastSeenAt).toEqual(T0);
  });
});

describe('endUserSessions (C245.3)', () => {
  it('with cause admin, revokes every live session of the user and nobody else’s, answering how many', async () => {
    const { organization, environment, user } = await tenant();
    const other = await createUser(database.db, {
      id: newId('usr'),
      organizationId: organization.id,
      email: `policy-other-${newId('usr').slice(-8).toLowerCase()}@example.com`,
      passwordHash: '$argon2id$fake$unused',
    });
    const owner = {
      organizationId: organization.id,
      userId: user.id,
      environmentId: environment.id,
    };
    const first = await session(owner);
    const second = await session(owner, { at: at(HOUR) });
    const expired = await session(owner, { at: at(-13 * HOUR), expiresAt: at(-HOUR) });
    const revoked = await session(owner);
    await database.db
      .update(userSessions)
      .set({ revokedAt: at(-MINUTE) })
      .where(eq(userSessions.id, revoked.id));
    const theirs = await session({ ...owner, userId: other.id });

    const ended = await endUserSessions(database.db, {
      organizationId: organization.id,
      userId: user.id,
      now: at(2 * HOUR),
      cause: 'admin',
    });

    expect(ended).toBe(2);
    expect((await reread(first.id)).revokedAt).toEqual(at(2 * HOUR));
    expect((await reread(second.id)).revokedAt).toEqual(at(2 * HOUR));
    expect((await reread(expired.id)).revokedAt).toBeNull();
    expect((await reread(revoked.id)).revokedAt).toEqual(at(-MINUTE));
    expect((await reread(theirs.id)).revokedAt).toBeNull();
  });

  it('with cause role-change, revokes only the sessions working where the user now holds no role', async () => {
    const { organization, environment: sandbox, user } = await tenant();
    const production = await createEnvironment(database.db, {
      id: newId('env'),
      organizationId: organization.id,
      kind: 'production',
    });
    const roles = await syncBuiltinRoles(
      database.db,
      organization.id,
      Object.values(BUILTIN_ROLES),
      () => newId('role'),
    );
    const developer = roles.find((role) => role.key === 'developer');
    if (developer === undefined) {
      throw new Error('no developer role');
    }
    // The user's only role now reaches the sandbox alone.
    await setUserRoleAssignments(database.db, organization.id, user.id, [
      { roleId: developer.id, environmentIds: [sandbox.id] },
    ]);
    const kept = await session({
      organizationId: organization.id,
      userId: user.id,
      environmentId: sandbox.id,
    });
    const ended = await session({
      organizationId: organization.id,
      userId: user.id,
      environmentId: production.id,
    });

    await expect(
      endUserSessions(database.db, {
        organizationId: organization.id,
        userId: user.id,
        now: at(HOUR),
        cause: 'role-change',
      }),
    ).resolves.toBe(1);

    expect((await reread(kept.id)).revokedAt).toBeNull();
    expect((await reread(ended.id)).revokedAt).toEqual(at(HOUR));
  });

  it('with cause role-change, ends nothing while the user holds a role wherever it works', async () => {
    const { organization, environment, user } = await tenant();
    const roles = await syncBuiltinRoles(
      database.db,
      organization.id,
      Object.values(BUILTIN_ROLES),
      () => newId('role'),
    );
    await setUserRoleAssignments(
      database.db,
      organization.id,
      user.id,
      roles
        .filter((role) => role.key === 'viewer')
        .map((role) => ({ roleId: role.id, environmentIds: null })),
    );
    const live = await session({
      organizationId: organization.id,
      userId: user.id,
      environmentId: environment.id,
    });

    await expect(
      endUserSessions(database.db, {
        organizationId: organization.id,
        userId: user.id,
        now: at(HOUR),
        cause: 'role-change',
      }),
    ).resolves.toBe(0);
    expect((await reread(live.id)).revokedAt).toBeNull();
  });
});

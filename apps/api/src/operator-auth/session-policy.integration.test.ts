/**
 * C245.4 (Workflow 11B, auth-sessions) against Postgres 17: requests race an idle expiry. A session
 * last seen at T0 is resolved at once, on separate pooled connections, by requests whose clocks
 * stand one second before its idle limit and requests whose clocks stand one second after it. Every
 * early request is admitted; a late one is admitted only when it read the row an early request had
 * already slid, and otherwise refused with `session_expired`; no late request ever writes
 * `last_seen_at`, so it ends at the early requests' time. A session already past the limit stays
 * refused by every request and is never slid. Every value is synthetic.
 */
import { newId, newUserSessionToken } from '@openverify/contracts';
import {
  createDatabase,
  createUser,
  createUserSession,
  hashSessionToken,
  runMigrations,
  userSessions,
  type Database,
} from '@openverify/db';
import {
  createIntegrationPool,
  createTestTenant,
  ifSet,
  startIntegrationPostgres,
} from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findUserSessionContext } from './session-context.js';

const T0 = new Date('2026-10-20T12:00:00.000Z');
const IDLE_SECONDS = 1_800;
const TIMEOUTS = { idleTimeoutSeconds: IDLE_SECONDS, absoluteTimeoutSeconds: 43_200 };
const RACERS = 12;

let postgres: StartedPostgreSqlContainer;
let pool: Pool;
let db: Database;

beforeAll(async () => {
  postgres = await startIntegrationPostgres();
  pool = createIntegrationPool(postgres.getConnectionUri(), { max: 2 * RACERS });
  db = createDatabase(pool);
  await runMigrations(db);
});

afterAll(async () => {
  await ifSet(pool)?.end();
  await ifSet(postgres)?.stop();
});

async function liveSession(): Promise<{ id: string; token: string }> {
  const { organization, environment } = await createTestTenant(db);
  const user = await createUser(db, {
    id: newId('usr'),
    organizationId: organization.id,
    email: `race-${newId('usr').slice(-8).toLowerCase()}@example.com`,
    passwordHash: '$argon2id$fake$unused',
  });
  const token = newUserSessionToken();
  const session = await createUserSession(db, {
    id: newId('uss'),
    organizationId: organization.id,
    userId: user.id,
    environmentId: environment.id,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(T0.getTime() + 12 * 3_600_000),
    at: T0,
  });
  return { id: session.id, token };
}

async function rowOf(id: string) {
  const [row] = await db.select().from(userSessions).where(eq(userSessions.id, id));
  if (row === undefined) {
    throw new Error(`no session ${id}`);
  }
  return row;
}

type Outcome = 'admitted' | 'idle' | 'other';

async function resolveAt(token: string, now: Date): Promise<Outcome> {
  try {
    const context = await findUserSessionContext(db, token, now, {
      activity: true,
      timeouts: TIMEOUTS,
    });
    return context === null ? 'other' : 'admitted';
  } catch (error) {
    const problem = error as { code?: unknown; reason?: unknown };
    return problem.code === 'session_expired' && problem.reason === 'idle' ? 'idle' : 'other';
  }
}

describe('a request against an idle expiry (C245.4)', () => {
  it('admits every request inside the limit, never lets a late one slide the session, and refuses only from the stale row', async () => {
    const { id, token } = await liveSession();
    const early = new Date(T0.getTime() + IDLE_SECONDS * 1000 - 1_000);
    const late = new Date(T0.getTime() + IDLE_SECONDS * 1000 + 1_000);

    const outcomes = await Promise.all(
      Array.from({ length: 2 * RACERS }, (_, index) =>
        index % 2 === 0
          ? resolveAt(token, early).then((outcome) => ({ when: 'early' as const, outcome }))
          : resolveAt(token, late).then((outcome) => ({ when: 'late' as const, outcome })),
      ),
    );

    expect(outcomes.filter(({ when }) => when === 'early').map(({ outcome }) => outcome)).toEqual(
      Array.from({ length: RACERS }, () => 'admitted'),
    );
    expect(outcomes.filter(({ when, outcome }) => when === 'late' && outcome === 'other')).toEqual(
      [],
    );
    const row = await rowOf(id);
    expect(row.lastSeenAt).toEqual(early);
    expect(row.revokedAt).toBeNull();
    // Once slid, the session is alive for the late clock too.
    await expect(resolveAt(token, late)).resolves.toBe('admitted');
  });

  it('keeps a session already past the limit refused by every concurrent request, and never slides it', async () => {
    const { id, token } = await liveSession();
    const late = new Date(T0.getTime() + IDLE_SECONDS * 1000);

    const outcomes = await Promise.all(
      Array.from({ length: 2 * RACERS }, () => resolveAt(token, late)),
    );

    expect(outcomes).toEqual(Array.from({ length: 2 * RACERS }, () => 'idle'));
    expect((await rowOf(id)).lastSeenAt).toEqual(T0);
    await expect(resolveAt(token, new Date(late.getTime() + 60_000))).resolves.toBe('idle');
  });
});

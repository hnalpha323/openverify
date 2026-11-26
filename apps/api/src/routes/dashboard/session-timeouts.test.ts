/**
 * C245.1 and C245.2 (Phase 11, Workflow 11B, auth-sessions) through the dashboard API and the server
 * API's resolver, with a frozen clock: a console session ends after 30 minutes without a request
 * that counts as activity and 12 hours after its sign-in, answering 401 `session_expired` with its
 * reason; requests slide it; the one background poll (the file rendition read, `activity: false`) is
 * checked but does not slide it; the configured limits apply, a longer absolute limit included.
 * Every value is synthetic.
 */
import { sessionExpiredProblemSchema, type SessionExpiredReason } from '@openverify/contracts';
import { hashSessionToken, userSessions } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { eq } from 'drizzle-orm';
import type { FastifyRequest, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createLoginRateLimiter } from '../../operator-auth/login-rate-limiter.js';
import { createOperatorAuth } from '../../operator-auth/operator-auth.js';
import { createUserSessionPrincipalResolver } from '../../operator-auth/principal-resolver.js';
import {
  BFF_TOKEN,
  PASSWORD,
  createDashboardHarness,
  fakeHasher,
  type DashboardHarness,
} from './dashboard.test-support.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const FILE = 'file_01M5CK3190XEVBM5ZXA76E1JSN';

let database: TestDatabase;
const harnesses: DashboardHarness[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

afterAll(async () => {
  await database.close();
});

async function signedIn() {
  const api = await createDashboardHarness(database);
  harnesses.push(api);
  const organization = await api.organization();
  const operator = await api.operator(organization, { roles: ['reviewer'] });
  const token = await api.signIn(operator.email);
  return { api, organization, operator, token };
}

function expectExpired(response: LightMyRequestResponse, reason: SessionExpiredReason): void {
  expect(response.statusCode, response.body).toBe(401);
  const problem = sessionExpiredProblemSchema.parse(response.json());
  expect(problem).toMatchObject({ code: 'session_expired', reason });
  expect(response.headers['www-authenticate']).toContain('invalid_token');
}

async function lastSeenOf(token: string): Promise<Date> {
  const [row] = await database.db
    .select({ lastSeenAt: userSessions.lastSeenAt })
    .from(userSessions)
    .where(eq(userSessions.tokenHash, hashSessionToken(token)));
  if (row === undefined) {
    throw new Error('no session');
  }
  return row.lastSeenAt;
}

describe('the idle limit (C245.1, C245.2)', () => {
  it('ends a session 30 minutes after its last request with 401 session_expired, reason idle', async () => {
    const { api, token } = await signedIn();

    api.clock.advance(30 * MINUTE - 1);
    expect((await api.call('GET', '/me', { token })).statusCode).toBe(200);
    api.clock.advance(30 * MINUTE);

    expectExpired(await api.call('GET', '/me', { token }), 'idle');
  });

  it('keeps a session alive while requests keep coming, writing last_seen_at at most once a minute', async () => {
    const { api, token } = await signedIn();
    const signedInAt = api.clock.now();

    api.clock.advance(59_000);
    expect((await api.call('GET', '/me', { token })).statusCode).toBe(200);
    expect(await lastSeenOf(token)).toEqual(signedInAt);
    for (let step = 0; step < 6; step += 1) {
      api.clock.advance(20 * MINUTE);
      expect((await api.call('GET', '/me', { token })).statusCode).toBe(200);
      expect(await lastSeenOf(token)).toEqual(api.clock.now());
    }
  });

  it('does not count the file rendition read, a background poll, as activity', async () => {
    const { api, token } = await signedIn();
    const signedInAt = api.clock.now();

    for (const minutes of [10, 10, 9]) {
      api.clock.advance(minutes * MINUTE);
      const poll = await api.call('GET', `/files/${FILE}/rendition`, { token });
      expect(poll.statusCode, poll.body).toBe(404);
    }
    expect(await lastSeenOf(token)).toEqual(signedInAt);
    api.clock.advance(MINUTE);

    expectExpired(await api.call('GET', `/files/${FILE}/rendition`, { token }), 'idle');
    expectExpired(await api.call('GET', '/me', { token }), 'idle');
  });
});

describe('the absolute limit (C245.1)', () => {
  it('ends a busy session 12 hours after its sign-in with reason absolute', async () => {
    const { api, token } = await signedIn();

    for (let step = 0; step < 35; step += 1) {
      api.clock.advance(20 * MINUTE);
      expect((await api.call('GET', '/me', { token })).statusCode).toBe(200);
    }
    api.clock.advance(20 * MINUTE - 1);
    expect((await api.call('GET', '/me', { token })).statusCode).toBe(200);
    api.clock.advance(1);

    expectExpired(await api.call('GET', '/me', { token }), 'absolute');
  });
});

describe('the configured limits (OPENVERIFY_CONSOLE_*_TIMEOUT_SECONDS)', () => {
  async function auth(timeouts: { idleTimeoutSeconds: number; absoluteTimeoutSeconds: number }) {
    const api = await createDashboardHarness(database);
    harnesses.push(api);
    const organization = await api.organization();
    const operator = await api.operator(organization, { roles: ['reviewer'] });
    const operatorAuth = createOperatorAuth({
      db: database.db,
      hasher: fakeHasher,
      clock: api.clock,
      rateLimiter: createLoginRateLimiter({ clock: api.clock }),
      bffToken: BFF_TOKEN,
      sessionTimeouts: timeouts,
    });
    const outcome = await operatorAuth.login({
      email: operator.email,
      password: PASSWORD,
      ip: '203.0.113.7',
    });
    if (outcome.kind !== 'session') {
      throw new Error('expected a session');
    }
    return { api, operatorAuth, token: outcome.token, expiresAt: outcome.expiresAt };
  }

  it('applies a 5-minute idle limit', async () => {
    const { api, operatorAuth, token } = await auth({
      idleTimeoutSeconds: 300,
      absoluteTimeoutSeconds: 43_200,
    });

    api.clock.advance(5 * MINUTE - 1);
    await expect(operatorAuth.authenticate(token)).resolves.not.toBeNull();
    api.clock.advance(5 * MINUTE);

    await expect(operatorAuth.authenticate(token)).rejects.toMatchObject({
      code: 'session_expired',
      reason: 'idle',
    });
  });

  it('keeps a session for a 24-hour absolute limit, and gives it that expiry', async () => {
    const { api, operatorAuth, token, expiresAt } = await auth({
      idleTimeoutSeconds: 1_800,
      absoluteTimeoutSeconds: 86_400,
    });
    const signedInAt = api.clock.now();

    expect(expiresAt).toEqual(new Date(signedInAt.getTime() + 24 * HOUR));
    for (let step = 0; step < 71; step += 1) {
      api.clock.advance(20 * MINUTE);
      await expect(operatorAuth.authenticate(token)).resolves.not.toBeNull();
    }
    api.clock.advance(20 * MINUTE);
    await expect(operatorAuth.authenticate(token)).rejects.toMatchObject({ reason: 'absolute' });
  });
});

describe('the server API resolver (C12) under the same limits', () => {
  it('refuses an idle session with session_expired, and does not slide on a route marked activity: false', async () => {
    const { api, token } = await signedIn();
    const resolve = createUserSessionPrincipalResolver({ db: database.db, clock: api.clock });
    const route = (activity?: boolean) =>
      ({
        routeOptions: { config: activity === undefined ? {} : { activity } },
      }) as unknown as FastifyRequest;
    const signedInAt = api.clock.now();

    api.clock.advance(20 * MINUTE);
    await expect(resolve(token, route(false))).resolves.not.toBeNull();
    expect(await lastSeenOf(token)).toEqual(signedInAt);
    api.clock.advance(10 * MINUTE);

    await expect(resolve(token, route())).rejects.toMatchObject({
      status: 401,
      code: 'session_expired',
      reason: 'idle',
    });
  });
});

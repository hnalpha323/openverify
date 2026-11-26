/**
 * C246.4 (Workflow 11B, auth-sessions; acceptance of 11B): two API instances share one login budget
 * through Valkey 9.1, and an instance that cannot reach Valkey fails sign-in closed (503
 * `login_unavailable` with `Retry-After`) while its other routes keep working. Each instance is a
 * dashboard API of its own (`buildApp` with the dashboard routes) over one database, each with its
 * own `createSharedLoginRateLimiter`, as the container builds it. Every address is from
 * 203.0.113.0/24 and every email synthetic.
 */
import { LOGIN_LIMITS, LOGIN_UNAVAILABLE_RETRY_AFTER_SECONDS } from '@openverify/contracts';
import { createTestDatabase, ifSet, type TestDatabase } from '@openverify/db/testing';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PASSWORD,
  createDashboardHarness,
  expectJson,
  type DashboardHarness,
} from '../routes/dashboard/dashboard.test-support.js';
import { createSharedLoginRateLimiter, type SharedLoginRateLimiter } from './login-rate-limiter.js';
import { totpCode } from './totp.js';
import type { LoginLimitLogger } from './valkey-login-rate-limiter.js';
import { VALKEY_TEST_IMAGE } from '../test-support/integration-valkey.js';

const VALKEY_IMAGE = VALKEY_TEST_IMAGE;
// A synthetic blind-index key, made for these tests only.
const BLIND_INDEX_KEY = new Uint8Array(32).fill(23);
const ADDRESS = '203.0.113.40';

let database: TestDatabase;
let valkey: StartedTestContainer;
const limiters: SharedLoginRateLimiter[] = [];
const harnesses: DashboardHarness[] = [];
const warnings: string[] = [];

const logger: LoginLimitLogger = {
  warn: (_fields, message) => {
    warnings.push(message);
  },
  info: () => undefined,
};

beforeAll(async () => {
  [database, valkey] = await Promise.all([
    createTestDatabase(),
    new GenericContainer(VALKEY_IMAGE)
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start(),
  ]);
}, 120_000);

afterAll(async () => {
  await Promise.all(harnesses.map((harness) => harness.close()));
  await Promise.all(limiters.map((limiter) => limiter.close()));
  await ifSet(valkey)?.stop();
  await ifSet(database)?.close();
}, 120_000);

/** One API instance with its own shared login limiter on `redisUrl`. */
async function instance(redisUrl: string): Promise<DashboardHarness> {
  const shared = createSharedLoginRateLimiter({
    redisUrl,
    blindIndexKey: BLIND_INDEX_KEY,
    clock: { now: () => new Date() },
    logger,
  });
  limiters.push(shared);
  const harness = await createDashboardHarness(database, { rateLimiter: shared.limiter });
  harnesses.push(harness);
  return harness;
}

const valkeyUrl = () => `redis://${valkey.getHost()}:${String(valkey.getMappedPort(6379))}`;

const signIn = (api: DashboardHarness, email: string, password: string) =>
  api.call('POST', '/sessions', { payload: { email, password }, remoteAddress: ADDRESS });

describe('the login budget across API instances (C246.4)', () => {
  it('counts the attempts made on two instances against one budget per email', async () => {
    const first = await instance(valkeyUrl());
    const second = await instance(valkeyUrl());
    const organization = await first.organization();
    const operator = await first.operator(organization, { roles: ['viewer'] });

    for (let attempt = 0; attempt < LOGIN_LIMITS.perEmail; attempt += 1) {
      const api = attempt % 2 === 0 ? first : second;
      const response = await signIn(api, operator.email, 'synthetic wrong password');
      expect(response.statusCode, response.body).toBe(401);
    }

    for (const api of [first, second]) {
      const refused = await signIn(api, operator.email, PASSWORD);
      expect(refused.statusCode, refused.body).toBe(429);
      expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    }
    // Another operator from the same address still signs in: the address has budget left.
    const other = await first.operator(organization, { roles: ['viewer'] });
    expectJson(await signIn(second, other.email, PASSWORD), 201);
  });

  it('fails sign-in closed where Valkey cannot be reached, while a session from elsewhere keeps working there', async () => {
    const reachable = await instance(valkeyUrl());
    // A port nothing listens on: this instance's store is down.
    const unreachable = await instance('redis://127.0.0.1:1');
    const organization = await reachable.organization();
    const operator = await reachable.operator(organization, { roles: ['viewer'] });
    const token = expectJson<{ token: string }>(
      await signIn(reachable, operator.email, PASSWORD),
      201,
    ).token;
    warnings.length = 0;

    const refused = await signIn(unreachable, operator.email, PASSWORD);

    expect(refused.statusCode, refused.body).toBe(503);
    expect(refused.json()).toMatchObject({ status: 503, code: 'login_unavailable' });
    expect(refused.headers['retry-after']).toBe(String(LOGIN_UNAVAILABLE_RETRY_AFTER_SECONDS));
    expect(refused.body).not.toContain(operator.email);
    expect(warnings.length).toBeGreaterThan(0);
    expect((await unreachable.call('GET', '/me', { token })).statusCode).toBe(200);
  });

  it('fails the step-up closed there too, since its guesses count against the same budget (amendment 7)', async () => {
    const reachable = await instance(valkeyUrl());
    const unreachable = await instance('redis://127.0.0.1:1');
    const organization = await reachable.organization();
    const operator = await reachable.operator(organization, { roles: ['viewer'] });
    const token = expectJson<{ token: string }>(
      await signIn(reachable, operator.email, PASSWORD),
      201,
    ).token;
    const enrolment = expectJson<{ data: { id: string }; meta: { secret: string } }>(
      await reachable.call('POST', '/me/mfa-factors/totp', { token, payload: {} }),
      201,
    );
    expectJson(
      await reachable.call('POST', '/me/mfa-factors/totp/confirm', {
        token,
        payload: {
          'factor-id': enrolment.data.id,
          'totp-code': totpCode(enrolment.meta.secret, reachable.clock.now()),
        },
      }),
      200,
    );

    const refused = await unreachable.call('POST', '/sessions/current/step-up', {
      token,
      payload: { 'totp-code': totpCode(enrolment.meta.secret, unreachable.clock.now()) },
      remoteAddress: ADDRESS,
    });

    expect(refused.statusCode, refused.body).toBe(503);
    expect(refused.json()).toMatchObject({ code: 'login_unavailable' });
    expect(refused.headers['retry-after']).toBe(String(LOGIN_UNAVAILABLE_RETRY_AFTER_SECONDS));
  });
});

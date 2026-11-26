/**
 * C246 (Workflow 11B, auth-sessions) against a real Valkey: the login limiter's one script counts
 * both keys or neither, two limiters on one Valkey share one budget, no key name holds an address
 * or an email, and an unreachable store fails closed. Every address is from 203.0.113.0/24 or
 * 198.51.100.0/24 and every email at example.com.
 */
import { loginLimitKeys } from '@openverify/contracts';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeRateLimitRedis, createRateLimitRedis } from '../rate-limit/index.js';
import {
  createValkeyLoginRateLimiter,
  loginLimitHmacs,
  loginLimitSubkey,
  LoginUnavailableError,
  type LoginLimitLogger,
} from './valkey-login-rate-limiter.js';
import { VALKEY_TEST_IMAGE } from '../test-support/integration-valkey.js';

const VALKEY_IMAGE = VALKEY_TEST_IMAGE;
// A synthetic blind-index key, made for these tests only.
const BLIND_INDEX_KEY = new Uint8Array(32).fill(11);

let valkey: StartedTestContainer;
const clients: ReturnType<typeof createRateLimitRedis>[] = [];

beforeAll(async () => {
  valkey = await new GenericContainer(VALKEY_IMAGE)
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
});

afterAll(async () => {
  await Promise.all(clients.map((client) => closeRateLimitRedis(client)));
  await valkey.stop();
});

const url = () => `redis://${valkey.getHost()}:${String(valkey.getMappedPort(6379))}`;

function client(target = url()) {
  const redis = createRateLimitRedis(target);
  clients.push(redis);
  return redis;
}

const quiet: LoginLimitLogger = { warn: () => undefined, info: () => undefined };

let sequence = 0;
/** A fresh address and email per test, so the tests share no window. */
function subject() {
  sequence += 1;
  return {
    ip: `203.0.113.${String(sequence)}`,
    email: `synthetic.operator.${String(sequence)}@example.com`,
  };
}

function keysOf(input: { ip: string; email: string }) {
  return loginLimitKeys(loginLimitHmacs(loginLimitSubkey(BLIND_INDEX_KEY), input));
}

function limiter(limits?: { perAddress: number; perEmail: number; windowMs: number }) {
  return createValkeyLoginRateLimiter({
    redis: client(),
    blindIndexKey: BLIND_INDEX_KEY,
    logger: quiet,
    ...(limits === undefined ? {} : { limits }),
  });
}

describe('the login limit script on Valkey (C246.1)', () => {
  it('allows 10 attempts per email in C4 window, refuses the 11th, and counts the refused one against neither key', async () => {
    const login = limiter();
    const who = subject();
    const [addressKey, emailKey] = keysOf(who);
    const raw = client();

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await expect(login.attempt(who)).resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });
    }
    const refused = await login.attempt(who);

    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(890);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(900);
    await expect(raw.get(addressKey)).resolves.toBe('10');
    await expect(raw.get(emailKey)).resolves.toBe('10');
    const ttl = await raw.pttl(emailKey);
    expect(ttl).toBeGreaterThan(890_000);
    expect(ttl).toBeLessThanOrEqual(900_000);
  });

  it('refuses the 51st attempt from one address across many emails, counting none of the refused', async () => {
    const login = limiter();
    const ip = '198.51.100.51';
    for (let index = 0; index < 50; index += 1) {
      const decision = await login.attempt({
        ip,
        email: `synthetic.many.${String(index)}@example.com`,
      });
      expect(decision.allowed).toBe(true);
    }
    const email = 'synthetic.fresh@example.com';
    const refused = await login.attempt({ ip, email });

    expect(refused.allowed).toBe(false);
    const [addressKey, emailKey] = keysOf({ ip, email });
    await expect(client().get(addressKey)).resolves.toBe('50');
    await expect(client().get(emailKey)).resolves.toBeNull();
  });

  it('answers the later of two blocking windows', async () => {
    const login = limiter({ perAddress: 1, perEmail: 1, windowMs: 60_000 });
    const who = subject();
    const [addressKey] = keysOf(who);
    await login.attempt(who);
    await client().pexpire(addressKey, 120_000);

    const refused = await login.attempt(who);

    expect(refused).toMatchObject({ allowed: false });
    expect(refused.retryAfterSeconds).toBeGreaterThan(110);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(120);
  });

  it('opens again once the window has passed', async () => {
    const login = limiter({ perAddress: 5, perEmail: 1, windowMs: 60_000 });
    const who = subject();
    const [addressKey, emailKey] = keysOf(who);
    await login.attempt(who);
    expect((await login.attempt(who)).allowed).toBe(false);

    const raw = client();
    await raw.pexpire(emailKey, 1);
    await expect.poll(() => raw.exists(emailKey), { timeout: 5_000 }).toBe(0);

    await expect(login.attempt(who)).resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });
    await expect(raw.get(addressKey)).resolves.toBe('2');
  });

  it('forgets only the email after a session opens', async () => {
    const login = limiter({ perAddress: 5, perEmail: 1, windowMs: 60_000 });
    const who = subject();
    const [addressKey, emailKey] = keysOf(who);
    await login.attempt(who);

    await login.reset({ email: who.email.toUpperCase() });

    const raw = client();
    await expect(raw.exists(emailKey)).resolves.toBe(0);
    await expect(raw.get(addressKey)).resolves.toBe('1');
    await expect(login.attempt(who)).resolves.toMatchObject({ allowed: true });
  });

  it('shares one budget between two limiters on one Valkey, as two API instances do', async () => {
    const first = limiter();
    const second = limiter();
    const who = subject();

    const decisions = await Promise.all(
      Array.from({ length: 16 }, (_, index) => (index % 2 === 0 ? first : second).attempt(who)),
    );

    expect(decisions.filter(({ allowed }) => allowed)).toHaveLength(10);
    await expect(client().get(keysOf(who)[1])).resolves.toBe('10');
  });

  it('names no key with an address or an email (review P32)', async () => {
    const login = limiter();
    await login.attempt({ ip: '203.0.113.250', email: 'synthetic.scan@example.com' });

    const keys = await client().keys('*');

    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).not.toContain('@');
      expect(key).not.toContain('203.0.113');
      expect(key).not.toContain('example.com');
    }
    for (const key of keys.filter((name) => name.startsWith('openverify:login-limit:'))) {
      expect(key).toMatch(/^openverify:login-limit:v1:[ae]:[0-9a-f]{64}$/);
    }
  });
});

describe('the login limiter without its store (C246.2)', () => {
  it('fails closed with 503 login_unavailable when Valkey does not answer', async () => {
    const warnings: string[] = [];
    const login = createValkeyLoginRateLimiter({
      // A port nothing listens on: the closed Valkey of an outage.
      redis: client('redis://127.0.0.1:1'),
      blindIndexKey: BLIND_INDEX_KEY,
      logger: { warn: (_object, message) => warnings.push(message), info: () => undefined },
    });

    await expect(login.attempt(subject())).rejects.toBeInstanceOf(LoginUnavailableError);
    expect(warnings).toHaveLength(1);
  });
});

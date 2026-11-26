import { describe, expect, it } from 'vitest';
import { systemClock, type Clock } from '../ports.js';
import {
  DEFAULT_LOGIN_RATE_LIMITS,
  createLoginRateLimiter,
  createSharedLoginRateLimiter,
  type LoginRateLimitOptions,
} from './login-rate-limiter.js';
import { LoginUnavailableError } from './valkey-login-rate-limiter.js';

const MINUTE = 60_000;

function fakeClock(start = Date.parse('2026-10-20T12:00:00.000Z')) {
  let now = start;
  const clock: Clock = { now: () => new Date(now) };
  return {
    clock,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function limiter(options: Partial<LoginRateLimitOptions> = {}) {
  const time = fakeClock();
  return {
    ...time,
    limiter: createLoginRateLimiter({
      perIp: { max: 5, windowMs: 15 * MINUTE },
      perEmail: { max: 3, windowMs: 15 * MINUTE },
      clock: time.clock,
      ...options,
    }),
  };
}

const IP = '203.0.113.10';
const OTHER_IP = '198.51.100.20';
const EMAIL = 'operator@example.test';

describe('DEFAULT_LOGIN_RATE_LIMITS', () => {
  it('allows a few retries per account and more per address, over 15 minutes', () => {
    expect(DEFAULT_LOGIN_RATE_LIMITS).toEqual({
      perIp: { max: 50, windowMs: 15 * MINUTE },
      perEmail: { max: 10, windowMs: 15 * MINUTE },
    });
  });
});

describe('createLoginRateLimiter', () => {
  it('allows attempts for an email up to its limit, then blocks with a retry delay', async () => {
    const { limiter: limit } = limiter();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(limit.attempt({ ip: IP, email: EMAIL })).resolves.toEqual({
        allowed: true,
        retryAfterSeconds: 0,
      });
    }
    await expect(limit.attempt({ ip: OTHER_IP, email: EMAIL })).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 15 * 60,
    });
  });

  it('counts an email regardless of case and surrounding spaces', async () => {
    const { limiter: limit } = limiter();

    await limit.attempt({ ip: IP, email: EMAIL });
    await limit.attempt({ ip: IP, email: ' OPERATOR@example.test' });
    await limit.attempt({ ip: IP, email: 'Operator@Example.Test ' });

    await expect(limit.attempt({ ip: OTHER_IP, email: EMAIL })).resolves.toMatchObject({
      allowed: false,
    });
  });

  it('blocks an address that tries many emails', async () => {
    const { limiter: limit } = limiter();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await limit.attempt({ ip: IP, email: `user-${String(attempt)}@example.test` });
    }

    await expect(limit.attempt({ ip: IP, email: 'fresh@example.test' })).resolves.toMatchObject({
      allowed: false,
    });
    await expect(
      limit.attempt({ ip: OTHER_IP, email: 'fresh@example.test' }),
    ).resolves.toMatchObject({ allowed: true });
  });

  it('reports the time left in the window', async () => {
    const { limiter: limit, advance } = limiter();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await limit.attempt({ ip: IP, email: EMAIL });
    }

    advance(10 * MINUTE + 500);

    await expect(limit.attempt({ ip: IP, email: EMAIL })).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 5 * 60,
    });
  });

  it('starts a new window once the old one has passed', async () => {
    const { limiter: limit, advance } = limiter();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await limit.attempt({ ip: IP, email: EMAIL });
    }

    advance(15 * MINUTE);

    await expect(limit.attempt({ ip: IP, email: EMAIL })).resolves.toMatchObject({
      allowed: true,
    });
  });

  it('does not count a blocked attempt against the other key', async () => {
    const { limiter: limit } = limiter({ perIp: { max: 1, windowMs: 15 * MINUTE } });

    await limit.attempt({ ip: IP, email: 'first@example.test' });
    // Blocked by the address limit: the email's own counter must stay untouched.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(limit.attempt({ ip: IP, email: EMAIL })).resolves.toMatchObject({
        allowed: false,
      });
    }

    await expect(limit.attempt({ ip: OTHER_IP, email: EMAIL })).resolves.toMatchObject({
      allowed: true,
    });
  });

  it('forgets an email after a successful login, but not the address', async () => {
    const { limiter: limit } = limiter({ perIp: { max: 4, windowMs: 15 * MINUTE } });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await limit.attempt({ ip: IP, email: EMAIL });
    }

    await limit.reset({ email: ' Operator@Example.test' });

    await expect(limit.attempt({ ip: OTHER_IP, email: EMAIL })).resolves.toMatchObject({
      allowed: true,
    });
    await limit.attempt({ ip: IP, email: 'other@example.test' });
    await expect(limit.attempt({ ip: IP, email: 'third@example.test' })).resolves.toMatchObject({
      allowed: false,
    });
  });

  it('keeps memory bounded: expired windows are pruned, then the oldest keys evicted', async () => {
    const { limiter: limit, advance } = limiter({
      perIp: { max: 1, windowMs: 15 * MINUTE },
      perEmail: { max: 1, windowMs: 15 * MINUTE },
      maxKeys: 4,
    });

    await limit.attempt({ ip: IP, email: 'a@example.test' });
    advance(15 * MINUTE);
    await limit.attempt({ ip: OTHER_IP, email: 'b@example.test' });
    expect(limit.size()).toBe(4);

    // Full, but the first two windows have expired: they are pruned and nothing live is lost.
    await limit.attempt({ ip: '192.0.2.1', email: 'c@example.test' });
    expect(limit.size()).toBe(4);
    await expect(
      limit.attempt({ ip: '192.0.2.9', email: 'b@example.test' }),
    ).resolves.toMatchObject({ allowed: false });

    // Full of live entries: the oldest (OTHER_IP, then b@) give way.
    await limit.attempt({ ip: '192.0.2.2', email: 'd@example.test' });
    expect(limit.size()).toBe(4);
    await expect(limit.attempt({ ip: OTHER_IP, email: 'e@example.test' })).resolves.toMatchObject({
      allowed: true,
    });
  });

  it('uses the defaults and the system clock when given no options', async () => {
    const limit = createLoginRateLimiter();

    await expect(limit.attempt({ ip: IP, email: EMAIL })).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it.each([
    { perIp: { max: 0, windowMs: MINUTE } },
    { perEmail: { max: 1, windowMs: 0 } },
    { perEmail: { max: 1.5, windowMs: MINUTE } },
    { maxKeys: 1 },
  ])('rejects a nonsensical configuration %j', (options) => {
    expect(() => createLoginRateLimiter(options)).toThrow(RangeError);
  });
});

describe('createSharedLoginRateLimiter (C246.1, C246.2; Workflow 11B auth-sessions)', () => {
  // A synthetic blind-index key; the Valkey address is a port nothing listens on.
  const options = {
    redisUrl: 'redis://127.0.0.1:1',
    blindIndexKey: new Uint8Array(32).fill(5),
    clock: systemClock,
  };

  it('counts in Valkey, holding nothing in process, and fails closed when it cannot be reached', async () => {
    const warnings: string[] = [];
    const metrics: unknown[] = [];
    const shared = createSharedLoginRateLimiter({
      ...options,
      logger: {
        warn: (_object, message) => warnings.push(message),
        info: (object) => metrics.push(object),
      },
    });

    await expect(
      shared.limiter.attempt({ ip: '192.0.2.1', email: 'synthetic.operator@example.com' }),
    ).rejects.toBeInstanceOf(LoginUnavailableError);
    expect(shared.limiter.size()).toBe(0);
    expect(warnings).toHaveLength(1);
    expect(metrics).toEqual([{ metric: 'rate_limiter_store_unavailable', value: 1 }]);
    await expect(shared.close()).resolves.toBeUndefined();
  });

  it('refuses a blind-index key that is not 32 bytes, naming the variable', () => {
    expect(() =>
      createSharedLoginRateLimiter({ ...options, blindIndexKey: new Uint8Array(8) }),
    ).toThrow(/OPENVERIFY_BLIND_INDEX_KEY/);
  });
});

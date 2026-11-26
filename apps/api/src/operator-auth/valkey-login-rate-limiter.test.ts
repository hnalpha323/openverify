/**
 * C246 (Workflow 11B, auth-sessions): the Valkey login limiter's glue over a recording client. The
 * script itself runs against a real Valkey in `valkey-login-rate-limiter.integration.test.ts`.
 * Every address is from 203.0.113.0/24 and every email at example.com.
 */
import { createHmac } from 'node:crypto';
import {
  LOGIN_LIMIT_KEY_LABEL,
  LOGIN_LIMITS,
  LOGIN_UNAVAILABLE_RETRY_AFTER_SECONDS,
  loginLimitKeys,
} from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { metrics } from '../metrics-registry.js';
import {
  createValkeyLoginRateLimiter,
  LOGIN_LIMIT_COMMAND,
  LOGIN_LIMIT_SCRIPT,
  loginLimitHmacs,
  loginLimitSubkey,
  LoginUnavailableError,
  type LoginLimitLogger,
  type LoginLimitRedis,
} from './valkey-login-rate-limiter.js';

// A synthetic blind-index key, made for these tests only.
const BLIND_INDEX_KEY = new Uint8Array(32).fill(7);
const ADDRESS = '203.0.113.24';
const EMAIL = 'Synthetic.Operator@Example.com';

interface Call {
  keys: [string, string];
  args: string[];
}

/** A client recording the script's calls and answering `answers` in turn. */
function recordingRedis(options: { status?: string; answers?: unknown[]; failDel?: boolean } = {}) {
  const calls: Call[] = [];
  const deleted: string[] = [];
  const defined: { name: string; numberOfKeys: number; lua: string }[] = [];
  const answers = [...(options.answers ?? [0])];
  const client = {
    status: options.status ?? 'ready',
    defineCommand(name: string, definition: { numberOfKeys: number; lua: string }) {
      defined.push({ name, ...definition });
      (client as unknown as Record<string, unknown>)[name] = (
        addressKey: string,
        emailKey: string,
        ...args: string[]
      ) => {
        calls.push({ keys: [addressKey, emailKey], args });
        const answer = answers.length > 1 ? answers.shift() : answers[0];
        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
      };
    },
    del(key: string) {
      if (options.failDel === true) {
        return Promise.reject(new Error('synthetic connection reset'));
      }
      deleted.push(key);
      return Promise.resolve(1);
    },
  };
  return { client: client as LoginLimitRedis, calls, deleted, defined };
}

function recordingLogger() {
  const warnings: { object: Record<string, unknown>; message: string }[] = [];
  const infos: { object: Record<string, unknown>; message: string }[] = [];
  const logger: LoginLimitLogger = {
    warn: (object, message) => warnings.push({ object, message }),
    info: (object, message) => infos.push({ object, message }),
  };
  return { logger, warnings, infos };
}

const hmac = (key: Uint8Array, value: string) =>
  createHmac('sha256', key).update(value, 'utf8').digest('hex');

describe('loginLimitSubkey (C246.1)', () => {
  it('is HMAC-SHA-256 of the label under the blind-index key, as the blind index derives its subkeys', () => {
    const expected = createHmac('sha256', BLIND_INDEX_KEY)
      .update(LOGIN_LIMIT_KEY_LABEL, 'utf8')
      .digest();

    expect(LOGIN_LIMIT_KEY_LABEL).toBe('openverify/login-limit/v1');
    expect(Buffer.from(loginLimitSubkey(BLIND_INDEX_KEY))).toEqual(expected);
  });

  it('refuses a key that is not 32 bytes, naming the variable and never the key', () => {
    expect(() => loginLimitSubkey(new Uint8Array(16).fill(7))).toThrow(
      /OPENVERIFY_BLIND_INDEX_KEY/,
    );
  });
});

describe('loginLimitHmacs (C246.1, C246.3)', () => {
  const subkey = new Uint8Array(32).fill(3);

  it('hashes ip:<address> and email:<normalised email> under the subkey', () => {
    expect(loginLimitHmacs(subkey, { ip: ADDRESS, email: EMAIL })).toEqual({
      addressHmac: hmac(subkey, `ip:${ADDRESS}`),
      emailHmac: hmac(subkey, 'email:synthetic.operator@example.com'),
    });
  });

  it('gives one email key whatever its case or surrounding space, across every organisation', () => {
    const a = loginLimitHmacs(subkey, { ip: ADDRESS, email: '  SYNTHETIC.operator@example.COM ' });
    const b = loginLimitHmacs(subkey, { ip: '198.51.100.7', email: EMAIL });

    expect(a.emailHmac).toBe(b.emailHmac);
    expect(a.addressHmac).not.toBe(b.addressHmac);
  });
});

describe('createValkeyLoginRateLimiter (C246.1)', () => {
  it('registers the one script over two keys', () => {
    const redis = recordingRedis();
    createValkeyLoginRateLimiter({
      redis: redis.client,
      blindIndexKey: BLIND_INDEX_KEY,
      logger: recordingLogger().logger,
    });

    expect(redis.defined).toEqual([
      { name: LOGIN_LIMIT_COMMAND, numberOfKeys: 2, lua: LOGIN_LIMIT_SCRIPT },
    ]);
    expect(LOGIN_LIMIT_SCRIPT).toMatch(/KEYS\[1\]/);
    expect(LOGIN_LIMIT_SCRIPT).toMatch(/KEYS\[2\]/);
    expect(LOGIN_LIMIT_SCRIPT).toMatch(/PEXPIRE/);
  });

  it('counts an attempt under the two HMAC key names with C4 limits, so no key holds an address or an email', async () => {
    const redis = recordingRedis({ answers: [0] });
    const limiter = createValkeyLoginRateLimiter({
      redis: redis.client,
      blindIndexKey: BLIND_INDEX_KEY,
      logger: recordingLogger().logger,
    });

    await expect(limiter.attempt({ ip: ADDRESS, email: EMAIL })).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });

    const keys = loginLimitKeys(
      loginLimitHmacs(loginLimitSubkey(BLIND_INDEX_KEY), { ip: ADDRESS, email: EMAIL }),
    );
    expect(redis.calls).toEqual([
      {
        keys: [...keys],
        args: [
          String(LOGIN_LIMITS.perAddress),
          String(LOGIN_LIMITS.perEmail),
          String(LOGIN_LIMITS.windowSeconds * 1000),
        ],
      },
    ]);
    for (const key of redis.calls[0]?.keys ?? []) {
      expect(key).not.toContain('@');
      expect(key).not.toContain(ADDRESS);
      expect(key.toLowerCase()).not.toContain('synthetic.operator');
    }
  });

  it('refuses when the script answers a wait, rounding the milliseconds up to whole seconds', async () => {
    const limiter = createValkeyLoginRateLimiter({
      redis: recordingRedis({ answers: [12_001] }).client,
      blindIndexKey: BLIND_INDEX_KEY,
      logger: recordingLogger().logger,
    });

    await expect(limiter.attempt({ ip: ADDRESS, email: EMAIL })).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 13,
    });
  });

  it('passes narrower limits for tests', async () => {
    const redis = recordingRedis();
    const limiter = createValkeyLoginRateLimiter({
      redis: redis.client,
      blindIndexKey: BLIND_INDEX_KEY,
      logger: recordingLogger().logger,
      limits: { perAddress: 3, perEmail: 2, windowMs: 1500 },
    });

    await limiter.attempt({ ip: ADDRESS, email: EMAIL });

    expect(redis.calls[0]?.args).toEqual(['3', '2', '1500']);
  });

  it('forgets the email key after a session opens, and tracks no key in process', async () => {
    const redis = recordingRedis();
    const limiter = createValkeyLoginRateLimiter({
      redis: redis.client,
      blindIndexKey: BLIND_INDEX_KEY,
      logger: recordingLogger().logger,
    });

    await limiter.reset({ email: EMAIL });

    const [, emailKey] = loginLimitKeys(
      loginLimitHmacs(loginLimitSubkey(BLIND_INDEX_KEY), { ip: '0.0.0.0', email: EMAIL }),
    );
    expect(redis.deleted).toEqual([emailKey]);
    expect(limiter.size()).toBe(0);
  });
});

describe('createValkeyLoginRateLimiter fails closed (C246.2)', () => {
  const unavailable = async (redis: LoginLimitRedis) => {
    const log = recordingLogger();
    const limiter = createValkeyLoginRateLimiter({
      redis,
      blindIndexKey: BLIND_INDEX_KEY,
      logger: log.logger,
    });
    const error: unknown = await limiter
      .attempt({ ip: ADDRESS, email: EMAIL })
      .catch((thrown: unknown) => thrown);
    return { error, log };
  };

  it.each([
    ['ioredis knows the store is down', recordingRedis({ status: 'reconnecting' })],
    ['the command fails', recordingRedis({ answers: [new Error('synthetic ECONNREFUSED')] })],
    ['the script answers something else', recordingRedis({ answers: [['unexpected']] })],
    ['the script answers a negative wait', recordingRedis({ answers: [-1] })],
  ])('answers 503 login_unavailable with Retry-After when %s', async (_case, redis) => {
    const { error, log } = await unavailable(redis.client);

    expect(error).toBeInstanceOf(LoginUnavailableError);
    expect(error).toMatchObject({
      status: 503,
      code: 'login_unavailable',
      headers: { 'retry-after': String(LOGIN_UNAVAILABLE_RETRY_AFTER_SECONDS) },
    });
    expect(LOGIN_UNAVAILABLE_RETRY_AFTER_SECONDS).toBe(30);
    expect(log.warnings).toHaveLength(1);
    expect(log.infos).toEqual([
      {
        object: { metric: 'rate_limiter_store_unavailable', value: 1 },
        message: expect.any(String) as unknown,
      },
    ]);
  });

  it('emits a registered metric (C250.7, rule 20): a counter with no label', () => {
    expect(metrics.get('rate_limiter_store_unavailable')).toMatchObject({
      kind: 'counter',
      unit: 'count',
      labels: [],
      contract: 'C246.2',
    });
  });

  it('never calls the store while ioredis knows it is down', async () => {
    const redis = recordingRedis({ status: 'end' });

    await unavailable(redis.client);

    expect(redis.calls).toEqual([]);
  });

  it('logs no address, email, key name or store error text', async () => {
    const { log } = await unavailable(
      recordingRedis({ answers: [new Error(`synthetic failure for ${EMAIL} at ${ADDRESS}`)] })
        .client,
    );

    const written = JSON.stringify([log.warnings, log.infos]);
    expect(written).not.toContain('@');
    expect(written).not.toContain(ADDRESS);
    expect(written).not.toContain('openverify:login-limit');
  });

  it('lets a session that opened keep its sign-in when the reset cannot reach the store, with a warn line', async () => {
    const log = recordingLogger();
    const limiter = createValkeyLoginRateLimiter({
      redis: recordingRedis({ failDel: true }).client,
      blindIndexKey: BLIND_INDEX_KEY,
      logger: log.logger,
    });

    await expect(limiter.reset({ email: EMAIL })).resolves.toBeUndefined();
    expect(log.warnings).toHaveLength(1);
    expect(JSON.stringify(log.warnings)).not.toContain('@');
  });
});

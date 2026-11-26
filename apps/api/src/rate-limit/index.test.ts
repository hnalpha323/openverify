import { describe, expect, it, vi } from 'vitest';
import type { RateLimitRule } from '../ports.js';
import { fixedClock, T0 } from '../test-support/fakes.js';
import {
  closeRateLimitRedis,
  createRateLimiter,
  createRateLimitRedis,
  GCRA_COMMAND,
  GCRA_PEEK_COMMAND,
  type RateLimitRedis,
} from './index.js';

const API_RULE: RateLimitRule = { name: 'api', limit: 300, windowSeconds: 60 };

/** An ioredis stand-in: records script calls and answers with the queued replies. */
function fakeRedis(replies: unknown[] = [[1, 299, 200, 0]], status = 'ready') {
  const calls: string[][] = [];
  const defined: { name: string; numberOfKeys: number; lua: string }[] = [];
  const redis = {
    status,
    defineCommand(name: string, definition: { numberOfKeys: number; lua: string }) {
      defined.push({ name, ...definition });
    },
    [GCRA_COMMAND]: (...args: string[]) => {
      calls.push(args);
      const reply = replies.shift();
      return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
    },
  };
  return { redis: redis as unknown as RateLimitRedis, calls, defined };
}

describe('createRateLimiter', () => {
  it('registers the GCRA script and its read-only peek once each, as Valkey commands with one key', () => {
    const { redis, defined } = fakeRedis();

    createRateLimiter({ redis });

    expect(defined).toEqual([
      {
        name: GCRA_COMMAND,
        numberOfKeys: 1,
        lua: expect.stringContaining("redis.call('TIME')") as unknown,
      },
      {
        name: GCRA_PEEK_COMMAND,
        numberOfKeys: 1,
        lua: expect.not.stringContaining("redis.call('SET'") as unknown,
      },
    ]);
  });

  it('runs the script with the emission interval and limit under a hashed per-policy key', async () => {
    const { redis, calls } = fakeRedis([
      [1, 299, 200, 0],
      [1, 298, 400, 0],
      [1, 599, 100, 0],
    ]);
    const limiter = createRateLimiter({ redis });

    await limiter.consume('203.0.113.7', API_RULE);
    await limiter.consume('203.0.113.7', API_RULE);
    await limiter.consume('203.0.113.7', { name: 'flow-ip', limit: 600, windowSeconds: 60 });

    expect(calls[0]).toEqual([
      expect.stringMatching(/^openverify:rate-limit:api:[\w-]{43}$/),
      '200',
      '300',
    ]);
    expect(calls[1]?.[0]).toBe(calls[0]?.[0]);
    expect(calls[2]).toEqual([
      expect.stringMatching(/^openverify:rate-limit:flow-ip:[\w-]{43}$/),
      '100',
      '600',
    ]);
    // Client addresses and credentials never reach Valkey in clear.
    expect(calls.flat().join(' ')).not.toContain('203.0.113.7');
  });

  it('keeps fractional emission intervals exact', async () => {
    const { redis, calls } = fakeRedis();

    await createRateLimiter({ redis }).consume('k', { name: 'api', limit: 7, windowSeconds: 60 });

    expect(Number(calls[0]?.[1]) * 7).toBeCloseTo(60_000, 6);
  });

  it('turns an allowed reply into a decision, resetting when the quota is whole again', async () => {
    const { redis } = fakeRedis([[1, 299, 200, 0]]);

    const decision = await createRateLimiter({ redis, clock: fixedClock() }).consume('k', API_RULE);

    expect(decision).toEqual({
      allowed: true,
      limit: 300,
      remaining: 299,
      resetAt: new Date(T0.getTime() + 200),
      retryAfterSeconds: 0,
    });
  });

  it('turns a refused reply into a decision with Retry-After in whole seconds', async () => {
    const { redis } = fakeRedis([[0, 0, 60_000, 1_500]]);

    const decision = await createRateLimiter({ redis, clock: fixedClock() }).consume('k', API_RULE);

    expect(decision).toEqual({
      allowed: false,
      limit: 300,
      remaining: 0,
      resetAt: new Date(T0.getTime() + 60_000),
      retryAfterSeconds: 2,
    });
  });

  it('never asks a refused client to retry after less than a second', async () => {
    const { redis } = fakeRedis([[0, 0, 10, 1]]);

    const decision = await createRateLimiter({ redis }).consume('k', API_RULE);

    expect(decision.retryAfterSeconds).toBe(1);
  });

  it.each(['reconnecting', 'close', 'end'])(
    'rejects at once, without calling Valkey, while the connection is %s',
    async (status) => {
      const { redis, calls } = fakeRedis([], status);

      await expect(createRateLimiter({ redis }).consume('k', API_RULE)).rejects.toThrow(
        /Valkey is unavailable/,
      );
      expect(calls).toEqual([]);
    },
  );

  it.each(['wait', 'connecting', 'connect', 'ready'])(
    'sends the script while the connection is %s',
    async (status) => {
      const { redis, calls } = fakeRedis([[1, 0, 1, 0]], status);

      await createRateLimiter({ redis }).consume('k', API_RULE);

      expect(calls).toHaveLength(1);
    },
  );

  it.each([
    ['ioredis knows Valkey is down', fakeRedis([], 'reconnecting')],
    ['the command fails', fakeRedis([new Error('synthetic connection reset')])],
    ['the script answers off contract', fakeRedis(['OK'])],
  ])(
    'reports a store that does not answer when %s: one warn line and rate_limiter_store_unavailable (C246.2, Workflow 11B)',
    async (_case, { redis }) => {
      const logger = { warn: vi.fn(), info: vi.fn() };

      await expect(createRateLimiter({ redis, logger }).consume('k', API_RULE)).rejects.toThrow();

      expect(logger.warn).toHaveBeenCalledOnce();
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('synthetic connection reset');
      expect(logger.info.mock.calls).toEqual([
        [{ metric: 'rate_limiter_store_unavailable', value: 1 }, 'metric'],
      ]);
    },
  );

  it('reports nothing for an invalid rule, a programming error and not the store', async () => {
    const logger = { warn: vi.fn(), info: vi.fn() };
    const { redis } = fakeRedis();

    await expect(
      createRateLimiter({ redis, logger }).consume('k', {
        name: 'api',
        limit: 0,
        windowSeconds: 1,
      }),
    ).rejects.toBeInstanceOf(RangeError);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('rejects when Valkey fails', async () => {
    const { redis } = fakeRedis([new Error('connection reset')]);

    await expect(createRateLimiter({ redis }).consume('k', API_RULE)).rejects.toThrow(
      'connection reset',
    );
  });

  it.each([['OK'], [[1, 2]], [[1, 'many', 3, 0]], [[2, 1, 1, 0]], [[1, -1, 1, 0]], [null]])(
    'rejects an unexpected script reply %j',
    async (reply) => {
      const { redis } = fakeRedis([reply]);

      await expect(createRateLimiter({ redis }).consume('k', API_RULE)).rejects.toThrow(
        /unexpected reply/,
      );
    },
  );

  it.each([
    { name: 'api', limit: 0, windowSeconds: 60 },
    { name: 'api', limit: 1.5, windowSeconds: 60 },
    { name: 'api', limit: 10, windowSeconds: 0 },
  ] as const)('refuses an invalid rule %j', async (rule) => {
    const { redis } = fakeRedis();

    await expect(createRateLimiter({ redis }).consume('k', rule)).rejects.toBeInstanceOf(
      RangeError,
    );
  });
});

describe('createRateLimitRedis', () => {
  it('builds a lazy client that fails fast instead of holding requests', async () => {
    const redis = createRateLimitRedis('redis://:synthetic@127.0.0.1:1/2');

    expect(redis.status).toBe('wait');
    expect(redis.options).toMatchObject({
      host: '127.0.0.1',
      port: 1,
      password: 'synthetic',
      db: 2,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      commandTimeout: 500,
      connectTimeout: 2_000,
    });
    expect(redis.listenerCount('error')).toBeGreaterThan(0);

    await closeRateLimitRedis(redis);
    expect(redis.status).toBe('end');
  });
});

describe('closeRateLimitRedis', () => {
  it('quits a connected client gracefully', async () => {
    const client = {
      status: 'ready',
      quit: vi.fn(() => Promise.resolve('OK')),
      disconnect: vi.fn(),
    };

    await closeRateLimitRedis(client);

    expect(client.quit).toHaveBeenCalledOnce();
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects when quitting fails', async () => {
    const client = {
      status: 'ready',
      quit: vi.fn(() => Promise.reject(new Error('gone'))),
      disconnect: vi.fn(),
    };

    await closeRateLimitRedis(client);

    expect(client.disconnect).toHaveBeenCalledOnce();
  });

  it('disconnects a client that is not connected without connecting it', async () => {
    const client = { status: 'reconnecting', quit: vi.fn(), disconnect: vi.fn() };

    await closeRateLimitRedis(client);

    expect(client.quit).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledOnce();
  });
});

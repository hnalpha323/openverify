/**
 * C240.3, Workflow 11B Stage 1a amendment 22 (KP11-11; integration-11b): the limiter's `peek` against
 * a real Valkey (Testcontainers, `valkey/valkey:9.1`). It reads a bucket without counting: a bucket
 * never used shows its whole limit, a used one exactly what `consume` left, and peeking twice changes
 * nothing, so the next `consume` sees the same state. A rule of ten an hour keeps the store's own clock
 * from refilling a request between the calls.
 */
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RateLimiter, RateLimitRule } from '../ports.js';
import { closeRateLimitRedis, createRateLimiter, createRateLimitRedis } from './index.js';
import { VALKEY_TEST_IMAGE } from '../test-support/integration-valkey.js';

const VALKEY_IMAGE = VALKEY_TEST_IMAGE;
const RULE: RateLimitRule = { name: 'connect-redeem', limit: 10, windowSeconds: 3_600 };

let valkey: StartedTestContainer;
let redis: ReturnType<typeof createRateLimitRedis>;
let limiter: RateLimiter;

beforeAll(async () => {
  valkey = await new GenericContainer(VALKEY_IMAGE)
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
  redis = createRateLimitRedis(`redis://${valkey.getHost()}:${String(valkey.getMappedPort(6379))}`);
  limiter = createRateLimiter({ redis });
});

afterAll(async () => {
  await closeRateLimitRedis(redis);
  await valkey.stop();
});

describe('RateLimiter.peek (C240.3)', () => {
  it('shows a fresh bucket whole and writes nothing', async () => {
    const peek = limiter.peek?.bind(limiter);
    expect(peek).toBeDefined();
    const fresh = await peek?.('key_synthetic_fresh:env_synthetic', RULE);
    expect(fresh).toMatchObject({ allowed: true, limit: 10, remaining: 10, retryAfterSeconds: 0 });
    await peek?.('key_synthetic_fresh:env_synthetic', RULE);

    const first = await limiter.consume('key_synthetic_fresh:env_synthetic', RULE);
    expect(first.remaining).toBe(9);
  });

  it('shows what consume left, unchanged by peeking again', async () => {
    const key = 'key_synthetic_used:env_synthetic';
    let last = await limiter.consume(key, RULE);
    for (let index = 1; index < 3; index += 1) {
      last = await limiter.consume(key, RULE);
    }
    expect(last.remaining).toBe(7);

    const peeked = await limiter.peek?.(key, RULE);
    const again = await limiter.peek?.(key, RULE);
    expect(peeked).toMatchObject({ allowed: true, limit: 10, remaining: 7 });
    expect(again?.remaining).toBe(7);
    expect((await limiter.consume(key, RULE)).remaining).toBe(6);
  });

  it('shows an exhausted bucket refused, with the retry time', async () => {
    const key = 'key_synthetic_spent:env_synthetic';
    for (let index = 0; index < 10; index += 1) {
      await limiter.consume(key, RULE);
    }

    const peeked = await limiter.peek?.(key, RULE);

    expect(peeked).toMatchObject({ allowed: false, remaining: 0 });
    expect(peeked?.retryAfterSeconds).toBeGreaterThan(0);
  });
});

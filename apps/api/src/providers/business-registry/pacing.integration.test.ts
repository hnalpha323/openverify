/**
 * Workflow 5C review K4 against a real Valkey (Testcontainers, `valkey/valkey:9.1`): the KYB and
 * RDAP pacing over the worker's GCRA limiter lets one request through per interval for each key,
 * across processes (two limiters on two connections), on Valkey's clock. Only lower bounds on the
 * time taken are asserted, which a loaded machine cannot break. Keys are synthetic.
 *
 * KP11-13 (Workflow 11B, integration-11b): a limiter command that fails makes the pacer fall back to
 * per-process turns (`pacing-fallback.test.ts`), which once read as a pacing failure at load 13.7
 * (263 ms against 380). So the test's connections wait for Valkey as long as a loaded run needs (a
 * command timeout of 10 s, not the production client's 500 ms), and each test asserts that no
 * limiter command failed before it reads the time.
 */
import { Redis } from 'ioredis';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeRateLimitRedis, createRateLimiter } from '../../rate-limit/index.js';
import { createProviderPacer, type PacingRule } from './pacing.js';
import { countingLimiter, type CountingLimiter } from './pacing.test-support.js';
import { VALKEY_TEST_IMAGE } from '../../test-support/integration-valkey.js';

const VALKEY_IMAGE = VALKEY_TEST_IMAGE;
/** Two hundred milliseconds a turn, as a fractional GCRA window (0.2 s). */
const RULE: PacingRule = { name: 'synthetic-register', intervalMs: 200 };

let valkey: StartedTestContainer;
let connections: Redis[] = [];
let limiters: CountingLimiter[] = [];
let run = 0;

beforeAll(async () => {
  valkey = await new GenericContainer(VALKEY_IMAGE)
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
  const url = `redis://${valkey.getHost()}:${String(valkey.getMappedPort(6379))}`;
  const connection = () =>
    new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, commandTimeout: 10_000 });
  connections = [connection(), connection()];
  limiters = connections.map((redis) => countingLimiter(createRateLimiter({ redis })));
});

afterAll(async () => {
  await Promise.all(connections.map((redis) => closeRateLimitRedis(redis)));
  await valkey.stop();
});

/** A key no other test shares. */
function key(): string {
  run += 1;
  return `install-${String(Date.now())}-${String(run)}`;
}

describe('createProviderPacer over the GCRA script in Valkey', () => {
  it('lets one request through per interval for a key, across two processes', async () => {
    const [first, second] = limiters.map((rateLimiter) => createProviderPacer({ rateLimiter }));
    const shared = key();
    const started = performance.now();

    await first?.acquire(RULE, shared);
    await second?.acquire(RULE, shared);
    await first?.acquire(RULE, shared);

    // The second and third requests each waited for their turn, through Valkey (no fallback).
    expect(limiters.map((limiter) => limiter.failures)).toEqual([0, 0]);
    expect(performance.now() - started).toBeGreaterThanOrEqual(2 * RULE.intervalMs - 20);
  });

  it('keeps keys apart, so one RDAP host never waits for another', async () => {
    const pacer = createProviderPacer({ rateLimiter: limiters[0] });
    const one = key();
    const other = key();

    await pacer.acquire(RULE, one);
    const started = performance.now();
    await pacer.acquire(RULE, other);
    const apart = performance.now() - started;
    await pacer.acquire(RULE, one);
    const waited = performance.now() - started;

    expect(limiters[0]?.failures).toBe(0);
    expect(waited).toBeGreaterThan(apart);
    expect(waited).toBeGreaterThanOrEqual(RULE.intervalMs / 2);
  });
});

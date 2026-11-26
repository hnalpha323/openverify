/**
 * C61.2, C61.4: the KYB clients' pacing: one request per interval and key, shared by every worker
 * through the cache, waiting for the next slot within the wait allowed, else a retryable
 * `rate_limited`. Without a cache, or while it is down, this process paces alone. The clock moves
 * only when a request sleeps, so no test waits for real time.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createInMemoryKeyValueCache,
  fixedClock,
  type TestClock,
} from '../../test-support/fakes.js';
import type { RateLimitDecision, RateLimiter, RateLimitRule } from '../../ports.js';
import { ProviderError } from '../errors.js';
import { createProviderPacer, DEFAULT_PACING_MAX_WAIT_MS, type PacingRule } from './pacing.js';

const RULE: PacingRule = { name: 'gleif', intervalMs: 1000 };
const START = new Date('2026-10-24T09:00:00.000Z');

/** A clock, and a sleep that moves it, recording each wait. */
function timing(start = START) {
  const clock: TestClock = fixedClock(start);
  const slept: number[] = [];
  const sleep = (ms: number) => {
    slept.push(ms);
    clock.advance(ms);
    return Promise.resolve();
  };
  return { clock, slept, sleep };
}

async function refusal(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (!(error instanceof ProviderError)) {
    throw new Error('expected a ProviderError');
  }
  return error;
}

describe('createProviderPacer (C61.2)', () => {
  it('lets the first request of a slot through at once and makes the next wait for the next slot', async () => {
    const { clock, slept, sleep } = timing(new Date(START.getTime() + 250));
    const cache = createInMemoryKeyValueCache(clock);
    const pacer = createProviderPacer({ cache, clock, sleep });

    await pacer.acquire(RULE, 'install');
    await pacer.acquire(RULE, 'install');

    expect(slept).toEqual([750]);
    expect(clock.now()).toEqual(new Date(START.getTime() + 1000));
  });

  it('paces every worker that shares the cache together (install-wide)', async () => {
    const { clock, slept, sleep } = timing();
    const cache = createInMemoryKeyValueCache(clock);
    const first = createProviderPacer({ cache, clock, sleep });
    const second = createProviderPacer({ cache, clock, sleep });

    await first.acquire(RULE, 'install');
    await second.acquire(RULE, 'install');
    await first.acquire(RULE, 'install');

    expect(slept).toEqual([1000, 1000]);
  });

  it('keeps keys apart, so one RDAP host never waits for another', async () => {
    const { clock, slept, sleep } = timing();
    const cache = createInMemoryKeyValueCache(clock);
    const pacer = createProviderPacer({ cache, clock, sleep });
    const rdap: PacingRule = { name: 'rdap', intervalMs: 1000 };

    await pacer.acquire(rdap, 'rdap.registry-one.example.test');
    await pacer.acquire(rdap, 'rdap.registry-two.example.test');

    expect(slept).toEqual([]);
  });

  it('names the rule and a SHA-256 of the key in the cache, never the key itself', async () => {
    const { clock, sleep } = timing();
    const cache = createInMemoryKeyValueCache(clock);
    const pacer = createProviderPacer({ cache, clock, sleep });

    await pacer.acquire({ name: 'rdap', intervalMs: 1000 }, 'rdap.registry-one.example.test');

    const digest = createHash('sha256').update('rdap.registry-one.example.test').digest('hex');
    expect(cache.keys()).toHaveLength(1);
    expect(cache.keys()[0]).toMatch(new RegExp(`^openverify:pacing:rdap:${digest}:\\d+$`));
    expect(cache.keys().join()).not.toContain('registry-one');
  });

  it('refuses with a retryable rate_limited once the turn is further away than the wait allows', async () => {
    const { clock, slept, sleep } = timing();
    const cache = createInMemoryKeyValueCache(clock);
    const pacer = createProviderPacer({ cache, clock, sleep, maxWaitMs: 1500 });
    const slow: PacingRule = { name: 'companies-house', intervalMs: 2000 };

    await pacer.acquire(slow, 'production');
    const error = await refusal(pacer.acquire(slow, 'production'));

    expect(error).toMatchObject({ code: 'rate_limited', retryable: true });
    expect(error.message).not.toContain('production');
    expect(slept).toEqual([]);
  });

  it('waits up to ten seconds by default', () => {
    expect(DEFAULT_PACING_MAX_WAIT_MS).toBe(10_000);
  });

  it('treats a slot whose list was cut by a burst as taken, and waits for the next one', async () => {
    const { clock, slept, sleep } = timing();
    const cache = createInMemoryKeyValueCache(clock);
    const pacer = createProviderPacer({ cache, clock, sleep });
    const digest = createHash('sha256').update('install').digest('hex');
    const slot = Math.floor(START.getTime() / 1000);
    for (let index = 0; index < 64; index += 1) {
      await cache.pushCapped(
        `openverify:pacing:gleif:${digest}:${String(slot)}`,
        `t${String(index)}`,
        16,
        5,
      );
    }

    await pacer.acquire(RULE, 'install');

    expect(slept).toEqual([1000]);
  });

  it('paces this process alone without a cache', async () => {
    const { clock, slept, sleep } = timing();
    const pacer = createProviderPacer({ clock, sleep });

    await pacer.acquire(RULE, 'install');
    await pacer.acquire(RULE, 'install');
    await pacer.acquire(RULE, 'other');

    expect(slept).toEqual([1000]);
  });

  it('falls back to this process alone while the cache is down, and never fails for it', async () => {
    const { clock, slept, sleep } = timing();
    const cache = createInMemoryKeyValueCache(clock);
    const pacer = createProviderPacer({ cache, clock, sleep });

    cache.failNext(new Error('Valkey is unavailable (reconnecting)'));
    await pacer.acquire(RULE, 'install');
    cache.failNext(new Error('Valkey is unavailable (reconnecting)'));
    await pacer.acquire(RULE, 'install');

    expect(slept).toEqual([1000]);
  });
});

/** A GCRA limiter answering from `answers` in turn (an `Error` rejects), recording each call. */
function scriptedLimiter(clock: TestClock, answers: (number | 'allowed' | Error)[]) {
  const calls: { key: string; rule: RateLimitRule }[] = [];
  const limiter: RateLimiter = {
    consume: (key, rule) => {
      calls.push({ key, rule });
      const answer = answers.shift() ?? 'allowed';
      if (answer instanceof Error) {
        return Promise.reject(answer);
      }
      const now = clock.now().getTime();
      // A number is the milliseconds until the refused request's turn.
      const decision: RateLimitDecision =
        answer === 'allowed'
          ? { allowed: true, limit: 1, remaining: 0, resetAt: new Date(now), retryAfterSeconds: 0 }
          : {
              allowed: false,
              limit: 1,
              remaining: 0,
              resetAt: new Date(now + answer),
              retryAfterSeconds: Math.max(1, Math.ceil(answer / 1000)),
            };
      return Promise.resolve(decision);
    },
  };
  return { limiter, calls };
}

describe('createProviderPacer over the GCRA limiter (Workflow 5C review K4)', () => {
  it('asks the GCRA script for one request per interval under the rule’s pacing name, using no cache slot', async () => {
    const { clock, slept, sleep } = timing();
    const cache = createInMemoryKeyValueCache(clock);
    const { limiter, calls } = scriptedLimiter(clock, ['allowed']);
    const pacer = createProviderPacer({ rateLimiter: limiter, cache, clock, sleep });

    await pacer.acquire(RULE, 'install');

    expect(calls).toEqual([
      { key: 'install', rule: { name: 'pacing:gleif', limit: 1, windowSeconds: 1 } },
    ]);
    expect(slept).toEqual([]);
    expect(cache.keys()).toEqual([]);
  });

  it('keeps each register’s interval: Companies House 500 ms, EDGAR 100 ms', async () => {
    const { clock, sleep } = timing();
    const { limiter, calls } = scriptedLimiter(clock, []);
    const pacer = createProviderPacer({ rateLimiter: limiter, clock, sleep });

    await pacer.acquire({ name: 'companies-house', intervalMs: 500 }, 'production');
    await pacer.acquire({ name: 'sec-edgar', intervalMs: 100 }, 'install');

    expect(calls.map(({ rule }) => rule)).toEqual([
      { name: 'pacing:companies-house', limit: 1, windowSeconds: 0.5 },
      { name: 'pacing:sec-edgar', limit: 1, windowSeconds: 0.1 },
    ]);
  });

  it('waits for the turn the limiter names when it refuses, then asks again', async () => {
    const { clock, slept, sleep } = timing();
    const { limiter, calls } = scriptedLimiter(clock, [400, 'allowed']);
    const pacer = createProviderPacer({ rateLimiter: limiter, clock, sleep });

    await pacer.acquire(RULE, 'install');

    expect(slept).toEqual([400]);
    expect(calls).toHaveLength(2);
  });

  it('fails rate_limited, retryably, when the turn is further than the wait allows', async () => {
    const { clock, slept, sleep } = timing();
    const { limiter } = scriptedLimiter(clock, [DEFAULT_PACING_MAX_WAIT_MS + 1]);
    const pacer = createProviderPacer({ rateLimiter: limiter, clock, sleep });

    const error = await refusal(pacer.acquire(RULE, 'install'));

    expect(error).toMatchObject({ code: 'rate_limited', retryable: true });
    expect(slept).toEqual([]);
  });

  it('paces this process alone while the limiter is unavailable', async () => {
    const { clock, slept, sleep } = timing();
    const down = new Error('Valkey is unavailable (reconnecting)');
    const { limiter } = scriptedLimiter(clock, [down, down]);
    const pacer = createProviderPacer({ rateLimiter: limiter, clock, sleep });

    await pacer.acquire(RULE, 'install');
    await pacer.acquire(RULE, 'install');

    expect(slept).toEqual([1000]);
  });
});

/**
 * C81.2 (V09): the GDELT budget. One request per 5 s install-wide, as GDELT asks, shared among the
 * environments that asked in the last 60 s: one environment waiting alone gets the whole budget,
 * two get half each, and one asking far beyond its share never takes another's. A refusal names
 * when to ask again (plus jitter). Valkey holds environment ids and times only. Here on a frozen
 * clock, with a GCRA limiter of the same rule as the Valkey script; the real script is exercised in
 * `budget.integration.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { RateLimitDecision, RateLimiter, RateLimitRule } from '../../ports.js';
import {
  createInMemoryKeyValueCache,
  fixedClock,
  type TestClock,
} from '../../test-support/fakes.js';
import { createGdeltBudget, GDELT_BUDGET, type GdeltBudget } from './budget.js';

/** The GCRA of `rate-limit/index.ts` on the test clock, with no burst (limit 1). */
function gcraLimiter(clock: TestClock): RateLimiter & { calls: [string, RateLimitRule][] } {
  const tats = new Map<string, number>();
  const calls: [string, RateLimitRule][] = [];
  return {
    calls,
    consume(key, rule): Promise<RateLimitDecision> {
      calls.push([key, rule]);
      const now = clock.now().getTime();
      const interval = (rule.windowSeconds * 1000) / rule.limit;
      const tat = Math.max(tats.get(`${rule.name}:${key}`) ?? 0, now);
      const allowAt = tat + interval - interval * rule.limit;
      if (allowAt > now) {
        return Promise.resolve({
          allowed: false,
          limit: rule.limit,
          remaining: 0,
          resetAt: new Date(tat),
          retryAfterSeconds: Math.max(1, Math.ceil((allowAt - now) / 1000)),
        });
      }
      tats.set(`${rule.name}:${key}`, tat + interval);
      return Promise.resolve({
        allowed: true,
        limit: rule.limit,
        remaining: 0,
        resetAt: new Date(tat + interval),
        retryAfterSeconds: 0,
      });
    },
  };
}

function setup() {
  const clock = fixedClock();
  const cache = createInMemoryKeyValueCache(clock);
  const rateLimiter = gcraLimiter(clock);
  const budget = createGdeltBudget({ rateLimiter, cache, clock, random: () => 0 });
  return { clock, cache, rateLimiter, budget };
}

/**
 * Each environment asks at `start` and then again whenever it is told to (or every `everyMs` when
 * set, ignoring the refusal, as many waiting runs of one environment do); counts the grants.
 */
async function simulate(
  clock: TestClock,
  budget: GdeltBudget,
  askers: { id: string; start?: number; everyMs?: number }[],
  durationMs: number,
): Promise<Record<string, number>> {
  const startedAt = clock.now().getTime();
  const next = new Map(askers.map(({ id, start }) => [id, startedAt + (start ?? 0)]));
  const grants: Record<string, number> = Object.fromEntries(askers.map(({ id }) => [id, 0]));
  for (let now = startedAt; now < startedAt + durationMs; now += 100) {
    clock.set(new Date(now));
    for (const { id, everyMs } of askers) {
      if ((next.get(id) ?? Infinity) > now) {
        continue;
      }
      const decision = await budget.take(id);
      if (decision.granted) {
        grants[id] = (grants[id] ?? 0) + 1;
        next.set(id, now + (everyMs ?? 100));
      } else {
        next.set(id, everyMs === undefined ? decision.retryAt.getTime() : now + everyMs);
      }
    }
  }
  return grants;
}

describe('the shared GDELT budget (C81.2, V09)', () => {
  it('gives one environment waiting alone the whole install budget', async () => {
    const { clock, budget } = setup();

    await expect(budget.take('env_one')).resolves.toEqual({ granted: true });
    await expect(budget.take('env_one')).resolves.toEqual({
      granted: false,
      retryAt: new Date(clock.now().getTime() + GDELT_BUDGET.intervalMs),
    });

    clock.advance(GDELT_BUDGET.intervalMs);
    const grants = await simulate(clock, budget, [{ id: 'env_one' }], 60_000);
    // One request per 5 s over a minute: the install budget, all of it to the one environment.
    expect(grants.env_one).toBe(12);
  });

  it('gives two waiting environments half each', async () => {
    const { clock, budget } = setup();

    const both = [{ id: 'env_one' }, { id: 'env_two' }];
    // The first to ask had the budget alone for a moment; measure once both share it.
    await simulate(clock, budget, both, 20_000);
    const grants = await simulate(clock, budget, both, 120_000);

    expect((grants.env_one ?? 0) + (grants.env_two ?? 0)).toBeGreaterThanOrEqual(23);
    expect(grants.env_one).toBeGreaterThanOrEqual(11);
    expect(grants.env_two).toBeGreaterThanOrEqual(11);
    expect(Math.abs((grants.env_one ?? 0) - (grants.env_two ?? 0))).toBeLessThanOrEqual(1);
  });

  it('keeps an environment over its share from taking another’s', async () => {
    const { clock, budget } = setup();

    const grants = await simulate(
      clock,
      budget,
      // Many waiting runs of one environment ask every 100 ms, refused or not.
      [{ id: 'env_busy', everyMs: 100 }, { id: 'env_quiet' }],
      120_000,
    );

    expect(grants.env_quiet).toBeGreaterThanOrEqual(11);
    expect(grants.env_busy).toBeLessThanOrEqual(13);
  });

  it('counts an environment only while it asked in the last 60 s', async () => {
    const { clock, budget } = setup();

    await budget.take('env_one');
    await budget.take('env_two');
    clock.advance(GDELT_BUDGET.activeWindowMs + GDELT_BUDGET.intervalMs);
    await expect(budget.take('env_one')).resolves.toEqual({ granted: true });
    clock.advance(GDELT_BUDGET.intervalMs);
    // env_two has not asked for over a minute: env_one's share is the whole budget again.
    await expect(budget.take('env_one')).resolves.toEqual({ granted: true });
  });

  it('adds jitter to a refusal’s retry time', async () => {
    const clock = fixedClock();
    const budget = createGdeltBudget({
      rateLimiter: gcraLimiter(clock),
      cache: createInMemoryKeyValueCache(clock),
      clock,
      random: () => 0.5,
    });

    await budget.take('env_one');
    await expect(budget.take('env_one')).resolves.toEqual({
      granted: false,
      retryAt: new Date(clock.now().getTime() + GDELT_BUDGET.intervalMs + 500),
    });
  });

  it('grants nothing while Valkey is down: it waits rather than exceed GDELT’s ask', async () => {
    const { clock, cache, budget } = setup();

    cache.failNext(new Error('Valkey is unavailable'));
    await expect(budget.take('env_one')).resolves.toEqual({
      granted: false,
      retryAt: new Date(clock.now().getTime() + GDELT_BUDGET.intervalMs),
    });

    const refusing = createGdeltBudget({
      rateLimiter: { consume: () => Promise.reject(new Error('Valkey is unavailable')) },
      cache,
      clock,
      random: () => 0,
    });
    await expect(refusing.take('env_one')).resolves.toMatchObject({ granted: false });
  });

  it('keeps environment ids and times in Valkey, and the install-wide GCRA under its own rule', async () => {
    const { cache, rateLimiter, budget } = setup();

    await budget.take('env_one');

    for (const key of cache.keys()) {
      expect(key).toMatch(/^openverify:gdelt:(?:askers|share:env_one)$/u);
      const value = (await cache.get(key)) ?? (await cache.listRange(key, 10)).join(',');
      expect(value).toMatch(/^(?:env_one \d+|\d+)$/u);
    }
    expect(rateLimiter.calls).toEqual([
      ['install', { name: 'pacing:gdelt', limit: 1, windowSeconds: 5 }],
    ]);
  });

  it('keeps the budget in this process without Valkey', async () => {
    const clock = fixedClock();
    const budget = createGdeltBudget({ clock, random: () => 0 });

    await expect(budget.take('env_one')).resolves.toEqual({ granted: true });
    await expect(budget.take('env_two')).resolves.toMatchObject({ granted: false });
    clock.advance(GDELT_BUDGET.intervalMs);
    await expect(budget.take('env_two')).resolves.toEqual({ granted: true });
  });
});

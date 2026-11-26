/**
 * C55.7 against a real Valkey (Testcontainers, `valkey/valkey:9.1`), which reads its own clock:
 * each send limit counts and refuses at its size, recovers once its window has passed (a short
 * rule), the guess budget marks a destination until its rule would allow one again, and every
 * limit fails closed when Valkey cannot answer. Keys are synthetic.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCacheRedis, createKeyValueCache } from '../../cache/index.js';
import type { KeyValueCache, RateLimiter } from '../../ports.js';
import {
  closeRateLimitRedis,
  createRateLimiter,
  createRateLimitRedis,
} from '../../rate-limit/index.js';
import {
  consumeOtpSendLimits,
  countWrongCode,
  guessBudgetOutcome,
  type OtpRuleOverrides,
  type OtpSendLimitContext,
} from './limits.js';
import { VALKEY_TEST_IMAGE } from '../../test-support/integration-valkey.js';

const VALKEY_IMAGE = VALKEY_TEST_IMAGE;
/** A rule of one request per two seconds: refused at once, allowed again after the window. */
const SHORT = { limit: 1, windowSeconds: 2 };

let valkey: StartedTestContainer;
let limiterRedis: ReturnType<typeof createRateLimitRedis>;
let cacheRedis: ReturnType<typeof createCacheRedis>;
let limiter: RateLimiter;
let cache: KeyValueCache;
let run = 0;

beforeAll(async () => {
  valkey = await new GenericContainer(VALKEY_IMAGE)
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
  const url = `redis://${valkey.getHost()}:${String(valkey.getMappedPort(6379))}`;
  limiterRedis = createRateLimitRedis(url);
  cacheRedis = createCacheRedis(url);
  limiter = createRateLimiter({ redis: limiterRedis });
  cache = createKeyValueCache({ redis: cacheRedis });
});

afterAll(async () => {
  await closeRateLimitRedis(limiterRedis);
  await closeRateLimitRedis(cacheRedis);
  await valkey.stop();
});

/** A context no other test shares, so each test starts with whole quotas. */
function context(channel: 'sms' | 'email' = 'sms'): OtpSendLimitContext {
  run += 1;
  const id = `${String(Date.now())}${String(run)}`;
  return {
    environmentId: `env_it_${id}`,
    inquiryId: `inq_it_${id}`,
    channel,
    destinationIndex: id.padEnd(64, '0'),
    clientIp: `198.51.100.${String(run % 250)}`,
    ...(channel === 'sms'
      ? {
          sms: {
            e164: `+1202555${String(1000 + run).slice(-4)}`,
            country: 'US',
            multipleCountries: true,
            budgetPerHour: 200,
          },
        }
      : {}),
  };
}

describe('the send limits on Valkey (C55.7)', () => {
  it.each([
    'otp-ip-hour',
    'otp-inquiry-day',
    'otp-destination-hour',
    'otp-destination-day',
    'otp-sms-prefix-hour',
  ] as const)('%s refuses past its size', async (name) => {
    const target = context();
    const overrides: OtpRuleOverrides = { [name]: SHORT };

    expect(await consumeOtpSendLimits(limiter, target, overrides)).toEqual({ allowed: true });
    expect(await consumeOtpSendLimits(limiter, target, overrides)).toMatchObject({
      allowed: false,
      limit: name,
    });
  });

  it('the country share and the budget refuse past their sizes', async () => {
    const share = context();
    const budget = context();
    const one = (target: OtpSendLimitContext, budgetPerHour: number, multipleCountries: boolean) => ({
      ...target,
      sms: { e164: '+12025550100', country: 'US', multipleCountries, budgetPerHour },
    });

    expect(await consumeOtpSendLimits(limiter, one(share, 2, true))).toEqual({ allowed: true });
    expect(await consumeOtpSendLimits(limiter, one(share, 2, true))).toMatchObject({
      allowed: false,
      limit: 'otp-sms-country-hour',
    });
    expect(await consumeOtpSendLimits(limiter, one(budget, 1, false))).toEqual({ allowed: true });
    expect(await consumeOtpSendLimits(limiter, one(budget, 1, false))).toMatchObject({
      allowed: false,
      limit: 'otp-sms-max-per-hour',
    });
  });

  it('recovers once the window has passed, on Valkey’s clock', async () => {
    const target = context('email');
    const overrides: OtpRuleOverrides = { 'otp-destination-hour': SHORT };

    await consumeOtpSendLimits(limiter, target, overrides);
    const refused = await consumeOtpSendLimits(limiter, target, overrides);
    expect(refused).toMatchObject({ allowed: false, limit: 'otp-destination-hour' });
    await sleep(2_100);

    expect(await consumeOtpSendLimits(limiter, target, overrides)).toEqual({ allowed: true });
  });
});

describe('the guess budget on Valkey (C55.5)', () => {
  it('marks the destination once it refuses, until the rule would allow one again', async () => {
    const { destinationIndex } = context();
    const overrides: OtpRuleOverrides = { 'otp-destination-guess-day': SHORT };

    expect(await countWrongCode(limiter, cache, destinationIndex, new Date(), overrides)).toEqual(
      { allowed: true },
    );
    expect(
      await countWrongCode(limiter, cache, destinationIndex, new Date(), overrides),
    ).toMatchObject({ allowed: false, reason: 'guess' });
    expect(await guessBudgetOutcome(cache, destinationIndex, new Date())).toMatchObject({
      allowed: false,
      reason: 'guess',
    });
    await sleep(2_100);

    expect(await guessBudgetOutcome(cache, destinationIndex, new Date())).toEqual({
      allowed: true,
    });
  });
});

describe('fail closed (C55.7)', () => {
  it('refuses every send and confirm when Valkey cannot answer', async () => {
    const down = createRateLimitRedis('redis://127.0.0.1:1');
    const downCacheRedis = createCacheRedis('redis://127.0.0.1:1');
    const downCache = createKeyValueCache({ redis: downCacheRedis });
    const downLimiter = createRateLimiter({ redis: down });

    expect(await consumeOtpSendLimits(downLimiter, context())).toEqual({
      allowed: false,
      storeUnavailable: true,
    });
    expect(await guessBudgetOutcome(downCache, context().destinationIndex, new Date())).toEqual({
      allowed: false,
      storeUnavailable: true,
    });
    await closeRateLimitRedis(down);
    await closeRateLimitRedis(downCacheRedis);
  });
});

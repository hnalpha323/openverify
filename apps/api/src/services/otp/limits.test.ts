/**
 * C55.5, C55.7: the OTP limits as rules the GCRA limiter counts, in their order, with their keys
 * and sizes; the first refusal stops the rest and names the reason the verification records; a
 * limit store that cannot answer refuses (fail closed); the guess budget marks a destination once
 * it trips. The limiter here is a recording fake: the rules against real Valkey are in
 * `limits.integration.test.ts`.
 */
import { OTP_LIMITS } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import type { RateLimitDecision, RateLimiter, RateLimitRule } from '../../ports.js';
import { createInMemoryKeyValueCache, fixedClock } from '../../test-support/fakes.js';
import {
  consumeOtpSendLimits,
  countWrongCode,
  guessBudgetOutcome,
  otpClientKey,
  type OtpSendLimitContext,
} from './limits.js';

const INDEX = 'd'.repeat(64);

/** Records every consume; refuses the rules `refuse` names with the key it is given. */
function limiter(
  options: { refuse?: (rule: RateLimitRule, key: string) => boolean; down?: boolean } = {},
) {
  const calls: { key: string; rule: RateLimitRule }[] = [];
  const fake: RateLimiter = {
    consume(key, rule) {
      calls.push({ key, rule: { ...rule } });
      if (options.down === true) {
        return Promise.reject(new Error('Valkey is unavailable (reconnecting)'));
      }
      const allowed = options.refuse?.(rule, key) !== true;
      const decision: RateLimitDecision = {
        allowed,
        limit: rule.limit,
        remaining: allowed ? 1 : 0,
        resetAt: new Date(0),
        retryAfterSeconds: allowed ? 0 : 75,
      };
      return Promise.resolve(decision);
    },
  };
  return { calls, fake };
}

const SMS: OtpSendLimitContext = {
  environmentId: 'env_limits',
  inquiryId: 'inq_limits',
  channel: 'sms',
  destinationIndex: INDEX,
  clientIp: '203.0.113.7',
  sms: { e164: '+12025550100', country: 'US', multipleCountries: true, budgetPerHour: 200 },
};

describe('otpClientKey (C55.7, P10)', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['2001:db8:1:2:3:4:5:6', '2001:db8:1:2::/64'],
    ['2001:DB8:1:2::9', '2001:db8:1:2::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['fe80::1%eth0', 'fe80:0:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
  ])('keys %s on %s', (ip, key) => {
    expect(otpClientKey(ip)).toBe(key);
  });

  it('keys anything else as it is', () => {
    expect(otpClientKey('not-an-address')).toBe('not-an-address');
  });
});

describe('consumeOtpSendLimits (C55.7)', () => {
  it('counts an SMS send per address, inquiry, destination, prefix, country and budget, in that order', async () => {
    const { calls, fake } = limiter();

    expect(await consumeOtpSendLimits(fake, SMS)).toEqual({ allowed: true });

    expect(calls.map(({ rule }) => [rule.name, rule.limit, rule.windowSeconds])).toEqual([
      ['otp-ip-hour', 10, 3600],
      ['otp-inquiry-day', 10, 86_400],
      ['otp-destination-hour', 5, 3600],
      ['otp-destination-day', 10, 86_400],
      ['otp-sms-prefix-hour', 20, 3600],
      ['otp-sms-country-hour', 100, 3600],
      ['otp-sms-max-per-hour', 200, 3600],
    ]);
    const keys = calls.map(({ key }) => key);
    expect(keys).toEqual([
      'env_limits|ip|203.0.113.7',
      'env_limits|inquiry|inq_limits',
      `env_limits|destination|${INDEX}`,
      `env_limits|destination|${INDEX}`,
      'env_limits|prefix|12025550',
      'env_limits|country|US',
      'env_limits|budget',
    ]);
    expect(keys.join(' ')).not.toContain('+12025550100');
  });

  it('applies the country share only when the step allows more than one country', async () => {
    const { calls, fake } = limiter();

    await consumeOtpSendLimits(fake, {
      ...SMS,
      sms: { e164: '+12025550100', country: 'US', multipleCountries: false, budgetPerHour: 3 },
    });

    expect(calls.map(({ key, rule }) => [key, rule.limit])).toContainEqual(['env_limits|budget', 3]);
    expect(calls.some(({ key }) => key.includes('|country|'))).toBe(false);
  });

  it('keeps at least one send of a one-send budget for the country share', async () => {
    const { calls, fake } = limiter();

    await consumeOtpSendLimits(fake, {
      ...SMS,
      sms: { e164: '+12025550100', country: 'US', multipleCountries: true, budgetPerHour: 1 },
    });

    expect(calls.find(({ key }) => key.endsWith('|country|US'))?.rule.limit).toBe(1);
  });

  it('counts an email send per address, inquiry and destination only', async () => {
    const { calls, fake } = limiter();
    const email: OtpSendLimitContext = {
      environmentId: SMS.environmentId,
      inquiryId: SMS.inquiryId,
      channel: 'email',
      destinationIndex: INDEX,
      clientIp: SMS.clientIp,
    };

    await consumeOtpSendLimits(fake, email);

    expect(calls.map(({ rule }) => rule.name)).toEqual([
      'otp-ip-hour',
      'otp-inquiry-day',
      'otp-destination-hour',
      'otp-destination-day',
    ]);
  });

  it.each([
    ['otp-ip-hour', null],
    ['otp-inquiry-day', 'inquiry'],
    ['otp-destination-hour', 'destination'],
    ['otp-destination-day', 'destination'],
    ['otp-sms-prefix-hour', 'destination'],
  ] as const)('stops at a refusal by %s, recorded as %s', async (name, reason) => {
    const { calls, fake } = limiter({ refuse: (rule) => rule.name === name });

    const outcome = await consumeOtpSendLimits(fake, SMS);

    expect(outcome).toEqual({ allowed: false, limit: name, reason, retryAfterSeconds: 75 });
    expect(calls.at(-1)?.rule.name).toBe(name);
  });

  it('names the country share and the budget, recorded as environment refusals', async () => {
    const country = limiter({ refuse: (_rule, key) => key.includes('|country|') });
    const budget = limiter({ refuse: (_rule, key) => key.endsWith('|budget') });

    expect(await consumeOtpSendLimits(country.fake, SMS)).toEqual({
      allowed: false,
      limit: 'otp-sms-country-hour',
      reason: 'environment',
      retryAfterSeconds: 75,
    });
    expect(await consumeOtpSendLimits(budget.fake, SMS)).toEqual({
      allowed: false,
      limit: 'otp-sms-max-per-hour',
      reason: 'environment',
      retryAfterSeconds: 75,
    });
  });

  it('fails closed when the limit store cannot answer', async () => {
    const { fake } = limiter({ down: true });

    expect(await consumeOtpSendLimits(fake, SMS)).toEqual({
      allowed: false,
      storeUnavailable: true,
    });
  });

  it('takes other rule sizes for a test', async () => {
    const { calls, fake } = limiter();

    await consumeOtpSendLimits(fake, SMS, {
      'otp-destination-hour': { limit: 1, windowSeconds: 2 },
    });

    expect(calls.find(({ rule }) => rule.name === 'otp-destination-hour')?.rule).toEqual({
      name: 'otp-destination-hour',
      limit: 1,
      windowSeconds: 2,
    });
  });
});

describe('the destination guess budget (C55.5)', () => {
  it('counts each wrong code per destination and marks it once the budget refuses', async () => {
    const clock = fixedClock();
    const cache = createInMemoryKeyValueCache(clock);
    const allowing = limiter();
    const refusing = limiter({ refuse: () => true });

    expect(await countWrongCode(allowing.fake, cache, INDEX, clock.now())).toEqual({
      allowed: true,
    });
    expect(allowing.calls).toEqual([
      {
        key: `guess|${INDEX}`,
        rule: {
          name: 'otp-destination-guess-day',
          limit: OTP_LIMITS['otp-destination-guess-day'].limit,
          windowSeconds: 86_400,
        },
      },
    ]);
    expect(await guessBudgetOutcome(cache, INDEX, clock.now())).toEqual({ allowed: true });

    expect(await countWrongCode(refusing.fake, cache, INDEX, clock.now())).toEqual({
      allowed: false,
      limit: 'otp-destination-guess-day',
      reason: 'guess',
      retryAfterSeconds: 75,
    });
    clock.advance(30_000);
    expect(await guessBudgetOutcome(cache, INDEX, clock.now())).toEqual({
      allowed: false,
      limit: 'otp-destination-guess-day',
      reason: 'guess',
      retryAfterSeconds: 45,
    });
    expect(await guessBudgetOutcome(cache, 'e'.repeat(64), clock.now())).toEqual({
      allowed: true,
    });
    clock.advance(45_000);
    expect(await guessBudgetOutcome(cache, INDEX, clock.now())).toEqual({ allowed: true });
    expect(cache.keys().join(' ')).not.toContain('2025550100');
  });

  it('fails closed when the store cannot answer', async () => {
    const clock = fixedClock();
    const cache = createInMemoryKeyValueCache(clock);
    cache.failNext(new Error('Valkey is unavailable (reconnecting)'));

    expect(await guessBudgetOutcome(cache, INDEX, clock.now())).toEqual({
      allowed: false,
      storeUnavailable: true,
    });
    expect(await countWrongCode(limiter({ down: true }).fake, cache, INDEX, clock.now())).toEqual(
      { allowed: false, storeUnavailable: true },
    );
  });
});

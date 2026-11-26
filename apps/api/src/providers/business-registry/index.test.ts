/**
 * C61.1, C63: the registers a binding names are built in the binding's order, each with its
 * credential for the environment kind, over one pacer and one query cache shared through the
 * Valkey cache; the sandbox register is the documented one. Answers come from `MockAgent`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { RateLimiter } from '../../ports.js';
import { createInMemoryKeyValueCache, fixedClock } from '../../test-support/fakes.js';
import { COMPANIES_HOUSE_BASE_URLS } from './companies-house.js';
import { createBusinessRegistryProviders, createSandboxBusinessRegistryProvider } from './index.js';
import { createMockOutbound, jsonHeaders, type MockOutbound } from './testing.js';

let outbound: MockOutbound | undefined;

afterEach(async () => {
  await outbound?.close();
  outbound = undefined;
});

const LIVE_KEY = 'synthetic-companies-house-key-0001';
const TEST_KEY = 'synthetic-companies-house-key-0002';
const SETTINGS = {
  companiesHouse: { apiKey: LIVE_KEY, sandboxApiKey: TEST_KEY },
  secEdgar: { userAgent: 'Utopia Synthetic Compliance admin@example.test' },
};

/** A GCRA limiter that allows every request, recording each rule it is asked for. */
function allowingLimiter() {
  const names: string[] = [];
  const limiter: RateLimiter = {
    consume: (_key, rule) => {
      names.push(rule.name);
      return Promise.resolve({
        allowed: true,
        limit: rule.limit,
        remaining: 0,
        resetAt: new Date(0),
        retryAfterSeconds: 0,
      });
    },
  };
  return { limiter, names };
}

describe('createBusinessRegistryProviders (C61.1)', () => {
  it('paces the registers through the GCRA limiter when one is bound, not the cache slots (Workflow 5C review K4)', async () => {
    const clock = fixedClock();
    const cache = createInMemoryKeyValueCache(clock);
    const { limiter, names } = allowingLimiter();
    outbound = createMockOutbound();
    outbound.agent
      .get('https://api.gleif.org')
      .intercept({ path: (path) => path.startsWith('/api/v1/lei-records?'), method: 'GET' })
      .reply(200, { data: [] }, jsonHeaders('application/vnd.api+json'));
    const [gleif] = createBusinessRegistryProviders(['gleif'], {
      environment: 'production',
      outboundHttp: outbound,
      cache,
      rateLimiter: limiter,
      clock,
    });

    await gleif?.lookup({ country: 'GB', businessName: 'Utopia Synthetic' });

    expect(names).toEqual(['pacing:gleif']);
    expect(cache.keys().some((key) => key.startsWith('openverify:pacing:'))).toBe(false);
  });

  it('builds the registers a binding names, in its order', () => {
    const registers = createBusinessRegistryProviders(['companies-house', 'gleif', 'sec-edgar'], {
      environment: 'production',
      ...SETTINGS,
    });

    expect(registers.map((register) => [register.id, register.source, register.sandbox])).toEqual([
      ['companies-house', 'companies-house', false],
      ['gleif', 'gleif', false],
      ['sec-edgar', 'sec-edgar', false],
    ]);
  });

  it('gives Companies House the key and host of the environment kind', async () => {
    outbound = createMockOutbound();
    outbound.agent
      .get(COMPANIES_HOUSE_BASE_URLS.sandbox)
      .intercept({ path: '/company/01234567', method: 'GET' })
      .reply(404, '');
    const [house] = createBusinessRegistryProviders(['companies-house'], {
      environment: 'sandbox',
      ...SETTINGS,
      outboundHttp: outbound,
    });

    expect(
      await house?.lookup({ country: 'GB', businessName: 'x', registrationNumber: '01234567' }),
    ).toEqual({ outcome: 'not_found', authoritative: true });
    expect(outbound.requests[0]?.request.headers?.authorization).toBe(
      `Basic ${Buffer.from(`${TEST_KEY}:`).toString('base64')}`,
    );
  });

  it('asks GLEIF through the outbound client and remembers its answer in the shared cache', async () => {
    const clock = fixedClock();
    const cache = createInMemoryKeyValueCache(clock);
    outbound = createMockOutbound();
    outbound.agent
      .get('https://api.gleif.org')
      .intercept({ path: (path) => path.startsWith('/api/v1/lei-records?'), method: 'GET' })
      .reply(200, { data: [] }, jsonHeaders('application/vnd.api+json'));
    const [gleif] = createBusinessRegistryProviders(['gleif'], {
      environment: 'production',
      outboundHttp: outbound,
      cache,
      clock,
    });

    expect(await gleif?.lookup({ country: 'GB', businessName: 'Utopia Synthetic' })).toEqual({
      outcome: 'not_found',
      authoritative: false,
    });
    expect(cache.keys().some((key) => key.startsWith('openverify:kyb-registry:gleif:'))).toBe(true);
    expect(cache.keys().some((key) => key.startsWith('openverify:pacing:gleif:'))).toBe(true);
  });

  it('builds the sandbox register of C61.6', async () => {
    const sandbox = createSandboxBusinessRegistryProvider();

    expect(sandbox).toMatchObject({ id: 'sandbox', sandbox: true });
    expect(
      await sandbox.lookup({ country: 'GB', businessName: 'x', registrationNumber: '12349999' }),
    ).toEqual({ outcome: 'not_found', authoritative: true });
  });
});

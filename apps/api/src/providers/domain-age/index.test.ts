/**
 * C61.4, C63: the domain age factory builds the RDAP client (its pacing shared through the cache) or
 * the sandbox provider, each constructed at once.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { RateLimiter } from '../../ports.js';
import { createInMemoryKeyValueCache, fixedClock } from '../../test-support/fakes.js';
import {
  createMockOutbound,
  jsonHeaders,
  type MockOutbound,
} from '../business-registry/testing.js';
import { createDomainAgeProvider } from './index.js';

let outbound: MockOutbound | undefined;

afterEach(async () => {
  await outbound?.close();
  outbound = undefined;
});

describe('createDomainAgeProvider (C61.4)', () => {
  it('builds the RDAP client over the outbound client, pacing through the cache', async () => {
    const clock = fixedClock();
    const cache = createInMemoryKeyValueCache(clock);
    outbound = createMockOutbound();
    outbound.agent
      .get('https://data.iana.org')
      .intercept({ path: '/rdap/dns.json', method: 'GET' })
      .reply(
        200,
        { services: [[['example'], ['https://rdap.registry-one.example.test/']]] },
        jsonHeaders(),
      );
    outbound.agent
      .get('https://rdap.registry-one.example.test')
      .intercept({ path: '/domain/utopia.example', method: 'GET' })
      .reply(404, '');
    const rdap = createDomainAgeProvider('rdap', { outboundHttp: outbound, cache, clock });

    expect(rdap).toMatchObject({ id: 'rdap', sandbox: false });
    expect(await rdap.age({ host: 'utopia.example' })).toEqual({
      outcome: 'unavailable',
      reason: 'not_found',
    });
    expect(cache.keys().some((key) => key.startsWith('openverify:pacing:rdap:'))).toBe(true);
  });

  it('paces each RDAP host through the GCRA limiter when one is bound (Workflow 5C review K4)', async () => {
    const clock = fixedClock();
    const cache = createInMemoryKeyValueCache(clock);
    const names: string[] = [];
    const rateLimiter: RateLimiter = {
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
    outbound = createMockOutbound();
    outbound.agent
      .get('https://data.iana.org')
      .intercept({ path: '/rdap/dns.json', method: 'GET' })
      .reply(
        200,
        { services: [[['example'], ['https://rdap.registry-one.example.test/']]] },
        jsonHeaders(),
      );
    outbound.agent
      .get('https://rdap.registry-one.example.test')
      .intercept({ path: '/domain/utopia.example', method: 'GET' })
      .reply(404, '');
    const rdap = createDomainAgeProvider('rdap', {
      outboundHttp: outbound,
      cache,
      rateLimiter,
      clock,
    });

    await rdap.age({ host: 'utopia.example' });

    expect(names).toEqual(['pacing:rdap']);
    expect(cache.keys().some((key) => key.startsWith('openverify:pacing:'))).toBe(false);
  });

  it('builds the sandbox provider on the given clock', async () => {
    const sandbox = createDomainAgeProvider('sandbox', {
      clock: fixedClock(new Date('2026-10-24T00:00:00.000Z')),
    });

    expect(sandbox).toMatchObject({ id: 'sandbox', sandbox: true });
    expect(await sandbox.age({ host: 'new.example' })).toMatchObject({
      registeredAt: new Date('2026-10-21T00:00:00.000Z'),
    });
  });
});

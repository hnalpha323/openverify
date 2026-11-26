/**
 * C85.3: RDAP's `registered-domain` mode for email domains, over the C61.4 client and the C61.6
 * sandbox. An email domain is personal data (P15), so this mode keeps no date in Valkey: a hit
 * there would tell one tenant that another looked the domain up, and a SHA-256 of a domain is
 * reversed by guessing (Stage 1a amendment 4). Dates are kept in memory, per environment, for a
 * day. Every name is reserved (RFC 2606, RFC 6761) or fictional.
 */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createAllowAllRateLimiter,
  createInMemoryKeyValueCache,
  fixedClock,
} from '../../test-support/fakes.js';
import {
  createMockOutbound,
  jsonHeaders,
  type MockOutbound,
} from '../business-registry/testing.js';
import { RDAP_DATE_TTL_SECONDS } from './rdap.js';
import { createRegisteredDomainAgeProvider } from './registered-domain.js';

const REGISTRY = 'https://rdap.registry-one.example.test';
const BOOTSTRAP = {
  description: 'Synthetic RDAP bootstrap file',
  publication: '2026-09-30T19:00:01Z',
  services: [[['example', 'test'], [`${REGISTRY}/v1/`]]],
  version: '1.0',
};
const RDAP = jsonHeaders('application/rdap+json');
const REGISTERED = '2004-05-06T07:08:09Z';

function domainAnswer(name: string) {
  return {
    objectClassName: 'domain',
    ldhName: name,
    events: [{ eventAction: 'registration', eventDate: REGISTERED }],
  };
}

let outbound: MockOutbound | undefined;

afterEach(async () => {
  await outbound?.close();
  outbound = undefined;
});

function rdap() {
  outbound = createMockOutbound();
  const clock = fixedClock();
  const cache = createInMemoryKeyValueCache(clock);
  const iana = outbound.agent.get('https://data.iana.org');
  iana
    .intercept({ path: '/rdap/dns.json', method: 'GET' })
    .reply(200, BOOTSTRAP, jsonHeaders('application/json'))
    // A day later the bootstrap has expired too, and is fetched again.
    .persist();
  return {
    clock,
    cache,
    outbound,
    registry: outbound.agent.get(REGISTRY),
    mode: createRegisteredDomainAgeProvider('rdap', {
      outboundHttp: outbound,
      cache,
      // The GCRA limiter paces each RDAP host; this one allows every turn.
      rateLimiter: createAllowAllRateLimiter(clock),
      clock,
    }),
  };
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

describe('the registered-domain mode over RDAP (C85.3)', () => {
  it('answers for the domain itself, unflagged', async () => {
    const { registry, mode } = rdap();
    registry
      .intercept({ path: '/v1/domain/synthetic-owner.example', method: 'GET' })
      .reply(200, domainAnswer('synthetic-owner.example'), RDAP);

    await expect(mode.registeredDomainAge({ domain: 'synthetic-owner.example' })).resolves.toEqual({
      outcome: 'registered',
      registeredAt: new Date(REGISTERED),
      domain: 'synthetic-owner.example',
      subdomain: false,
    });
    expect(mode).toMatchObject({ id: 'rdap', sandbox: false });
  });

  it('answers a mail subdomain for its registered domain, flagged', async () => {
    const { registry, mode, outbound: requests } = rdap();
    registry
      .intercept({ path: '/v1/domain/mail.synthetic-owner.example', method: 'GET' })
      .reply(404, '')
      .times(2);
    registry
      .intercept({ path: '/v1/domain/synthetic-owner.example', method: 'GET' })
      .reply(200, domainAnswer('synthetic-owner.example'), RDAP)
      .times(2);

    await expect(
      mode.registeredDomainAge({ domain: 'mail.synthetic-owner.example' }),
    ).resolves.toMatchObject({
      outcome: 'registered',
      domain: 'synthetic-owner.example',
      subdomain: true,
    });
    // The C61.4 client itself refuses a shorter name's date, so the mode asks that name again.
    expect(requests.requests.map(({ request }) => new URL(request.url).pathname)).toEqual([
      '/rdap/dns.json',
      '/v1/domain/mail.synthetic-owner.example',
      '/v1/domain/synthetic-owner.example',
      '/v1/domain/synthetic-owner.example',
    ]);
  });

  it('passes on an answer that is no date: not found, no service, no registration date', async () => {
    const { registry, mode } = rdap();
    registry.intercept({ path: '/v1/domain/absent-owner.example', method: 'GET' }).reply(404, '');

    await expect(mode.registeredDomainAge({ domain: 'absent-owner.example' })).resolves.toEqual({
      outcome: 'unavailable',
      reason: 'not_found',
    });
    await expect(mode.registeredDomainAge({ domain: 'synthetic.unlisted' })).resolves.toEqual({
      outcome: 'unavailable',
      reason: 'no_rdap_service',
    });
  });

  it('keeps no email domain’s date in Valkey, only the bootstrap the client shares', async () => {
    const { registry, mode, cache } = rdap();
    registry
      .intercept({ path: '/v1/domain/synthetic-owner.example', method: 'GET' })
      .reply(200, domainAnswer('synthetic-owner.example'), RDAP);

    await mode.registeredDomainAge({ domain: 'synthetic-owner.example', scope: 'env_one' });

    expect(cache.keys()).toEqual(['openverify:rdap:bootstrap']);
    const kept = (await Promise.all(cache.keys().map((key) => cache.get(key)))).join('\n');
    for (const text of cache.keys().concat(kept)) {
      expect(text).not.toContain('synthetic-owner');
      expect(text).not.toContain(sha('synthetic-owner.example'));
    }
  });

  it('keeps a date in memory for its scope only, for a day; without a scope, nothing', async () => {
    const { registry, mode, clock, outbound: requests } = rdap();
    registry
      .intercept({ path: '/v1/domain/synthetic-owner.example', method: 'GET' })
      .reply(200, domainAnswer('synthetic-owner.example'), RDAP)
      .times(4);
    const asked = () =>
      requests.requests.filter(({ request }) => request.url.includes('/v1/domain/')).length;

    await mode.registeredDomainAge({ domain: 'synthetic-owner.example', scope: 'env_one' });
    await mode.registeredDomainAge({ domain: 'synthetic-owner.example', scope: 'env_one' });
    expect(asked()).toBe(1);

    await mode.registeredDomainAge({ domain: 'synthetic-owner.example', scope: 'env_two' });
    expect(asked()).toBe(2);

    await mode.registeredDomainAge({ domain: 'synthetic-owner.example' });
    expect(asked()).toBe(3);

    clock.advance(RDAP_DATE_TTL_SECONDS * 1000);
    await mode.registeredDomainAge({ domain: 'synthetic-owner.example', scope: 'env_one' });
    expect(asked()).toBe(4);
  });

  it('never asks about a known free-mail domain', async () => {
    const { mode, outbound: requests } = rdap();

    await expect(mode.registeredDomainAge({ domain: 'gmail.com' })).rejects.toThrow(RangeError);
    expect(requests.requests).toEqual([]);
  });
});

describe('the registered-domain mode over the sandbox (C61.6)', () => {
  const clock = fixedClock();
  const mode = createRegisteredDomainAgeProvider('sandbox', { clock });

  it('ages the sandbox’s reserved names and their subdomains, flagging those', async () => {
    expect(mode).toMatchObject({ id: 'sandbox', sandbox: true });
    await expect(mode.registeredDomainAge({ domain: 'old.example' })).resolves.toMatchObject({
      outcome: 'registered',
      domain: 'old.example',
      subdomain: false,
    });
    await expect(
      mode.registeredDomainAge({ domain: 'deep.mail.new.example' }),
    ).resolves.toMatchObject({ outcome: 'registered', domain: 'new.example', subdomain: true });
  });

  it('answers anything else as the sandbox does', async () => {
    await expect(mode.registeredDomainAge({ domain: 'other.example' })).resolves.toEqual({
      outcome: 'unavailable',
      reason: 'not_found',
    });
    await expect(mode.registeredDomainAge({ domain: 'nordap.test' })).resolves.toEqual({
      outcome: 'unavailable',
      reason: 'no_rdap_service',
    });
  });
});

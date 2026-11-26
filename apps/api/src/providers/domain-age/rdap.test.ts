/**
 * C61.4: our RDAP client against `MockAgent`, with a synthetic IANA bootstrap and synthetic RDAP
 * answers shaped like RFC 9083's: the TLD's HTTPS service, names trimmed from the left (at most
 * four), a date only for the host or the host without `www.`, a shorter answer as `subdomain`, the
 * bootstrap and the dates kept a day (keys hashed), one request a second per RDAP host, no
 * redirect or registrar link followed, and refusals without the host. Every name is reserved.
 */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createInMemoryKeyValueCache,
  fixedClock,
  type TestClock,
} from '../../test-support/fakes.js';
import type { PacingRule, ProviderPacer } from '../business-registry/pacing.js';
import {
  createMockOutbound,
  jsonHeaders,
  type MockOutbound,
} from '../business-registry/testing.js';
import { ProviderError } from '../errors.js';
import {
  IANA_RDAP_BOOTSTRAP_URL,
  RDAP_BOOTSTRAP_TTL_SECONDS,
  RDAP_DATE_TTL_SECONDS,
  RDAP_MAX_QUERIES,
  RDAP_PACING,
  createRdapDomainAgeProvider,
} from './rdap.js';

const REGISTRY = 'https://rdap.registry-one.example.test';
const BOOTSTRAP = {
  description: 'Synthetic RDAP bootstrap file for Domain Name System registrations',
  publication: '2026-09-30T19:00:01Z',
  services: [
    [['example', 'test'], [`${REGISTRY}/v1/`]],
    [['plain'], ['http://rdap.insecure.example.test/']],
    [['mixed'], ['http://rdap.mixed.example.test/', 'https://rdap.mixed.example.test/']],
  ],
  version: '1.0',
};
const RDAP = jsonHeaders('application/rdap+json');

/** A synthetic RDAP domain answer (RFC 9083). */
function domain(
  name: string,
  events = [{ eventAction: 'registration', eventDate: '2004-05-06T07:08:09Z' }],
) {
  return {
    objectClassName: 'domain',
    handle: 'SYNTHETIC-1',
    ldhName: name,
    events: [...events, { eventAction: 'expiration', eventDate: '2031-05-06T07:08:09Z' }],
    links: [{ rel: 'related', href: `https://rdap.registrar.example.test/domain/${name}` }],
  };
}

let outbound: MockOutbound | undefined;

afterEach(async () => {
  await outbound?.close();
  outbound = undefined;
});

function recordingPacer(): ProviderPacer & { acquired: [PacingRule, string][] } {
  const acquired: [PacingRule, string][] = [];
  return {
    acquired,
    acquire: (rule, key) => {
      acquired.push([rule, key]);
      return Promise.resolve();
    },
  };
}

function provider(
  options: { clock?: TestClock; cache?: ReturnType<typeof createInMemoryKeyValueCache> } = {},
) {
  outbound = createMockOutbound();
  const clock = options.clock ?? fixedClock();
  const cache = options.cache ?? createInMemoryKeyValueCache(clock);
  const pacer = recordingPacer();
  return {
    iana: outbound.agent.get('https://data.iana.org'),
    registry: outbound.agent.get(REGISTRY),
    pacer,
    cache,
    clock,
    outbound,
    rdap: createRdapDomainAgeProvider({ outboundHttp: outbound, cache, clock, pacer }),
  };
}

const answersBootstrap = (iana: ReturnType<typeof provider>['iana']) =>
  iana.intercept({ path: '/rdap/dns.json', method: 'GET' }).reply(200, BOOTSTRAP, jsonHeaders());

const urlsOf = (mock: MockOutbound) => mock.requests.map(({ request }) => request.url);

async function failure(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (!(error instanceof ProviderError)) {
    throw new Error(`expected a ProviderError, got ${String(error)}`);
  }
  expect(error.message).not.toContain('utopia');
  return error;
}

describe('the RDAP domain age provider (C61.4)', () => {
  it('asks the TLD’s service the bootstrap names, and answers the registration date', async () => {
    const { rdap, iana, registry, outbound: mock } = provider();
    answersBootstrap(iana);
    registry
      .intercept({ path: '/v1/domain/utopia-widgets.example', method: 'GET' })
      .reply(200, domain('utopia-widgets.example'), RDAP);

    expect(await rdap.age({ host: 'utopia-widgets.example' })).toEqual({
      outcome: 'registered',
      registeredAt: new Date('2004-05-06T07:08:09Z'),
      domain: 'utopia-widgets.example',
    });
    expect(urlsOf(mock)).toEqual([
      IANA_RDAP_BOOTSTRAP_URL,
      `${REGISTRY}/v1/domain/utopia-widgets.example`,
    ]);
    expect(rdap).toMatchObject({ id: 'rdap', sandbox: false });
    expect(mock.clients).toEqual([
      { name: 'rdap-bootstrap', contentTypes: ['application/json'], timeoutMs: 10_000 },
      {
        name: 'rdap',
        contentTypes: ['application/rdap+json', 'application/json'],
        timeoutMs: 10_000,
      },
    ]);
  });

  it('ages a host by its name without a leading www.', async () => {
    const { rdap, iana, registry } = provider();
    answersBootstrap(iana);
    registry
      .intercept({ path: '/v1/domain/www.utopia-widgets.example', method: 'GET' })
      .reply(404, '');
    registry
      .intercept({ path: '/v1/domain/utopia-widgets.example', method: 'GET' })
      .reply(200, domain('utopia-widgets.example'), RDAP);

    expect(await rdap.age({ host: 'www.utopia-widgets.example' })).toMatchObject({
      outcome: 'registered',
      domain: 'utopia-widgets.example',
    });
  });

  it('never ages a site on a platform’s subdomain by the platform’s date', async () => {
    const { rdap, iana, registry } = provider();
    answersBootstrap(iana);
    registry
      .intercept({ path: '/v1/domain/shop.utopia-widgets.example', method: 'GET' })
      .reply(404, '');
    registry
      .intercept({ path: '/v1/domain/utopia-widgets.example', method: 'GET' })
      .reply(200, domain('utopia-widgets.example'), RDAP);

    expect(await rdap.age({ host: 'shop.utopia-widgets.example' })).toEqual({
      outcome: 'unavailable',
      reason: 'subdomain',
    });
  });

  it('asks at most four names, never the TLD itself, and answers not_found when none answers', async () => {
    const { rdap, iana, registry, outbound: mock } = provider();
    answersBootstrap(iana);
    registry
      .intercept({ path: /^\/v1\/domain\//, method: 'GET' })
      .reply(404, '')
      .persist();

    expect(await rdap.age({ host: 'a.b.c.d.e.utopia.example' })).toEqual({
      outcome: 'unavailable',
      reason: 'not_found',
    });
    expect(RDAP_MAX_QUERIES).toBe(4);
    expect(urlsOf(mock).slice(1)).toEqual([
      `${REGISTRY}/v1/domain/a.b.c.d.e.utopia.example`,
      `${REGISTRY}/v1/domain/b.c.d.e.utopia.example`,
      `${REGISTRY}/v1/domain/c.d.e.utopia.example`,
      `${REGISTRY}/v1/domain/d.e.utopia.example`,
    ]);

    const second = provider();
    answersBootstrap(second.iana);
    second.registry
      .intercept({ path: /^\/v1\/domain\//, method: 'GET' })
      .reply(404, '')
      .persist();
    await second.rdap.age({ host: 'www.utopia.example' });
    expect(urlsOf(second.outbound).slice(1)).toEqual([
      `${REGISTRY}/v1/domain/www.utopia.example`,
      `${REGISTRY}/v1/domain/utopia.example`,
    ]);
  });

  it('answers no_rdap_service for a TLD without an HTTPS service in the bootstrap', async () => {
    const { rdap, iana, outbound: mock } = provider();
    answersBootstrap(iana);

    expect(await rdap.age({ host: 'utopia-widgets.unlisted' })).toEqual({
      outcome: 'unavailable',
      reason: 'no_rdap_service',
    });
    expect(await rdap.age({ host: 'utopia-widgets.plain' })).toEqual({
      outcome: 'unavailable',
      reason: 'no_rdap_service',
    });
    expect(urlsOf(mock)).toEqual([IANA_RDAP_BOOTSTRAP_URL]);
  });

  it('takes the HTTPS service of a TLD that lists an HTTP one beside it', async () => {
    const { rdap, iana, outbound: mock } = provider();
    answersBootstrap(iana);
    mock.agent
      .get('https://rdap.mixed.example.test')
      .intercept({ path: '/domain/utopia.mixed', method: 'GET' })
      .reply(200, domain('utopia.mixed'), RDAP);

    expect(await rdap.age({ host: 'utopia.mixed' })).toMatchObject({ outcome: 'registered' });
  });

  it('answers no_registration_date for a domain whose answer has no registration event', async () => {
    const { rdap, iana, registry } = provider();
    answersBootstrap(iana);
    registry
      .intercept({ path: '/v1/domain/utopia-widgets.example', method: 'GET' })
      .reply(200, domain('utopia-widgets.example', []), RDAP);

    expect(await rdap.age({ host: 'utopia-widgets.example' })).toEqual({
      outcome: 'unavailable',
      reason: 'no_registration_date',
    });
  });

  it('keeps the bootstrap a day, shared through the cache', async () => {
    const clock = fixedClock();
    const cache = createInMemoryKeyValueCache(clock);
    const first = provider({ clock, cache });
    answersBootstrap(first.iana);
    await first.rdap.age({ host: 'utopia.unlisted' });
    await first.outbound.close();

    const second = provider({ clock, cache });
    expect(await second.rdap.age({ host: 'utopia.unlisted' })).toMatchObject({
      reason: 'no_rdap_service',
    });
    expect(second.outbound.requests).toEqual([]);
    expect(cache.keys()).toContain('openverify:rdap:bootstrap');
    expect(RDAP_BOOTSTRAP_TTL_SECONDS).toBe(86_400);

    clock.advance(RDAP_BOOTSTRAP_TTL_SECONDS * 1000 + 1);
    answersBootstrap(second.iana);
    await second.rdap.age({ host: 'utopia.unlisted' });
    expect(urlsOf(second.outbound)).toEqual([IANA_RDAP_BOOTSTRAP_URL]);
  });

  // Workflow 5C review K5 (C61.4): the bootstrap is kept as long as IANA's answer says (its
  // `max-age`, else its `Expires`), within 1 hour to 7 days; a fixed day without either.
  describe('the bootstrap’s lifetime', () => {
    const HOUR = 3_600_000;
    const DAY = 24 * HOUR;
    const httpDate = (at: Date) => at.toUTCString();

    async function lifetimeOf(headers: Record<string, string>): Promise<number> {
      const clock = fixedClock();
      const cache = createInMemoryKeyValueCache(clock);
      const first = provider({ clock, cache });
      first.iana
        .intercept({ path: '/rdap/dns.json', method: 'GET' })
        .reply(200, BOOTSTRAP, { headers: { 'content-type': 'application/json', ...headers } });
      await first.rdap.age({ host: 'utopia.unlisted' });
      await first.outbound.close();
      const started = clock.now().getTime();
      // Another worker reads the bootstrap from Valkey until it expires there.
      for (let step = 1; step <= 8 * 24 * 4; step += 1) {
        clock.advance(HOUR / 4);
        const next = provider({ clock, cache });
        next.iana
          .intercept({ path: '/rdap/dns.json', method: 'GET' })
          .reply(200, BOOTSTRAP, jsonHeaders());
        await next.rdap.age({ host: 'utopia.unlisted' });
        if (next.outbound.requests.length > 0) {
          // afterEach closes this last one.
          return clock.now().getTime() - started;
        }
        await next.outbound.close();
      }
      throw new Error('the bootstrap never expired');
    }

    it.each([
      [
        'Expires in two days',
        (now: Date) => ({ expires: httpDate(new Date(now.getTime() + 2 * DAY)) }),
        2 * DAY,
      ],
      [
        'max-age of 30 hours, before Expires',
        (now: Date) => ({
          'cache-control': 'public, max-age=108000',
          expires: httpDate(new Date(now.getTime() + 5 * DAY)),
        }),
        30 * HOUR,
      ],
      [
        'Expires in a month, kept 7 days',
        (now: Date) => ({ expires: httpDate(new Date(now.getTime() + 30 * DAY)) }),
        7 * DAY,
      ],
      [
        'Expires in ten minutes, kept an hour',
        (now: Date) => ({ expires: httpDate(new Date(now.getTime() + 600_000)) }),
        HOUR,
      ],
      [
        'Expires already past, kept an hour',
        (now: Date) => ({ expires: httpDate(new Date(now.getTime() - DAY)) }),
        HOUR,
      ],
      ['a malformed Expires, kept a day', () => ({ expires: 'soon' }), DAY],
      ['neither, kept a day', () => ({}), DAY],
    ])('%s', async (_label, headersAt, lifetime) => {
      const measured = await lifetimeOf(headersAt(fixedClock().now()));
      // Measured in quarter hours: the first quarter hour at or past the lifetime refetches.
      expect(measured).toBeGreaterThanOrEqual(lifetime);
      expect(measured).toBeLessThan(lifetime + HOUR / 4);
    });

    it('refetches in the same worker once the lifetime has passed', async () => {
      const clock = fixedClock();
      const { iana, rdap, outbound: mock } = provider({ clock });
      iana.intercept({ path: '/rdap/dns.json', method: 'GET' }).reply(200, BOOTSTRAP, {
        headers: {
          'content-type': 'application/json',
          expires: httpDate(new Date(clock.now().getTime() + 2 * HOUR)),
        },
      });
      await rdap.age({ host: 'utopia.unlisted' });
      clock.advance(2 * HOUR - 1000);
      await rdap.age({ host: 'utopia.unlisted' });
      expect(mock.requests).toHaveLength(1);

      clock.advance(2000);
      answersBootstrap(iana);
      await rdap.age({ host: 'utopia.unlisted' });
      expect(mock.requests).toHaveLength(2);
    });
  });

  it('keeps a registration date a day under a SHA-256 of the domain, asking nothing again', async () => {
    const clock = fixedClock();
    const cache = createInMemoryKeyValueCache(clock);
    const first = provider({ clock, cache });
    answersBootstrap(first.iana);
    first.registry
      .intercept({ path: '/v1/domain/utopia-widgets.example', method: 'GET' })
      .reply(200, domain('utopia-widgets.example'), RDAP);
    await first.rdap.age({ host: 'utopia-widgets.example' });
    await first.outbound.close();

    const second = provider({ clock, cache });
    expect(await second.rdap.age({ host: 'www.utopia-widgets.example' })).toEqual({
      outcome: 'registered',
      registeredAt: new Date('2004-05-06T07:08:09Z'),
      domain: 'utopia-widgets.example',
    });
    expect(second.outbound.requests).toEqual([]);
    const digest = createHash('sha256').update('utopia-widgets.example').digest('hex');
    expect(cache.keys()).toContain(`openverify:rdap:date:${digest}`);
    const stored = await cache.get(`openverify:rdap:date:${digest}`);
    expect(stored).not.toContain('utopia');
    expect(cache.keys().join()).not.toContain('utopia');
    expect(RDAP_DATE_TTL_SECONDS).toBe(86_400);
  });

  it('paces each registry query at one a second per RDAP host', async () => {
    const { rdap, iana, registry, pacer } = provider();
    answersBootstrap(iana);
    registry.intercept({ path: '/v1/domain/shop.utopia.example', method: 'GET' }).reply(404, '');
    registry
      .intercept({ path: '/v1/domain/utopia.example', method: 'GET' })
      .reply(200, domain('utopia.example'), RDAP);

    await rdap.age({ host: 'shop.utopia.example' });

    expect(RDAP_PACING).toEqual({ name: 'rdap', intervalMs: 1000 });
    expect(pacer.acquired).toEqual([
      [RDAP_PACING, 'rdap.registry-one.example.test'],
      [RDAP_PACING, 'rdap.registry-one.example.test'],
    ]);
  });

  it('retries a 429, refuses a redirect without following it, and refuses a malformed bootstrap', async () => {
    const { rdap, iana, registry, outbound: mock } = provider();
    answersBootstrap(iana);
    registry.intercept({ path: '/v1/domain/utopia-widgets.example', method: 'GET' }).reply(429, '');
    registry
      .intercept({ path: '/v1/domain/utopia-widgets.example', method: 'GET' })
      .reply(302, '', { headers: { location: 'https://rdap.registrar.example.test/' } });

    expect(await failure(rdap.age({ host: 'utopia-widgets.example' }))).toMatchObject({
      code: 'rdap_rate_limited',
      retryable: true,
    });
    expect(await failure(rdap.age({ host: 'utopia-widgets.example' }))).toMatchObject({
      code: 'rdap_redirect',
      retryable: false,
    });
    expect(urlsOf(mock).filter((url) => url.includes('registrar'))).toEqual([]);

    const broken = provider();
    broken.iana
      .intercept({ path: '/rdap/dns.json', method: 'GET' })
      .reply(200, { services: 'none' }, jsonHeaders());
    expect(await failure(broken.rdap.age({ host: 'utopia-widgets.example' }))).toMatchObject({
      code: 'rdap_malformed',
      retryable: false,
    });
  });

  it('refuses to age without an outbound client', async () => {
    const rdap = createRdapDomainAgeProvider({ pacer: recordingPacer() });

    expect(await failure(rdap.age({ host: 'utopia-widgets.example' }))).toMatchObject({
      code: 'rdap_not_configured',
      retryable: false,
    });
  });
});

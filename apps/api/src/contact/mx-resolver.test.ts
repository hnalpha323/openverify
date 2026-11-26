/**
 * C56: the MX lookup over the worker's resolver: MX records (exchange names not kept), the
 * implicit MX on NODATA (A and AAAA counted), NXDOMAIN, and a failure a retry may cure thrown;
 * answers cached in Valkey 1 h when the domain takes mail and 5 min when it does not, keyed by the
 * domain's SHA-256 and holding no host name. Zones are synthetic, no query leaves the process.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DnsResolverError } from '../dns/index.js';
import {
  createFakeDnsResolver,
  createInMemoryKeyValueCache,
  fixedClock,
} from '../test-support/fakes.js';
import { createMxResolver, MX_CACHE_SECONDS } from './mx-resolver.js';

const keyOf = (domain: string) =>
  `openverify:mx:${createHash('sha256').update(domain, 'utf8').digest('hex')}`;

const ZONES = {
  'mail.example.org': {
    mx: [
      { exchange: 'mx1.mail.example.org', priority: 10 },
      { exchange: 'mx2.mail.example.org', priority: 20 },
    ],
  },
  'nullmx.example.org': { mx: [{ exchange: '', priority: 0 }] },
  'dotmx.example.org': { mx: [{ exchange: '.', priority: 0 }] },
  'implicit.example.org': { a: ['192.0.2.1', '192.0.2.2'], aaaa: ['2001:db8::1'] },
  'bare.example.org': {},
  'slow.example.org': new DnsResolverError('timeout'),
  'v6only.example.org': { aaaa: ['2001:db8::7'] },
};

describe('MxResolver (C56)', () => {
  it('reads MX records without keeping the exchange names', async () => {
    const resolver = createMxResolver({ dns: createFakeDnsResolver(ZONES) });

    expect(await resolver.lookup('mail.example.org')).toEqual({
      kind: 'mx',
      exchanges: ['exchange', 'exchange'],
    });
    expect(await resolver.lookup('nullmx.example.org')).toEqual({ kind: 'mx', exchanges: [''] });
    expect(await resolver.lookup('dotmx.example.org')).toEqual({ kind: 'mx', exchanges: [''] });
  });

  it('falls back to the domain’s own addresses on NODATA (RFC 5321 §5.1)', async () => {
    const dns = createFakeDnsResolver(ZONES);
    const resolver = createMxResolver({ dns });

    expect(await resolver.lookup('implicit.example.org')).toEqual({
      kind: 'no_mx',
      addressRecords: 3,
    });
    expect(await resolver.lookup('v6only.example.org')).toEqual({
      kind: 'no_mx',
      addressRecords: 1,
    });
    expect(await resolver.lookup('bare.example.org')).toEqual({ kind: 'no_mx', addressRecords: 0 });
    expect(dns.queries.filter((query) => query.hostname === 'implicit.example.org')).toEqual([
      { type: 'mx', hostname: 'implicit.example.org' },
      { type: 'a', hostname: 'implicit.example.org' },
      { type: 'aaaa', hostname: 'implicit.example.org' },
    ]);
  });

  it('answers NXDOMAIN as not_found and throws a failure a retry may cure', async () => {
    const resolver = createMxResolver({ dns: createFakeDnsResolver(ZONES) });

    expect(await resolver.lookup('missing.example.org')).toEqual({ kind: 'not_found' });
    await expect(resolver.lookup('slow.example.org')).rejects.toMatchObject({
      name: 'DnsResolverError',
      code: 'timeout',
      retryable: true,
    });
  });

  it('caches an answer 1 h when the domain takes mail, keyed by its SHA-256, without host names', async () => {
    const clock = fixedClock();
    const cache = createInMemoryKeyValueCache(clock);
    const dns = createFakeDnsResolver(ZONES);
    const resolver = createMxResolver({ dns, cache });

    await resolver.lookup('mail.example.org');
    await resolver.lookup('mail.example.org');
    clock.advance(MX_CACHE_SECONDS.positive * 1000);
    await resolver.lookup('mail.example.org');

    expect(dns.queries.filter((query) => query.type === 'mx')).toHaveLength(2);
    expect(cache.keys()).toEqual([keyOf('mail.example.org')]);
    expect(await cache.get(keyOf('mail.example.org'))).not.toContain('example');
  });

  it('caches an answer 5 min when the domain takes no mail, and never a failure', async () => {
    const clock = fixedClock();
    const cache = createInMemoryKeyValueCache(clock);
    const dns = createFakeDnsResolver(ZONES);
    const resolver = createMxResolver({ dns, cache });

    for (const domain of ['missing.example.org', 'nullmx.example.org', 'bare.example.org']) {
      await resolver.lookup(domain);
      clock.advance((MX_CACHE_SECONDS.negative - 1) * 1000);
      await resolver.lookup(domain);
      clock.advance(1000);
      await resolver.lookup(domain);
      expect(
        dns.queries.filter((query) => query.hostname === domain && query.type === 'mx'),
      ).toHaveLength(2);
    }
    await resolver.lookup('slow.example.org').catch(() => undefined);
    expect(cache.keys()).not.toContain(keyOf('slow.example.org'));
  });

  it('asks DNS when the cache cannot answer, and answers when it cannot store', async () => {
    const clock = fixedClock();
    const cache = createInMemoryKeyValueCache(clock);
    const dns = createFakeDnsResolver(ZONES);
    const resolver = createMxResolver({ dns, cache });

    cache.failNext(new Error('Valkey is unavailable (reconnecting)'));
    expect(await resolver.lookup('mail.example.org')).toMatchObject({ kind: 'mx' });
    const unwritable = createMxResolver({
      dns,
      cache: {
        ...cache,
        set: () => Promise.reject(new Error('Valkey is unavailable (reconnecting)')),
      },
    });
    expect(await unwritable.lookup('implicit.example.org')).toMatchObject({ kind: 'no_mx' });
  });
});

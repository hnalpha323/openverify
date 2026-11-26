/**
 * C85.2: the TXT lookups of the email report (SPF, DMARC) and the cache of the report's DNS
 * answers. Node's errors name the host; ours never do. Answers are kept in memory only, so no
 * email domain (personal data, P15) or record text reaches Valkey.
 */
import { describe, expect, it } from 'vitest';
import { createFakeDnsResolver, fixedClock } from '../test-support/fakes.js';
import { createDnsResolver, DnsResolverError, type NodeResolver } from './index.js';
import {
  createCachedDnsResolver,
  DNS_CACHE_SECONDS,
  resolveTxtRecords,
  TXT_MAX_ANSWER_BYTES,
} from './txt.js';

const HOST = 'synthetic-owner.example';

/** Node's DNS errors name the host in their message and `hostname`; ours must not. */
function nodeError(code: string): Error {
  return Object.assign(new Error(`queryTxt ${code} ${HOST}`), {
    code,
    hostname: HOST,
    syscall: 'queryTxt',
  });
}

function txtResolver(answer: () => Promise<string[][]>): NodeResolver & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    resolveMx: () => Promise.reject(new Error('not asked')),
    resolve4: () => Promise.reject(new Error('not asked')),
    resolve6: () => Promise.reject(new Error('not asked')),
    resolveTxt: (hostname) => {
      calls.push(hostname);
      return answer();
    },
  };
}

describe('resolveTxtRecords (C85.2)', () => {
  it('answers each TXT record as its character strings, as Node returns them', async () => {
    const records = [['v=spf1 ', '-all'], ['synthetic-verification=1']];
    const resolver = txtResolver(() => Promise.resolve(records));

    await expect(resolveTxtRecords(resolver, HOST)).resolves.toEqual(records);
    expect(resolver.calls).toEqual([HOST]);
  });

  it('maps Node’s failures to the MX resolver’s, never naming the host', async () => {
    const cases: [string, string, boolean][] = [
      ['ENOTFOUND', 'not_found', false],
      ['ENODATA', 'no_data', false],
      ['ETIMEOUT', 'timeout', true],
      ['ESERVFAIL', 'server_failure', true],
      ['EREFUSED', 'refused', true],
      ['ECONNREFUSED', 'failed', true],
    ];
    for (const [nodeCode, code, retryable] of cases) {
      const failure = await resolveTxtRecords(
        txtResolver(() => Promise.reject(nodeError(nodeCode))),
        HOST,
      ).catch((error: unknown) => error);

      expect(failure, nodeCode).toBeInstanceOf(DnsResolverError);
      expect(failure, nodeCode).toMatchObject({ code, retryable });
      expect(JSON.stringify(failure) + String(failure), nodeCode).not.toContain(HOST);
    }
  });

  it('reads an answer of exactly 4 KiB, and refuses a larger one as failed', async () => {
    const half = 'a'.repeat(TXT_MAX_ANSWER_BYTES / 2);
    await expect(
      resolveTxtRecords(
        txtResolver(() => Promise.resolve([[half], [half]])),
        HOST,
      ),
    ).resolves.toHaveLength(2);

    const failure = await resolveTxtRecords(
      txtResolver(() => Promise.resolve([[half], [half, 'b']])),
      HOST,
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DnsResolverError);
    expect(failure).toMatchObject({ code: 'failed' });
  });

  it('counts the cap in UTF-8 bytes, not characters', async () => {
    // 2,049 two-byte characters are 4,098 bytes.
    const failure = await resolveTxtRecords(
      txtResolver(() => Promise.resolve([['é'.repeat(2049)]])),
      HOST,
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: 'failed' });
  });

  it('fails a resolver that has no TXT query', async () => {
    const resolver: NodeResolver = {
      resolveMx: () => Promise.resolve([]),
      resolve4: () => Promise.resolve([]),
      resolve6: () => Promise.resolve([]),
    };

    await expect(resolveTxtRecords(resolver, HOST)).rejects.toMatchObject({ code: 'failed' });
  });

  it('is the worker resolver’s resolveTxt', async () => {
    const resolver = txtResolver(() => Promise.resolve([['v=DMARC1; p=reject']]));

    await expect(createDnsResolver({ resolver }).resolveTxt(`_dmarc.${HOST}`)).resolves.toEqual([
      ['v=DMARC1; p=reject'],
    ]);
    expect(resolver.calls).toEqual([`_dmarc.${HOST}`]);
  });
});

describe('createCachedDnsResolver (C85.2: 1 h positive, 5 min negative, in memory)', () => {
  it('keeps an answer for an hour, then asks again', async () => {
    const clock = fixedClock();
    const dns = createFakeDnsResolver({
      [HOST]: {
        txt: [['v=spf1 -all']],
        mx: [{ exchange: 'mx.synthetic-owner.example', priority: 5 }],
      },
    });
    const cached = createCachedDnsResolver(dns, { clock });

    await expect(cached.resolveTxt(HOST)).resolves.toEqual([['v=spf1 -all']]);
    await expect(cached.resolveMx(HOST)).resolves.toEqual([
      { exchange: 'mx.synthetic-owner.example', priority: 5 },
    ]);
    clock.advance(DNS_CACHE_SECONDS.positive * 1000 - 1);
    await cached.resolveTxt(HOST);
    await cached.resolveMx(HOST);
    expect(dns.queries).toEqual([
      { type: 'txt', hostname: HOST },
      { type: 'mx', hostname: HOST },
    ]);

    clock.advance(1);
    await cached.resolveTxt(HOST);
    expect(dns.queries).toHaveLength(3);
  });

  it('keeps NXDOMAIN and NODATA for five minutes, each time as a fresh error of its code', async () => {
    const clock = fixedClock();
    const dns = createFakeDnsResolver({ [HOST]: { a: ['192.0.2.7'] } });
    const cached = createCachedDnsResolver(dns, { clock });

    const first = await cached.resolveTxt('absent.example').catch((error: unknown) => error);
    const again = await cached.resolveTxt('absent.example').catch((error: unknown) => error);
    await expect(cached.resolveMx(HOST)).rejects.toMatchObject({ code: 'no_data' });
    await expect(cached.resolveMx(HOST)).rejects.toMatchObject({ code: 'no_data' });

    expect(first).toBeInstanceOf(DnsResolverError);
    expect(again).toMatchObject({ code: 'not_found', retryable: false });
    expect(again).not.toBe(first);
    expect(dns.queries).toHaveLength(2);

    clock.advance(DNS_CACHE_SECONDS.negative * 1000);
    await cached.resolveTxt('absent.example').catch(() => undefined);
    expect(dns.queries).toHaveLength(3);
  });

  it('keeps no failure a retry may cure', async () => {
    const dns = createFakeDnsResolver({ [HOST]: new DnsResolverError('timeout') });
    const cached = createCachedDnsResolver(dns, { clock: fixedClock() });

    await expect(cached.resolveTxt(HOST)).rejects.toMatchObject({ code: 'timeout' });
    await expect(cached.resolveTxt(HOST)).rejects.toMatchObject({ code: 'timeout' });
    expect(dns.queries).toHaveLength(2);
  });

  it('answers each lookup apart: the record type and the name both key it', async () => {
    const dns = createFakeDnsResolver({
      [HOST]: { a: ['192.0.2.1'], aaaa: ['2001:db8::1'], txt: [['one']] },
      [`_dmarc.${HOST}`]: { txt: [['two']] },
    });
    const cached = createCachedDnsResolver(dns, { clock: fixedClock() });

    await expect(cached.resolve4(HOST)).resolves.toEqual(['192.0.2.1']);
    await expect(cached.resolve6(HOST)).resolves.toEqual(['2001:db8::1']);
    await expect(cached.resolveTxt(HOST)).resolves.toEqual([['one']]);
    await expect(cached.resolveTxt(`_dmarc.${HOST}`)).resolves.toEqual([['two']]);
    await cached.resolve4(HOST);
    expect(dns.queries).toHaveLength(4);
  });

  it('hands out copies, so a caller cannot change what it keeps', async () => {
    const dns = createFakeDnsResolver({ [HOST]: { txt: [['kept']] } });
    const cached = createCachedDnsResolver(dns, { clock: fixedClock() });

    const first = await cached.resolveTxt(HOST);
    first[0]?.push('changed');
    first.push(['added']);

    await expect(cached.resolveTxt(HOST)).resolves.toEqual([['kept']]);
  });

  it('keeps at most maxEntries answers, dropping the oldest', async () => {
    const dns = createFakeDnsResolver({
      'one.example': { txt: [['1']] },
      'two.example': { txt: [['2']] },
      'three.example': { txt: [['3']] },
    });
    const cached = createCachedDnsResolver(dns, { clock: fixedClock(), maxEntries: 2 });

    await cached.resolveTxt('one.example');
    await cached.resolveTxt('two.example');
    await cached.resolveTxt('three.example');
    await cached.resolveTxt('three.example');
    await cached.resolveTxt('two.example');
    await cached.resolveTxt('one.example');

    expect(dns.queries.map(({ hostname }) => hostname)).toEqual([
      'one.example',
      'two.example',
      'three.example',
      'one.example',
    ]);
  });
});

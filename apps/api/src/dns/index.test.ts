import { describe, expect, it, vi } from 'vitest';
import {
  createDnsResolver,
  DNS_TIMEOUT_MS,
  DNS_TRIES,
  DnsResolverError,
  type NodeResolver,
} from './index.js';

const constructed = vi.hoisted(() => [] as unknown[]);

vi.mock('node:dns/promises', () => ({
  Resolver: class {
    constructor(options: unknown) {
      constructed.push(options);
    }
    resolveMx() {
      return Promise.resolve([{ exchange: 'mx.example.test', priority: 10 }]);
    }
    resolve4() {
      return Promise.resolve(['192.0.2.1']);
    }
    resolve6() {
      return Promise.resolve(['2001:db8::1']);
    }
  },
}));

/** Node's DNS errors name the host in their message and `hostname`; ours must not. */
function nodeError(code: string, hostname: string): Error {
  return Object.assign(new Error(`queryMx ${code} ${hostname}`), {
    code,
    hostname,
    syscall: 'queryMx',
  });
}

function rejecting(error: Error): NodeResolver {
  return {
    resolveMx: () => Promise.reject(error),
    resolve4: () => Promise.reject(error),
    resolve6: () => Promise.reject(error),
  };
}

describe('createDnsResolver (C54.3, C56)', () => {
  it('builds its own resolver with a 3 s timeout and 2 tries by default', async () => {
    const resolver = createDnsResolver();

    expect(constructed).toEqual([{ timeout: DNS_TIMEOUT_MS, tries: DNS_TRIES }]);
    expect(DNS_TIMEOUT_MS).toBe(3000);
    expect(DNS_TRIES).toBe(2);
    await expect(resolver.resolveMx('example.test')).resolves.toEqual([
      { exchange: 'mx.example.test', priority: 10 },
    ]);
    await expect(resolver.resolve4('example.test')).resolves.toEqual(['192.0.2.1']);
    await expect(resolver.resolve6('example.test')).resolves.toEqual(['2001:db8::1']);
  });

  it('answers the records of an injected resolver, MX records as exchange and priority only', async () => {
    const resolver = createDnsResolver({
      resolver: {
        resolveMx: () =>
          Promise.resolve([
            Object.assign({ exchange: 'b.example.test', priority: 20 }, { extra: 1 }),
          ]),
        resolve4: () => Promise.resolve(['192.0.2.7']),
        resolve6: () => Promise.resolve([]),
      },
    });

    await expect(resolver.resolveMx('example.test')).resolves.toEqual([
      { exchange: 'b.example.test', priority: 20 },
    ]);
    await expect(resolver.resolve4('example.test')).resolves.toEqual(['192.0.2.7']);
    await expect(resolver.resolve6('example.test')).resolves.toEqual([]);
  });

  it.each([
    ['ENOTFOUND', 'not_found', false],
    ['ENODATA', 'no_data', false],
    ['ETIMEOUT', 'timeout', true],
    ['ESERVFAIL', 'server_failure', true],
    ['EREFUSED', 'refused', true],
    ['ECONNREFUSED', 'failed', true],
  ] as const)(
    'turns %s into a %s failure that never names the host',
    async (nodeCode, code, retryable) => {
      const host = 'person-domain.example.test';
      const resolver = createDnsResolver({ resolver: rejecting(nodeError(nodeCode, host)) });

      for (const query of [
        () => resolver.resolveMx(host),
        () => resolver.resolve4(host),
        () => resolver.resolve6(host),
      ]) {
        const error = await query().catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(DnsResolverError);
        expect(error).toMatchObject({ code, retryable });
        expect(
          JSON.stringify({ ...(error as object), message: (error as Error).message }),
        ).not.toContain('person-domain');
        expect((error as Error).cause).toBeUndefined();
      }
    },
  );

  it('turns a failure without a code into failed', async () => {
    const resolver = createDnsResolver({ resolver: rejecting(new Error('boom')) });

    await expect(resolver.resolve4('example.test')).rejects.toMatchObject({
      code: 'failed',
      retryable: true,
    });
  });
});

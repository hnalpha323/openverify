/**
 * C56: `MxResolver`, the MX lookup of `email_address_mx_detection` over the worker's DNS resolver
 * (`node:dns/promises` `Resolver`, 3 s, 2 tries): MX records, or on NODATA the domain's own A and
 * AAAA records (the RFC 5321 §5.1 implicit MX), or NXDOMAIN. A timeout or server failure after the
 * resolver's tries is thrown, so the job retries and then records `execution_error`. Answers are
 * cached in Valkey for 1 h when the domain takes mail and 5 min when it does not, keyed by the
 * domain's SHA-256, holding no host name. No SMTP probing.
 */
import { createHash } from 'node:crypto';
import type { MxLookupResult } from '@openverify/checks';
import { z } from 'zod';
import { DnsResolverError } from '../dns/index.js';
import type { DnsResolver, KeyValueCache } from '../ports.js';

/** C56: how long an answer is kept. */
export const MX_CACHE_SECONDS = Object.freeze({ positive: 3600, negative: 300 });

export interface MxResolver {
  /**
   * What DNS says about mail for `domain` (lower-case ASCII). Exchange names are not kept: a
   * null MX reads as the empty name and every other exchange as `exchange`.
   * @throws {DnsResolverError} for a failure a retry may cure.
   */
  lookup(domain: string): Promise<MxLookupResult>;
}

export interface MxResolverOptions {
  dns: DnsResolver;
  /** Without one, nothing is cached. */
  cache?: KeyValueCache | undefined;
}

/** What the cache holds: the answer without host names. */
const cachedSchema: z.ZodType<MxLookupResult> = z.union([
  z.object({ kind: z.literal('mx'), exchanges: z.array(z.enum(['', 'exchange'])) }),
  z.object({ kind: z.literal('no_mx'), addressRecords: z.int().min(0) }),
  z.object({ kind: z.literal('not_found') }),
]);

const keyOf = (domain: string) =>
  `openverify:mx:${createHash('sha256').update(domain, 'utf8').digest('hex')}`;

/** RFC 7505: a null MX names the root, `.`, which Node returns as the empty name. */
const isNullMx = (exchange: string) => exchange === '' || exchange === '.';

/** Whether the answer says the domain takes mail (cached longer). */
function takesMail(result: MxLookupResult): boolean {
  switch (result.kind) {
    case 'mx':
      return result.exchanges.some((exchange) => !isNullMx(exchange));
    case 'no_mx':
      return result.addressRecords > 0;
    case 'not_found':
      return false;
  }
}

/** The domain's own addresses of one family; none on NODATA or NXDOMAIN. */
async function addressCount(query: () => Promise<string[]>): Promise<number> {
  try {
    return (await query()).length;
  } catch (error) {
    if (error instanceof DnsResolverError && !error.retryable) {
      return 0;
    }
    throw error;
  }
}

/** The answer DNS gives, host names dropped. */
async function resolveMail(dns: DnsResolver, domain: string): Promise<MxLookupResult> {
  let records: Awaited<ReturnType<DnsResolver['resolveMx']>>;
  try {
    records = await dns.resolveMx(domain);
  } catch (error) {
    if (error instanceof DnsResolverError && error.code === 'not_found') {
      return { kind: 'not_found' };
    }
    if (!(error instanceof DnsResolverError && error.code === 'no_data')) {
      throw error;
    }
    records = [];
  }
  if (records.length > 0) {
    return {
      kind: 'mx',
      exchanges: records.map(({ exchange }) => (isNullMx(exchange) ? '' : 'exchange')),
    };
  }
  return {
    kind: 'no_mx',
    addressRecords:
      (await addressCount(() => dns.resolve4(domain))) +
      (await addressCount(() => dns.resolve6(domain))),
  };
}

export function createMxResolver(options: MxResolverOptions): MxResolver {
  const { dns, cache } = options;
  return {
    async lookup(domain) {
      const key = keyOf(domain);
      try {
        const stored = await cache?.get(key);
        const parsed = stored == null ? undefined : cachedSchema.safeParse(JSON.parse(stored));
        if (parsed?.success === true) {
          return parsed.data;
        }
      } catch {
        // The cache only saves a query: ask DNS.
      }
      const result = await resolveMail(dns, domain);
      try {
        await cache?.set(
          key,
          JSON.stringify(result),
          takesMail(result) ? MX_CACHE_SECONDS.positive : MX_CACHE_SECONDS.negative,
        );
      } catch {
        // Not kept; the answer stands.
      }
      return result;
    },
  };
}

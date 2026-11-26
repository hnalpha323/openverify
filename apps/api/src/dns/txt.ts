/**
 * C85.2: TXT lookups for the email report (SPF, DMARC), and the cache of the report's DNS answers.
 *
 * - **`resolveTxtRecords`** (the worker resolver's `resolveTxt`): a name's TXT records as their
 *   character strings, with the MX resolver's error mapping (`DnsResolverError`, naming the kind
 *   of failure only, never the host: Node's own errors name it) and a cap of 4 KiB per answer,
 *   summed over every string in UTF-8. A larger answer is refused as `failed`, never cut: a cut
 *   answer could drop the SPF record and read as "no record". A resolver without a TXT query
 *   fails `failed` too, which the email rules read as an `execution_error`, never as "no record".
 * - **`createCachedDnsResolver`**: the report lookups' cache, as long as C56's MX cache keeps an
 *   answer (1 h for an answer, 5 min for NXDOMAIN and NODATA, nothing a retry may cure). It is
 *   kept in this process's memory only, never in Valkey: a TXT answer of a vanity domain names the
 *   domain (`rua=mailto:…`), and an email domain is personal data (P15). At most
 *   {@link DNS_CACHE_MAX_ENTRIES} answers are kept; the oldest goes first. Answers are handed out
 *   as copies, and a kept failure is thrown as a fresh error of its code.
 *
 * Owner: `api-providers` (Workflow 6A Stage 3); `resolveTxtRecords`' signature is frozen by
 * `foundation-6` (Stage 1b).
 */
import { systemClock, type Clock, type DnsResolver, type MxRecord } from '../ports.js';
import { DnsResolverError, type DnsFailure, type NodeResolver } from './index.js';

/** C85.2: the largest TXT answer read, summed over its records' strings (UTF-8 bytes). */
export const TXT_MAX_ANSWER_BYTES = 4096;

/** C85.2: how long an answer is kept, as the MX cache keeps it (C56). */
export const DNS_CACHE_SECONDS = Object.freeze({ positive: 3600, negative: 300 });

/** The most answers one cache keeps; the oldest goes first. */
export const DNS_CACHE_MAX_ENTRIES = 10_000;

/** Node's DNS error codes and the failures they become, as `dns/index.ts` maps them. */
const FAILURES: ReadonlyMap<string, DnsFailure> = new Map([
  ['ENOTFOUND', 'not_found'],
  ['ENODATA', 'no_data'],
  ['ETIMEOUT', 'timeout'],
  ['ESERVFAIL', 'server_failure'],
  ['EREFUSED', 'refused'],
]);

/** A fresh error naming the failure only: Node's own names the host, so it is never kept. */
function failureOf(error: unknown): DnsResolverError {
  if (error instanceof DnsResolverError) {
    return new DnsResolverError(error.code);
  }
  const code = (error as { code?: unknown } | null)?.code;
  return new DnsResolverError((typeof code === 'string' ? FAILURES.get(code) : null) ?? 'failed');
}

/** The UTF-8 size of an answer's strings, stopping as soon as it passes the cap. */
function exceedsCap(records: readonly (readonly string[])[]): boolean {
  let bytes = 0;
  for (const record of records) {
    for (const text of record) {
      bytes += Buffer.byteLength(text, 'utf8');
      if (bytes > TXT_MAX_ANSWER_BYTES) {
        return true;
      }
    }
  }
  return false;
}

/**
 * C85.2: the TXT records of `hostname`, each as its character strings.
 * @throws {DnsResolverError} for any failure, an answer over 4 KiB or a resolver without the query.
 */
export async function resolveTxtRecords(
  resolver: NodeResolver,
  hostname: string,
): Promise<string[][]> {
  if (resolver.resolveTxt === undefined) {
    throw new DnsResolverError('failed');
  }
  let records: string[][];
  try {
    records = await resolver.resolveTxt(hostname);
  } catch (error) {
    throw failureOf(error);
  }
  if (exceedsCap(records)) {
    throw new DnsResolverError('failed');
  }
  return records.map((record) => [...record]);
}

export interface CachedDnsResolverOptions {
  clock?: Clock | undefined;
  /** Defaults to {@link DNS_CACHE_MAX_ENTRIES}. */
  maxEntries?: number | undefined;
}

type Kept =
  | { kind: 'answer'; value: unknown; expiresAt: number }
  | { kind: 'failure'; code: DnsFailure; expiresAt: number };

/** A deep copy of an answer (arrays of strings, of string arrays, or of MX records). */
function copyOf<T>(value: T): T {
  return structuredClone(value);
}

/** C85.2: the report lookups' cache over `dns`, in memory (see the file header). */
export function createCachedDnsResolver(
  dns: DnsResolver,
  options: CachedDnsResolverOptions = {},
): DnsResolver {
  const clock = options.clock ?? systemClock;
  const maxEntries = options.maxEntries ?? DNS_CACHE_MAX_ENTRIES;
  const kept = new Map<string, Kept>();

  function remember(key: string, entry: Kept): void {
    kept.delete(key);
    kept.set(key, entry);
    while (kept.size > maxEntries) {
      const oldest = kept.keys().next();
      if (oldest.done === true) {
        break;
      }
      kept.delete(oldest.value);
    }
  }

  async function lookup<T>(type: string, hostname: string, ask: () => Promise<T>): Promise<T> {
    const key = `${type}\u0000${hostname}`;
    const now = clock.now().getTime();
    const entry = kept.get(key);
    if (entry !== undefined && entry.expiresAt > now) {
      if (entry.kind === 'failure') {
        throw new DnsResolverError(entry.code);
      }
      return copyOf(entry.value as T);
    }
    kept.delete(key);
    try {
      const value = await ask();
      remember(key, {
        kind: 'answer',
        value: copyOf(value),
        expiresAt: now + DNS_CACHE_SECONDS.positive * 1000,
      });
      return value;
    } catch (error) {
      if (error instanceof DnsResolverError && !error.retryable) {
        remember(key, {
          kind: 'failure',
          code: error.code,
          expiresAt: now + DNS_CACHE_SECONDS.negative * 1000,
        });
      }
      throw error;
    }
  }

  return {
    resolveMx: (hostname) => lookup<MxRecord[]>('mx', hostname, () => dns.resolveMx(hostname)),
    resolve4: (hostname) => lookup('a', hostname, () => dns.resolve4(hostname)),
    resolve6: (hostname) => lookup('aaaa', hostname, () => dns.resolve6(hostname)),
    resolveTxt: (hostname) => lookup('txt', hostname, () => dns.resolveTxt(hostname)),
  };
}

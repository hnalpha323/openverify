/**
 * C54.3: the worker's DNS resolver (`DnsResolver`), a dedicated `node:dns/promises` `Resolver`
 * with a 3 s timeout and 2 tries (C56), never the system `lookup`. Failures become
 * {@link DnsResolverError}s that name the kind of failure only: Node's own errors name the host,
 * which is an end user's email domain or website.
 */
import { Resolver } from 'node:dns/promises';
import type { DnsResolver } from '../ports.js';
import { resolveTxtRecords } from './txt.js';

/** C56: a query's deadline and attempts. */
export const DNS_TIMEOUT_MS = 3_000;
export const DNS_TRIES = 2;

export type DnsFailure =
  'not_found' | 'no_data' | 'timeout' | 'server_failure' | 'refused' | 'failed';

/** A DNS query failed. Never carries the host name. */
export class DnsResolverError extends Error {
  override name = 'DnsResolverError';
  readonly code: DnsFailure;
  readonly retryable: boolean;

  constructor(code: DnsFailure) {
    super(`DNS query failed (${code})`);
    this.code = code;
    this.retryable = code !== 'not_found' && code !== 'no_data';
  }
}

/** The part of a `node:dns/promises` `Resolver` the resolver uses. */
export interface NodeResolver {
  resolveMx(hostname: string): Promise<{ exchange: string; priority: number }[]>;
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
  /** C85.2; Node's `Resolver` has it (test fakes of the other queries may leave it out). */
  resolveTxt?(hostname: string): Promise<string[][]>;
}

export interface DnsResolverOptions {
  /** Defaults to a new `Resolver({ timeout: 3000, tries: 2 })`; tests inject their own. */
  resolver?: NodeResolver;
}

/** Node's DNS error codes and the failures they become; any other is `failed`. */
const FAILURES: ReadonlyMap<string, DnsFailure> = new Map([
  ['ENOTFOUND', 'not_found'],
  ['ENODATA', 'no_data'],
  ['ETIMEOUT', 'timeout'],
  ['ESERVFAIL', 'server_failure'],
  ['EREFUSED', 'refused'],
]);

/** A fresh error naming the failure only: Node's own names the host, so it is never kept. */
function failureOf(error: unknown): DnsResolverError {
  const code = (error as { code?: unknown } | null)?.code;
  return new DnsResolverError((typeof code === 'string' ? FAILURES.get(code) : null) ?? 'failed');
}

async function query<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw failureOf(error);
  }
}

/** The worker's resolver. */
export function createDnsResolver(options: DnsResolverOptions = {}): DnsResolver {
  const resolver: NodeResolver =
    options.resolver ?? new Resolver({ timeout: DNS_TIMEOUT_MS, tries: DNS_TRIES });
  return {
    resolveMx: (hostname) =>
      query(async () =>
        (await resolver.resolveMx(hostname)).map(({ exchange, priority }) => ({
          exchange,
          priority,
        })),
      ),
    resolve4: (hostname) => query(() => resolver.resolve4(hostname)),
    resolve6: (hostname) => query(() => resolver.resolve6(hostname)),
    // C85.2: built by `api-providers` in `dns/txt.ts`.
    resolveTxt: (hostname) => resolveTxtRecords(resolver, hostname),
  };
}

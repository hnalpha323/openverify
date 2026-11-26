/**
 * C85.3: RDAP's `registered-domain` mode for email domains (`email-domain-age-days`). It answers
 * for the registered domain of an address's domain and flags a subdomain (`mail.example.co.uk` is
 * aged at `example.co.uk`, `subdomain: true`); known free-mail domains are never asked. It is
 * built on the C61.4 client (`providers/domain-age/rdap.ts`) and the C61.6 sandbox, bound by the
 * `domainAge` kind: the C61.4 client answers only for a host itself and calls a shorter name's
 * answer `subdomain`, so the mode asks again one label shorter until a registry answers for the
 * name asked (at most {@link RDAP_MAX_QUERIES} rounds).
 *
 * **No email domain's date in Valkey** (Stage 1a amendment 4; P03, P15). The C61.4 client keeps a
 * website's registration date install-wide under an unsalted SHA-256 of the domain. For an email
 * domain that would tell a Valkey reader, by guessing, which vanity domains were screened, and a
 * hit would tell one tenant that another looked the domain up. So the mode's client gets a cache
 * that passes the IANA bootstrap (and nothing about the user) and drops every date key, and the
 * mode keeps a date in this process's memory only, under the asking scope (the report's
 * environment), for a day; without a scope it keeps nothing.
 *
 * Owner: `api-providers` (Workflow 6A Stage 3); the request and result types are frozen by
 * `foundation-6` (Stage 1b), `scope` added by their owner.
 */
import { freeMailProviderOf } from '@openverify/checks';
import { CACHE_KEY_NAMESPACE } from '../../cache/index.js';
import type { OutboundHttp } from '../../http/index.js';
import {
  systemClock,
  type Clock,
  type DomainAgeProvider,
  type DomainAgeResult,
  type KeyValueCache,
  type RateLimiter,
} from '../../ports.js';
import { createProviderPacer } from '../business-registry/pacing.js';
import { createRdapDomainAgeProvider, RDAP_DATE_TTL_SECONDS, RDAP_MAX_QUERIES } from './rdap.js';
import { createSandboxDomainAgeProvider } from './sandbox.js';

/** C85.3: the email domain to age, lower-case ASCII (punycode). */
export interface RegisteredDomainAgeRequest {
  domain: string;
  /**
   * Keeps cached answers apart (the report's environment id): a date is kept only for the scope
   * that asked, never across environments. Without one, nothing is kept.
   */
  scope?: string | undefined;
}

/** C85.3: the registration date of the domain's registered domain, or why there is none. */
export type RegisteredDomainAgeResult =
  | ((DomainAgeResult & { outcome: 'registered' }) & { subdomain: boolean })
  | Extract<DomainAgeResult, { outcome: 'unavailable' }>;

export interface RegisteredDomainAgeProvider {
  readonly id: string;
  readonly sandbox: boolean;
  registeredDomainAge(request: RegisteredDomainAgeRequest): Promise<RegisteredDomainAgeResult>;
}

/** What the mode is built from: the `domainAge` binding's clients. */
export interface RegisteredDomainAgeOptions {
  outboundHttp?: OutboundHttp | undefined;
  /** The bootstrap and the pacing only: no email domain's date is written here. */
  cache?: KeyValueCache | undefined;
  rateLimiter?: RateLimiter | undefined;
  clock?: Clock | undefined;
}

/** The most dates one mode keeps in memory; the oldest goes first. */
export const REGISTERED_DOMAIN_CACHE_MAX_ENTRIES = 10_000;

/** The C61.4 client's date keys (`rdap.ts`), which this mode never reads or writes. */
const DATE_KEY_PREFIX = `${CACHE_KEY_NAMESPACE}rdap:date:`;

/** `cache` without the C61.4 date keys: reads miss and writes are dropped. */
function withoutDates(cache: KeyValueCache | undefined): KeyValueCache | undefined {
  if (cache === undefined) {
    return undefined;
  }
  const isDate = (key: string) => key.startsWith(DATE_KEY_PREFIX);
  return {
    get: (key) => (isDate(key) ? Promise.resolve(null) : cache.get(key)),
    set: (key, value, ttlSeconds) =>
      isDate(key) ? Promise.resolve() : cache.set(key, value, ttlSeconds),
    delete: (key) => (isDate(key) ? Promise.resolve() : cache.delete(key)),
    pushCapped: (key, value, maxLength, ttlSeconds) =>
      cache.pushCapped(key, value, maxLength, ttlSeconds),
    listRange: (key, limit) => cache.listRange(key, limit),
    acquireLease: (key, leaseId, limit, ttlSeconds) =>
      cache.acquireLease(key, leaseId, limit, ttlSeconds),
    releaseLease: (key, leaseId) => cache.releaseLease(key, leaseId),
  };
}

/** `name` one label shorter, or `null` at a name of two labels or fewer. */
function parentOf(name: string): string | null {
  const dot = name.indexOf('.');
  const parent = dot === -1 ? '' : name.slice(dot + 1);
  return parent.includes('.') ? parent : null;
}

/** C85.3: the mode over the `domainAge` binding named `name` (see the file header). */
export function createRegisteredDomainAgeProvider(
  name: 'rdap' | 'sandbox',
  options: RegisteredDomainAgeOptions = {},
): RegisteredDomainAgeProvider {
  const clock = options.clock ?? systemClock;
  const inner: DomainAgeProvider =
    name === 'sandbox'
      ? createSandboxDomainAgeProvider(clock)
      : createRdapDomainAgeProvider({
          outboundHttp: options.outboundHttp,
          cache: withoutDates(options.cache),
          clock,
          pacer: createProviderPacer({
            rateLimiter: options.rateLimiter,
            cache: options.cache,
            clock,
          }),
        });
  /** Dates in memory, keyed by scope and domain (never in Valkey). */
  const kept = new Map<
    string,
    { result: Extract<RegisteredDomainAgeResult, { outcome: 'registered' }>; until: number }
  >();

  async function ask(domain: string): Promise<RegisteredDomainAgeResult> {
    let asked = domain;
    for (let round = 0; round < RDAP_MAX_QUERIES; round += 1) {
      const answer = await inner.age({ host: asked });
      if (answer.outcome === 'registered') {
        return { ...answer, subdomain: answer.domain !== domain };
      }
      const parent = answer.reason === 'subdomain' ? parentOf(asked) : null;
      if (parent === null) {
        return answer.reason === 'subdomain'
          ? { outcome: 'unavailable', reason: 'not_found' }
          : answer;
      }
      asked = parent;
    }
    return { outcome: 'unavailable', reason: 'not_found' };
  }

  return {
    id: name,
    sandbox: name === 'sandbox',
    async registeredDomainAge({ domain, scope }) {
      if (freeMailProviderOf(domain) !== null) {
        throw new RangeError('a free-mail domain is never aged (C85.3)');
      }
      const key = scope === undefined ? null : `${scope}\u0000${domain}`;
      const now = clock.now().getTime();
      const hit = key === null ? undefined : kept.get(key);
      if (hit !== undefined && hit.until > now) {
        return { ...hit.result, registeredAt: new Date(hit.result.registeredAt) };
      }
      const result = await ask(domain);
      if (key !== null && result.outcome === 'registered') {
        kept.delete(key);
        kept.set(key, { result, until: now + RDAP_DATE_TTL_SECONDS * 1000 });
        if (kept.size > REGISTERED_DOMAIN_CACHE_MAX_ENTRIES) {
          const oldest = kept.keys().next();
          if (oldest.done !== true) {
            kept.delete(oldest.value);
          }
        }
      }
      return result;
    },
  };
}

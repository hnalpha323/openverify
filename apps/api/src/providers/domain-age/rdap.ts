/**
 * C61.4: our RDAP client, the `rdap` domain age provider. The IANA bootstrap (`dns.json`, CC0) names
 * the RDAP service of each top-level domain; it is fetched over HTTPS through the outbound HTTP
 * client and kept, in Valkey and in memory, as long as IANA's `max-age` or `Expires` says, within
 * 1 hour to 7 days, else a day (Workflow 5C review K5). The website's host is then asked of its TLD's
 * service, trimming labels from the left (at most four queries) until the registry answers. Only an
 * answer for the host itself, or the host without a leading `www.`, gives a registration date; a
 * shorter name answering is a platform's (`subdomain`, never aged by the platform). A registry's
 * own redirects (`links`) are never followed, no WHOIS is asked, and the customer's site is never
 * fetched. Each RDAP host gets one request a second, install-wide, and registration dates are kept
 * for a day under a SHA-256 of the domain.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CACHE_KEY_NAMESPACE } from '../../cache/index.js';
import type { OutboundHttp, OutboundHttpClient } from '../../http/index.js';
import {
  systemClock,
  type Clock,
  type DomainAgeProvider,
  type DomainAgeResult,
  type KeyValueCache,
} from '../../ports.js';
import { requestJson } from '../business-registry/http.js';
import type { PacingRule, ProviderPacer } from '../business-registry/pacing.js';
import { ProviderError } from '../errors.js';

/** Where IANA publishes the RDAP bootstrap for domains (RFC 9224). */
export const IANA_RDAP_BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';

/**
 * How long the bootstrap is kept when IANA's answer names no lifetime (inside C61.4's 1 hour to
 * 7 days; IANA serves a day).
 */
export const RDAP_BOOTSTRAP_TTL_SECONDS = 86_400;

/** C61.4: the bootstrap is kept at least an hour and at most 7 days, whatever IANA says. */
export const RDAP_BOOTSTRAP_TTL_BOUNDS_SECONDS = Object.freeze({ min: 3_600, max: 604_800 });

/**
 * The bootstrap's lifetime in seconds (Workflow 5C review K5, C61.4): its `max-age`, else its
 * `Expires` from `now` (RFC 9111 §4.2.1), held within 1 hour to 7 days; without either, or with
 * one that does not parse, a day.
 */
export function bootstrapTtlSeconds(
  headers: { readonly expires?: string; readonly 'cache-control'?: string } | undefined,
  now: number,
): number {
  const maxAge = /(?:^|,)\s*max-age\s*=\s*"?(\d{1,10})"?\s*(?:,|$)/iu.exec(
    headers?.['cache-control'] ?? '',
  )?.[1];
  const expires = headers?.expires === undefined ? Number.NaN : Date.parse(headers.expires);
  const seconds =
    maxAge !== undefined
      ? Number(maxAge)
      : Number.isNaN(expires)
        ? RDAP_BOOTSTRAP_TTL_SECONDS
        : Math.floor((expires - now) / 1000);
  const { min, max } = RDAP_BOOTSTRAP_TTL_BOUNDS_SECONDS;
  return Math.min(max, Math.max(min, seconds));
}

/** C61.4: registration dates are kept for a day. */
export const RDAP_DATE_TTL_SECONDS = 86_400;

/** C61.4: at most four names are asked per host. */
export const RDAP_MAX_QUERIES = 4;

/** C61.4: one request a second per RDAP host (ours; no registry publishes a number). */
export const RDAP_PACING: PacingRule = Object.freeze({ name: 'rdap', intervalMs: 1000 });

export interface RdapDomainAgeOptions {
  outboundHttp?: OutboundHttp | undefined;
  cache?: KeyValueCache | undefined;
  clock?: Clock | undefined;
  pacer: ProviderPacer;
  /** Tests point it elsewhere; production uses {@link IANA_RDAP_BOOTSTRAP_URL}. */
  bootstrapUrl?: string | undefined;
}

const BOOTSTRAP_KEY = `${CACHE_KEY_NAMESPACE}rdap:bootstrap`;
const dateKey = (domain: string) =>
  `${CACHE_KEY_NAMESPACE}rdap:date:${createHash('sha256').update(domain).digest('hex')}`;

const bootstrapSchema = z.object({
  services: z
    .array(z.tuple([z.array(z.string().max(253)), z.array(z.string().max(2048))]))
    .max(5000),
});

/** What the bootstrap says, as kept: each TLD entry and its HTTPS service. */
const servicesSchema = z.array(z.tuple([z.string(), z.string()])).max(20_000);

const domainSchema = z.object({
  events: z
    .array(z.object({ eventAction: z.string().max(64), eventDate: z.string().max(64) }))
    .max(100)
    .optional(),
});

const malformed = (what: string) =>
  new ProviderError(`rdap: the ${what} is not what RDAP publishes`, {
    retryable: false,
    code: 'rdap_malformed',
  });

/** Each TLD entry (lower-case) and its first HTTPS service; HTTP-only services are dropped. */
function servicesOf(json: unknown): [string, string][] {
  const parsed = bootstrapSchema.safeParse(json);
  if (!parsed.success) {
    throw malformed('bootstrap');
  }
  const services: [string, string][] = [];
  for (const [entries, urls] of parsed.data.services) {
    const secure = urls.find((url) => URL.canParse(url) && new URL(url).protocol === 'https:');
    if (secure !== undefined) {
      const base = secure.endsWith('/') ? secure : `${secure}/`;
      for (const entry of entries) {
        services.push([entry.toLowerCase(), base]);
      }
    }
  }
  return services;
}

/** RFC 9224 §4: the longest entry the host ends with, by whole labels. */
function serviceFor(services: ReadonlyMap<string, string>, host: string) {
  const labels = host.split('.');
  for (let start = 0; start < labels.length; start += 1) {
    const entry = labels.slice(start).join('.');
    const base = services.get(entry);
    if (base !== undefined) {
      return { entry, base };
    }
  }
  return null;
}

/** The names to ask: the host, then shorter by a label each, above the TLD entry, at most four. */
function namesToAsk(host: string, entry: string): string[] {
  const labels = host.split('.');
  const floor = entry.split('.').length;
  const names: string[] = [];
  for (
    let start = 0;
    labels.length - start > floor && names.length < RDAP_MAX_QUERIES;
    start += 1
  ) {
    names.push(labels.slice(start).join('.'));
  }
  return names;
}

/** The names that may carry the site's own date: the host, and the host without `www.`. */
const ownNames = (host: string) => (host.startsWith('www.') ? [host, host.slice(4)] : [host]);

/** The RDAP domain age provider (C61.4). Its outbound clients are made on the first call. */
export function createRdapDomainAgeProvider(options: RdapDomainAgeOptions): DomainAgeProvider {
  const { outboundHttp, cache, pacer } = options;
  const clock = options.clock ?? systemClock;
  const bootstrapUrl = options.bootstrapUrl ?? IANA_RDAP_BOOTSTRAP_URL;
  let bootstrapClient: OutboundHttpClient | undefined;
  let registryClient: OutboundHttpClient | undefined;
  let memo: { until: number; services: ReadonlyMap<string, string> } | undefined;

  function http(): OutboundHttp {
    if (outboundHttp === undefined) {
      throw new ProviderError('rdap: no outbound client', {
        retryable: false,
        code: 'rdap_not_configured',
      });
    }
    return outboundHttp;
  }

  /**
   * The bootstrap, from memory, then Valkey, then IANA. One read from Valkey is kept in memory for
   * the shortest lifetime (an hour), so no worker outlives a short one set by another.
   */
  async function bootstrap(): Promise<ReadonlyMap<string, string>> {
    const now = clock.now().getTime();
    if (memo !== undefined && now < memo.until) {
      return memo.services;
    }
    const kept = await cache?.get(BOOTSTRAP_KEY).catch(() => null);
    const parsedKept = kept == null ? null : servicesSchema.safeParse(safeJson(kept));
    let services: [string, string][];
    let ttlSeconds: number;
    if (parsedKept?.success === true) {
      services = parsedKept.data;
      ttlSeconds = RDAP_BOOTSTRAP_TTL_BOUNDS_SECONDS.min;
    } else {
      bootstrapClient ??= http().client({
        name: 'rdap-bootstrap',
        contentTypes: ['application/json'],
        timeoutMs: 10_000,
      });
      const answer = await requestJson(
        bootstrapClient,
        { method: 'GET', url: bootstrapUrl, headers: { accept: 'application/json' } },
        'rdap',
      );
      if (!answer.found) {
        throw malformed('bootstrap');
      }
      services = servicesOf(answer.json);
      ttlSeconds = bootstrapTtlSeconds(answer.headers, now);
      await cache?.set(BOOTSTRAP_KEY, JSON.stringify(services), ttlSeconds).catch(() => undefined);
    }
    memo = { until: now + ttlSeconds * 1000, services: new Map(services) };
    return memo.services;
  }

  /** The registration date of `name` at `base`; `null` when the registry holds no such domain. */
  async function ask(base: string, name: string): Promise<{ registeredAt: Date | null } | null> {
    registryClient ??= http().client({
      name: 'rdap',
      contentTypes: ['application/rdap+json', 'application/json'],
      timeoutMs: 10_000,
    });
    await pacer.acquire(RDAP_PACING, new URL(base).hostname);
    const answer = await requestJson(
      registryClient,
      {
        method: 'GET',
        url: `${base}domain/${encodeURIComponent(name)}`,
        headers: { accept: 'application/rdap+json' },
      },
      'rdap',
    );
    if (!answer.found) {
      return null;
    }
    const parsed = domainSchema.safeParse(answer.json);
    if (!parsed.success) {
      throw malformed('answer');
    }
    // RFC 9083 §4.5: the `registration` event; a dropped and re-registered domain shows its new one.
    const event = (parsed.data.events ?? []).find(
      (one) => one.eventAction.toLowerCase() === 'registration',
    );
    const date = event === undefined ? Number.NaN : Date.parse(event.eventDate);
    return { registeredAt: Number.isNaN(date) ? null : new Date(date) };
  }

  return {
    id: 'rdap',
    sandbox: false,
    async age({ host }): Promise<DomainAgeResult> {
      http();
      for (const name of ownNames(host)) {
        const kept = await cache?.get(dateKey(name)).catch(() => null);
        const date = kept == null ? Number.NaN : Date.parse(kept);
        if (!Number.isNaN(date)) {
          return { outcome: 'registered', registeredAt: new Date(date), domain: name };
        }
      }
      const service = serviceFor(await bootstrap(), host);
      if (service === null) {
        return { outcome: 'unavailable', reason: 'no_rdap_service' };
      }
      for (const name of namesToAsk(host, service.entry)) {
        const answer = await ask(service.base, name);
        if (answer === null) {
          continue;
        }
        if (!ownNames(host).includes(name)) {
          // C61.4: a shorter name is a platform's; its date is not the site's.
          return { outcome: 'unavailable', reason: 'subdomain' };
        }
        if (answer.registeredAt === null) {
          return { outcome: 'unavailable', reason: 'no_registration_date' };
        }
        await cache
          ?.set(dateKey(name), answer.registeredAt.toISOString(), RDAP_DATE_TTL_SECONDS)
          .catch(() => undefined);
        return { outcome: 'registered', registeredAt: answer.registeredAt, domain: name };
      }
      return { outcome: 'unavailable', reason: 'not_found' };
    },
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

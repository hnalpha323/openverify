/**
 * C61.5: where the operator's feeds live in Valkey, written by the refresh job
 * (`jobs/repeatable/feeds.ts`) and read by the `feed-list` provider. Each feed has a meta key
 * (`openverify:malicious-feed:<id>`: its generation, last successful refresh and entry count) and
 * one entries key per generation (`…:<id>:entries:<generation>`, the hosts one per line), so a
 * refresh swaps a whole list at once. Only host names are kept: a `urls` feed's paths and queries
 * (which can carry a victim's address) are dropped when it is read. Both keys outlive twice the
 * feed's interval, after which the feed is stale anyway.
 */
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import { CACHE_KEY_NAMESPACE } from '../../cache/index.js';
import type { KeyValueCache } from '../../ports.js';
import type { MaliciousFeed } from './feed-list.js';

/** What a feed's meta key holds. */
export interface FeedMeta {
  generation: string;
  /** ISO 8601. */
  refreshedAt: string;
  count: number;
}

/** The most hosts one feed keeps, and the largest feed body read. */
export const MAX_FEED_HOSTS = 1_000_000;
export const MAX_FEED_BYTES = 32 * 1024 * 1024;

/** Beyond twice its interval a feed is stale anyway; its keys live a little longer than that. */
const KEY_MARGIN_SECONDS = 600;

const metaKey = (id: string) => `${CACHE_KEY_NAMESPACE}malicious-feed:${id}`;
const hostsKey = (id: string, generation: string) =>
  `${CACHE_KEY_NAMESPACE}malicious-feed:${id}:entries:${generation}`;

const metaSchema = z.strictObject({
  generation: z.string().min(1).max(64),
  refreshedAt: z.iso.datetime(),
  count: z.int().min(0),
});

/** A host name with a dot that is not an IP address, as a URL reads it; else `null`. */
function hostOf(token: string): string | null {
  const bare = token.replace(/^\*\./, '').replace(/\.$/, '');
  if (bare === '' || /[/?#@:\s]/.test(bare) || !URL.canParse(`http://${bare}`)) {
    return null;
  }
  const host = new URL(`http://${bare}`).hostname;
  return host.includes('.') && isIP(host) === 0 && !host.startsWith('[') ? host : null;
}

/** The host of a URL line of a `urls` feed (http or https only); else `null`. */
function urlHostOf(line: string): string | null {
  if (!URL.canParse(line)) {
    return null;
  }
  const url = new URL(line);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }
  const host = url.hostname.replace(/\.$/, '');
  return host.includes('.') && isIP(host) === 0 && !host.startsWith('[') ? host : null;
}

/** The host a `domains` line lists: a bare name, or a hosts-file line's name after its address. */
function domainLineHost(line: string): string | null {
  const tokens = line.split(/\s+/);
  const [first, second] = tokens;
  if (first === undefined) {
    return null;
  }
  return second !== undefined && isIP(first) !== 0 ? hostOf(second) : hostOf(first);
}

/** The hosts a feed body lists, lower-case, unique, at most {@link MAX_FEED_HOSTS}. */
export function feedHosts(body: string, format: MaliciousFeed['format']): string[] {
  const hosts = new Set<string>();
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/\s#.*$/, '').trim();
    if (line === '' || line.startsWith('#') || line.startsWith('!')) {
      continue;
    }
    const host = format === 'urls' ? urlHostOf(line) : domainLineHost(line);
    if (host !== null) {
      hosts.add(host);
      if (hosts.size >= MAX_FEED_HOSTS) {
        break;
      }
    }
  }
  return [...hosts];
}

/** The feed's meta, or `null` when it was never loaded (or its keys expired). */
export async function readFeedMeta(cache: KeyValueCache, id: string): Promise<FeedMeta | null> {
  const stored = await cache.get(metaKey(id));
  if (stored === null) {
    return null;
  }
  try {
    const parsed = metaSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The hosts of one generation, or `null` when they expired. */
export async function readFeedHosts(
  cache: KeyValueCache,
  id: string,
  generation: string,
): Promise<string[] | null> {
  const stored = await cache.get(hostsKey(id, generation));
  if (stored === null) {
    return null;
  }
  return stored === '' ? [] : stored.split('\n');
}

/** Writes a new generation of `feed`'s hosts, then its meta, which names it. */
export async function writeFeed(
  cache: KeyValueCache,
  feed: MaliciousFeed,
  hosts: readonly string[],
  at: Date,
): Promise<FeedMeta> {
  const ttl = 2 * feed.refresh_interval_seconds + KEY_MARGIN_SECONDS;
  const meta: FeedMeta = {
    generation: randomUUID(),
    refreshedAt: at.toISOString(),
    count: hosts.length,
  };
  await cache.set(hostsKey(feed.id, meta.generation), hosts.join('\n'), ttl);
  await cache.set(metaKey(feed.id), JSON.stringify(meta), ttl);
  return meta;
}

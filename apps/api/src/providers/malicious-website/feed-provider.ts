/**
 * C61.5: the `feed-list` malicious-website provider. It reads the operator's feeds as the refresh
 * job left them in Valkey: a `domains` feed lists the host or any parent of it, a `urls` feed the
 * exact host. A host a fresh feed lists is `listed` with that feed's category; otherwise a feed
 * never loaded, or not refreshed for twice its interval, makes the answer `stale`
 * (`execution_error`); with no feed at all the answer is `no_feeds` (`provider_not_configured`).
 * Each generation's hosts are read once into memory.
 */
import {
  systemClock,
  type Clock,
  type KeyValueCache,
  type MaliciousWebsiteProvider,
  type MaliciousWebsiteResult,
} from '../../ports.js';
import { ProviderError } from '../errors.js';
import {
  MALICIOUS_FEED_CATEGORIES,
  type MaliciousFeed,
  type MaliciousFeedList,
} from './feed-list.js';
import { readFeedHosts, readFeedMeta } from './store.js';

export interface FeedListProviderOptions {
  feeds?: MaliciousFeedList | undefined;
  cache?: KeyValueCache | undefined;
  clock?: Clock | undefined;
}

/** The names a `domains` feed matches for `host`: the host and each parent, never the TLD. */
function namesOf(host: string): string[] {
  const labels = host.split('.');
  const names: string[] = [];
  for (let start = 0; labels.length - start >= 2; start += 1) {
    names.push(labels.slice(start).join('.'));
  }
  return names;
}

const unavailable = () =>
  new ProviderError('feed-list: the feed store is unavailable', {
    retryable: true,
    code: 'feed_store_unavailable',
  });

/** The feed-list provider (C61.5). */
export function createFeedListProvider(options: FeedListProviderOptions): MaliciousWebsiteProvider {
  const feeds = options.feeds?.feeds ?? [];
  const clock = options.clock ?? systemClock;
  const { cache } = options;
  /** Each feed's hosts, by the generation they came from. */
  const loaded = new Map<string, { generation: string; hosts: ReadonlySet<string> }>();

  /** The fresh hosts of `feed`, or `null` when it is not loaded or stale. */
  async function freshHosts(store: KeyValueCache, feed: MaliciousFeed) {
    const meta = await readFeedMeta(store, feed.id);
    const age =
      meta === null
        ? Number.POSITIVE_INFINITY
        : clock.now().getTime() - Date.parse(meta.refreshedAt);
    if (meta === null || age > 2 * feed.refresh_interval_seconds * 1000) {
      return null;
    }
    const memo = loaded.get(feed.id);
    if (memo?.generation === meta.generation) {
      return memo.hosts;
    }
    const hosts = await readFeedHosts(store, feed.id, meta.generation);
    if (hosts === null) {
      return null;
    }
    const set = new Set(hosts);
    loaded.set(feed.id, { generation: meta.generation, hosts: set });
    return set;
  }

  return {
    id: 'feed-list',
    sandbox: false,
    async check({ host }): Promise<MaliciousWebsiteResult> {
      if (feeds.length === 0) {
        return { outcome: 'no_feeds' };
      }
      const listed: MaliciousFeed[] = [];
      const fresh: string[] = [];
      const stale: string[] = [];
      for (const feed of feeds) {
        let hosts: ReadonlySet<string> | null = null;
        if (cache !== undefined) {
          try {
            hosts = await freshHosts(cache, feed);
          } catch {
            throw unavailable();
          }
        }
        if (hosts === null) {
          stale.push(feed.id);
          continue;
        }
        fresh.push(feed.id);
        const names = feed.format === 'urls' ? [host] : namesOf(host);
        if (names.some((name) => hosts.has(name))) {
          listed.push(feed);
        }
      }
      if (listed.length > 0) {
        return {
          outcome: 'listed',
          categories: MALICIOUS_FEED_CATEGORIES.filter((category) =>
            listed.some((feed) => feed.category === category),
          ),
          feeds: listed.map((feed) => feed.id),
        };
      }
      return stale.length > 0
        ? { outcome: 'stale', feeds: stale }
        : { outcome: 'not_listed', feeds: fresh };
    },
  };
}

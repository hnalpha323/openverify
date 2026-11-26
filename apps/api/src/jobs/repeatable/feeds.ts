/**
 * C61.5: the malicious-website feed refresh, a repeatable job of the worker. It runs every five
 * minutes (the shortest refresh interval a feed may set) and refreshes each feed of
 * `data/malicious-feeds.json` that is due (never loaded, or refreshed at least its interval ago),
 * through the outbound client, into Valkey (`providers/malicious-website/store.ts`) with the feed's
 * last successful refresh and host count. Only hosts are kept. A feed that fails keeps its last
 * list, so it goes stale (`execution_error`) rather than empty; a failure is logged by the feed's
 * id and a code, never its URL, which can carry the operator's key. Feeds are fetched one at a
 * time, and the job is scheduled only while the loaded list holds a feed (`index.ts`).
 */
import { OutboundHttpError, type OutboundHttp, type OutboundHttpClient } from '../../http/index.js';
import type { KeyValueCache } from '../../ports.js';
import {
  MALICIOUS_FEED_REFRESH_SECONDS,
  type MaliciousFeed,
} from '../../providers/malicious-website/feed-list.js';
import {
  MAX_FEED_BYTES,
  feedHosts,
  readFeedMeta,
  writeFeed,
} from '../../providers/malicious-website/store.js';
import type { RepeatableJob } from '../../worker.js';
import type { RepeatableJobDeps } from './index.js';

/** The job's name, which is also its queue's and its scheduler's. */
export const MALICIOUS_FEED_REFRESH_QUEUE = 'malicious-feed-refresh';

/** How often the job looks for due feeds: the shortest interval a feed may set. */
export const MALICIOUS_FEED_REFRESH_INTERVAL_MS = MALICIOUS_FEED_REFRESH_SECONDS.min * 1000;

/** A feed body may be large; its download gets this long. */
export const MALICIOUS_FEED_TIMEOUT_MS = 30_000;

/** What one run did: the feeds refreshed, those not yet due, and those that failed. */
export interface FeedRefreshSummary {
  refreshed: string[];
  notDue: string[];
  failed: string[];
}

/** A feed could not be refreshed; `code` names why, never the URL. */
class FeedRefreshError extends Error {
  override name = 'FeedRefreshError';
  constructor(readonly code: string) {
    super(`malicious feed not refreshed (${code})`);
  }
}

/** The failure code of a status other than 2xx: a redirect is never followed (C54.6). */
function statusCode(status: number): string {
  if (status >= 300 && status < 400) {
    return 'malicious_feed_redirect';
  }
  if (status === 429) {
    return 'malicious_feed_rate_limited';
  }
  return status >= 500 ? 'malicious_feed_unavailable' : 'malicious_feed_rejected';
}

/** The feed's body as text. */
async function download(client: OutboundHttpClient, feed: MaliciousFeed): Promise<string> {
  let response;
  try {
    response = await client.request({
      method: 'GET',
      url: feed.url,
      headers: { accept: 'text/plain' },
    });
  } catch (error) {
    if (error instanceof OutboundHttpError) {
      throw new FeedRefreshError(`malicious_feed_${error.code}`);
    }
    throw error;
  }
  if (response.status < 200 || response.status > 299) {
    throw new FeedRefreshError(statusCode(response.status));
  }
  return new TextDecoder().decode(response.body);
}

/** Whether `feed` is due: never loaded, or refreshed at least its interval ago. */
async function isDue(cache: KeyValueCache, feed: MaliciousFeed, now: Date): Promise<boolean> {
  const meta = await readFeedMeta(cache, feed.id);
  return (
    meta === null ||
    now.getTime() - Date.parse(meta.refreshedAt) >= feed.refresh_interval_seconds * 1000
  );
}

/** One run of the refresh. */
export async function refreshMaliciousFeeds(deps: RepeatableJobDeps): Promise<FeedRefreshSummary> {
  const feeds = deps.maliciousFeeds?.feeds ?? [];
  const summary: FeedRefreshSummary = { refreshed: [], notDue: [], failed: [] };
  const { cache, outboundHttp } = deps;
  if (cache === undefined || outboundHttp === undefined) {
    deps.logger.warn(
      { feeds: feeds.length },
      'malicious feeds not refreshed: no cache or outbound client',
    );
    return summary;
  }
  const client = feedClient(outboundHttp);
  for (const feed of feeds) {
    try {
      if (!(await isDue(cache, feed, deps.clock.now()))) {
        summary.notDue.push(feed.id);
        continue;
      }
      const hosts = feedHosts(await download(client, feed), feed.format);
      await writeFeed(cache, feed, hosts, deps.clock.now());
      summary.refreshed.push(feed.id);
      deps.logger.info({ feed: feed.id, count: hosts.length }, 'malicious feed refreshed');
    } catch (error) {
      summary.failed.push(feed.id);
      deps.logger.warn(
        {
          feed: feed.id,
          error: error instanceof FeedRefreshError ? error.code : 'malicious_feed_store_failed',
        },
        'malicious feed not refreshed',
      );
    }
  }
  return summary;
}

/** The feeds' outbound client: text bodies of up to 32 MiB, 30 s each. */
function feedClient(outboundHttp: OutboundHttp): OutboundHttpClient {
  return outboundHttp.client({
    name: 'malicious-feed',
    contentTypes: ['text/plain', 'text/csv', 'application/octet-stream'],
    maxResponseBytes: MAX_FEED_BYTES,
    timeoutMs: MALICIOUS_FEED_TIMEOUT_MS,
  });
}

/** The refresh of the feeds of `deps.maliciousFeeds`, every five minutes. */
export function maliciousFeedRefreshJob(deps: RepeatableJobDeps): RepeatableJob {
  return {
    name: MALICIOUS_FEED_REFRESH_QUEUE,
    repeat: { every: MALICIOUS_FEED_REFRESH_INTERVAL_MS },
    run: () => refreshMaliciousFeeds(deps),
  };
}

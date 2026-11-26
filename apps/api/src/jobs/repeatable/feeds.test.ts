/**
 * C61.5: the malicious-website feed refresh. Each run fetches every feed that is due (never loaded,
 * or refreshed at least its interval ago) through the outbound client (`MockAgent`, synthetic
 * bodies), stores its hosts as a new generation with the refresh time and count, skips the rest,
 * and logs a failure by the feed's id and a code only: never its URL, which can carry the
 * operator's key. A failed feed keeps its last list, so it goes stale rather than empty.
 */
import type { Db } from '@openverify/db';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createMockOutbound,
  type MockOutbound,
} from '../../providers/business-registry/testing.js';
import type {
  MaliciousFeed,
  MaliciousFeedList,
} from '../../providers/malicious-website/feed-list.js';
import { readFeedHosts, readFeedMeta } from '../../providers/malicious-website/store.js';
import { createInMemoryKeyValueCache, fixedClock } from '../../test-support/fakes.js';
import { createCapturingLogger } from '../testing.js';
import {
  MALICIOUS_FEED_REFRESH_INTERVAL_MS,
  MALICIOUS_FEED_REFRESH_QUEUE,
  maliciousFeedRefreshJob,
  refreshMaliciousFeeds,
} from './feeds.js';
import type { RepeatableJobDeps } from './index.js';

const ORIGIN = 'https://feeds.example.test';
const AT = new Date('2026-10-24T09:00:00.000Z');

const feed = (id: string, overrides: Partial<MaliciousFeed> = {}): MaliciousFeed => ({
  id,
  url: `${ORIGIN}/synthetic-key-0001/${id}.txt`,
  format: 'domains',
  category: 'phishing',
  refresh_interval_seconds: 3600,
  terms: 'Synthetic test feed.',
  ...overrides,
});

const PHISHING = feed('synthetic-phishing');
const MALWARE = feed('synthetic-malware', { format: 'urls', category: 'malware' });
const LIST: MaliciousFeedList = { schema_version: 1, feeds: [PHISHING, MALWARE] };
const TEXT = { headers: { 'content-type': 'text/plain; charset=utf-8' } };

let outbound: MockOutbound | undefined;

afterEach(async () => {
  await outbound?.close();
  outbound = undefined;
});

function deps(overrides: Partial<RepeatableJobDeps> = {}) {
  outbound = createMockOutbound();
  const clock = fixedClock(AT);
  const cache = createInMemoryKeyValueCache(clock);
  const logger = createCapturingLogger();
  const built: RepeatableJobDeps = {
    db: {} as Db,
    clock,
    logger,
    cache,
    outboundHttp: outbound,
    maliciousFeeds: LIST,
    ...overrides,
  };
  return { deps: built, pool: outbound.agent.get(ORIGIN), cache, clock, logger, outbound };
}

describe('the malicious-feed refresh job (C61.5)', () => {
  it('keeps its name and five-minute schedule, and runs the refresh', async () => {
    const { deps: built, pool } = deps({
      maliciousFeeds: { schema_version: 1, feeds: [PHISHING] },
    });
    pool
      .intercept({ path: '/synthetic-key-0001/synthetic-phishing.txt', method: 'GET' })
      .reply(200, 'phish.example\n', TEXT);
    const job = maliciousFeedRefreshJob(built);

    expect({ name: job.name, repeat: job.repeat }).toEqual({
      name: MALICIOUS_FEED_REFRESH_QUEUE,
      repeat: { every: MALICIOUS_FEED_REFRESH_INTERVAL_MS },
    });
    expect(await job.run()).toEqual({
      refreshed: ['synthetic-phishing'],
      notDue: [],
      failed: [],
    });
  });

  it('fetches each due feed and stores its hosts with the refresh time and count', async () => {
    const { deps: built, pool, cache, outbound: mock, logger } = deps();
    pool
      .intercept({ path: '/synthetic-key-0001/synthetic-phishing.txt', method: 'GET' })
      .reply(200, '# synthetic\nphish.example\nother.example\n', TEXT);
    pool
      .intercept({ path: '/synthetic-key-0001/synthetic-malware.txt', method: 'GET' })
      .reply(200, 'https://exact.example/payload?victim=someone%40example.test\n', TEXT);

    expect(await refreshMaliciousFeeds(built)).toEqual({
      refreshed: ['synthetic-phishing', 'synthetic-malware'],
      notDue: [],
      failed: [],
    });

    const phishing = await readFeedMeta(cache, 'synthetic-phishing');
    expect(phishing).toMatchObject({ refreshedAt: AT.toISOString(), count: 2 });
    expect(await readFeedHosts(cache, 'synthetic-phishing', phishing?.generation ?? '')).toEqual([
      'phish.example',
      'other.example',
    ]);
    const malware = await readFeedMeta(cache, 'synthetic-malware');
    expect(await readFeedHosts(cache, 'synthetic-malware', malware?.generation ?? '')).toEqual([
      'exact.example',
    ]);
    expect(mock.clients).toEqual([
      {
        name: 'malicious-feed',
        contentTypes: ['text/plain', 'text/csv', 'application/octet-stream'],
        maxResponseBytes: 32 * 1024 * 1024,
        timeoutMs: 30_000,
      },
    ]);
    expect(logger.entries).toEqual([
      {
        level: 'info',
        object: { feed: 'synthetic-phishing', count: 2 },
        message: 'malicious feed refreshed',
      },
      {
        level: 'info',
        object: { feed: 'synthetic-malware', count: 1 },
        message: 'malicious feed refreshed',
      },
    ]);
  });

  it('skips a feed refreshed less than its interval ago, and refreshes it once due', async () => {
    const {
      deps: built,
      pool,
      clock,
    } = deps({
      maliciousFeeds: { schema_version: 1, feeds: [PHISHING] },
    });
    pool
      .intercept({ path: '/synthetic-key-0001/synthetic-phishing.txt', method: 'GET' })
      .reply(200, 'phish.example\n', TEXT)
      .times(2);

    await refreshMaliciousFeeds(built);
    clock.advance(30 * 60 * 1000);
    expect(await refreshMaliciousFeeds(built)).toEqual({
      refreshed: [],
      notDue: ['synthetic-phishing'],
      failed: [],
    });
    clock.advance(30 * 60 * 1000);
    expect(await refreshMaliciousFeeds(built)).toMatchObject({ refreshed: ['synthetic-phishing'] });
  });

  it('logs a failed feed by its id and a code, never its URL, and keeps its last list', async () => {
    const {
      deps: built,
      pool,
      cache,
      clock,
      logger,
    } = deps({
      maliciousFeeds: { schema_version: 1, feeds: [PHISHING] },
    });
    pool
      .intercept({ path: '/synthetic-key-0001/synthetic-phishing.txt', method: 'GET' })
      .reply(200, 'phish.example\n', TEXT);
    await refreshMaliciousFeeds(built);
    const kept = await readFeedMeta(cache, 'synthetic-phishing');
    clock.advance(3600 * 1000);
    pool
      .intercept({ path: '/synthetic-key-0001/synthetic-phishing.txt', method: 'GET' })
      .reply(503, 'busy');

    expect(await refreshMaliciousFeeds(built)).toEqual({
      refreshed: [],
      notDue: [],
      failed: ['synthetic-phishing'],
    });
    expect(await readFeedMeta(cache, 'synthetic-phishing')).toEqual(kept);
    expect(logger.entries.at(-1)).toEqual({
      level: 'warn',
      object: { feed: 'synthetic-phishing', error: 'malicious_feed_unavailable' },
      message: 'malicious feed not refreshed',
    });
    expect(JSON.stringify(logger.entries)).not.toContain('synthetic-key-0001');
  });

  it('logs a refused redirect and a refused type as failures too', async () => {
    const { deps: built, pool, logger } = deps();
    pool
      .intercept({ path: '/synthetic-key-0001/synthetic-phishing.txt', method: 'GET' })
      .reply(302, '', { headers: { location: `${ORIGIN}/elsewhere` } });
    pool
      .intercept({ path: '/synthetic-key-0001/synthetic-malware.txt', method: 'GET' })
      .reply(200, '<html>', { headers: { 'content-type': 'text/html' } });

    expect(await refreshMaliciousFeeds(built)).toMatchObject({
      failed: ['synthetic-phishing', 'synthetic-malware'],
    });
    expect(logger.entries.map((entry) => entry.object)).toEqual([
      { feed: 'synthetic-phishing', error: 'malicious_feed_redirect' },
      { feed: 'synthetic-malware', error: 'malicious_feed_content_type' },
    ]);
  });

  it('refreshes nothing without a cache or an outbound client, and says so once', async () => {
    const { deps: built, logger } = deps({ cache: undefined });

    expect(await refreshMaliciousFeeds(built)).toEqual({ refreshed: [], notDue: [], failed: [] });
    expect(logger.entries).toEqual([
      {
        level: 'warn',
        object: { feeds: 2 },
        message: 'malicious feeds not refreshed: no cache or outbound client',
      },
    ]);
  });
});

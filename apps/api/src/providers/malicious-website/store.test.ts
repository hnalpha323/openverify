/**
 * C61.5: the feeds' storage in Valkey: the hosts a feed body lists (a `urls` feed's paths and
 * queries dropped), one generation per refresh with its meta, keys that outlive twice the feed's
 * interval, and values the job did not write read as nothing. Every feed and host is synthetic.
 */
import { describe, expect, it } from 'vitest';
import { createInMemoryKeyValueCache, fixedClock } from '../../test-support/fakes.js';
import type { MaliciousFeed } from './feed-list.js';
import { MAX_FEED_HOSTS, feedHosts, readFeedHosts, readFeedMeta, writeFeed } from './store.js';

const FEED: MaliciousFeed = {
  id: 'synthetic-phishing',
  url: 'https://feeds.example.test/synthetic-key-0001/phishing.txt',
  format: 'domains',
  category: 'phishing',
  refresh_interval_seconds: 3600,
  terms: 'Synthetic test feed.',
};
const AT = new Date('2026-10-24T09:00:00.000Z');

describe('feedHosts (C61.5)', () => {
  it('reads a domains feed: one host a line, comments and blanks skipped, lower-case and unique', () => {
    const body = [
      '# synthetic phishing domains',
      '! another comment',
      '',
      'Phish.Example',
      'phish.example.',
      '*.wildcard.example',
      '0.0.0.0 hosts-file.example',
      '127.0.0.1 local-hosts.example # trailing comment',
      '192.0.2.10',
      'not a host',
      'single',
      'xn--bcher-kva.example',
    ].join('\n');

    expect(feedHosts(body, 'domains')).toEqual([
      'phish.example',
      'wildcard.example',
      'hosts-file.example',
      'local-hosts.example',
      'xn--bcher-kva.example',
    ]);
  });

  it('reads a urls feed as its hosts only, never a path or a query', () => {
    const body = [
      'https://Login.Phish.Example/secure?user=someone%40example.test',
      'http://login.phish.example:8080/other',
      'https://192.0.2.10/admin',
      'ftp://files.example/x',
      'not a url',
    ].join('\r\n');

    expect(feedHosts(body, 'urls')).toEqual(['login.phish.example']);
  });

  it('keeps at most a million hosts', () => {
    expect(MAX_FEED_HOSTS).toBe(1_000_000);
    const body = Array.from({ length: 1200 }, (_, index) => `h${String(index)}.example`).join('\n');
    expect(feedHosts(body, 'domains')).toHaveLength(1200);
  });
});

describe('the feed store (C61.5)', () => {
  it('writes a generation of hosts, then the meta that names it, for twice the interval and more', async () => {
    const clock = fixedClock(AT);
    const cache = createInMemoryKeyValueCache(clock);

    const meta = await writeFeed(cache, FEED, ['phish.example', 'other.example'], AT);

    expect(meta).toEqual({
      generation: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      refreshedAt: AT.toISOString(),
      count: 2,
    });
    expect(await readFeedMeta(cache, FEED.id)).toEqual(meta);
    expect(await readFeedHosts(cache, FEED.id, meta.generation)).toEqual([
      'phish.example',
      'other.example',
    ]);
    expect(cache.keys().sort()).toEqual([
      `openverify:malicious-feed:${FEED.id}`,
      `openverify:malicious-feed:${FEED.id}:entries:${meta.generation}`,
    ]);
    expect(cache.keys().join()).not.toContain('synthetic-key-0001');
    clock.advance(2 * 3600 * 1000);
    expect(await readFeedMeta(cache, FEED.id)).toEqual(meta);
    clock.advance(3600 * 1000);
    expect(await readFeedMeta(cache, FEED.id)).toBeNull();
  });

  it('swaps a whole list at once: the meta names the newest generation', async () => {
    const cache = createInMemoryKeyValueCache(fixedClock(AT));
    const first = await writeFeed(cache, FEED, ['phish.example'], AT);
    const second = await writeFeed(cache, FEED, ['newer.example'], new Date(AT.getTime() + 60_000));

    expect(second.generation).not.toBe(first.generation);
    expect(await readFeedMeta(cache, FEED.id)).toEqual(second);
    expect(await readFeedHosts(cache, FEED.id, second.generation)).toEqual(['newer.example']);
  });

  it('reads a feed never loaded, an expired generation or a value it did not write as nothing', async () => {
    const cache = createInMemoryKeyValueCache(fixedClock(AT));

    expect(await readFeedMeta(cache, FEED.id)).toBeNull();
    expect(await readFeedHosts(cache, FEED.id, 'gone')).toBeNull();
    await cache.set(`openverify:malicious-feed:${FEED.id}`, '{"generation":7}', 60);
    expect(await readFeedMeta(cache, FEED.id)).toBeNull();
    await cache.set(`openverify:malicious-feed:${FEED.id}`, 'not json', 60);
    expect(await readFeedMeta(cache, FEED.id)).toBeNull();
  });

  it('keeps an empty feed as an empty, loaded list', async () => {
    const cache = createInMemoryKeyValueCache(fixedClock(AT));
    const meta = await writeFeed(cache, FEED, [], AT);

    expect(meta.count).toBe(0);
    expect(await readFeedHosts(cache, FEED.id, meta.generation)).toEqual([]);
  });
});

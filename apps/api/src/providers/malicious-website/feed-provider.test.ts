/**
 * C61.5: the feed-list provider over the feeds the refresh job stored: a `domains` feed lists a host
 * or a parent, a `urls` feed the exact host; a listing on a fresh feed is `listed` with its
 * category; a feed never loaded or older than twice its interval makes the answer `stale`; no feed
 * at all is `no_feeds`; each generation is read once; a failing store is a retryable error.
 */
import { describe, expect, it } from 'vitest';
import type { KeyValueCache } from '../../ports.js';
import {
  createInMemoryKeyValueCache,
  fixedClock,
  type TestClock,
} from '../../test-support/fakes.js';
import { ProviderError } from '../errors.js';
import { createFeedListProvider } from './feed-provider.js';
import type { MaliciousFeed, MaliciousFeedList } from './feed-list.js';
import { writeFeed } from './store.js';

const AT = new Date('2026-10-24T09:00:00.000Z');

const feed = (id: string, overrides: Partial<MaliciousFeed> = {}): MaliciousFeed => ({
  id,
  url: `https://feeds.example.test/${id}.txt`,
  format: 'domains',
  category: 'phishing',
  refresh_interval_seconds: 3600,
  terms: 'Synthetic test feed.',
  ...overrides,
});

const PHISHING = feed('synthetic-phishing');
const MALWARE = feed('synthetic-malware', { category: 'malware', format: 'urls' });
const LIST: MaliciousFeedList = { schema_version: 1, feeds: [PHISHING, MALWARE] };

/** A cache that counts its `get`s of entries keys. */
function counting(cache: KeyValueCache) {
  let entryReads = 0;
  return {
    reads: () => entryReads,
    cache: {
      ...cache,
      get: (key: string) => {
        if (key.includes(':entries:')) {
          entryReads += 1;
        }
        return cache.get(key);
      },
    } satisfies KeyValueCache,
  };
}

async function loaded(clock: TestClock = fixedClock(AT)) {
  const cache = createInMemoryKeyValueCache(clock);
  await writeFeed(cache, PHISHING, ['phish.example', 'parent.example'], clock.now());
  await writeFeed(cache, MALWARE, ['exact.example'], clock.now());
  return { cache, clock };
}

const check = (provider: ReturnType<typeof createFeedListProvider>, host: string) =>
  provider.check({ host, url: `https://${host}/` });

describe('the feed-list provider (C61.5)', () => {
  it('answers no_feeds while the list holds no feed', async () => {
    const provider = createFeedListProvider({
      feeds: { schema_version: 1, feeds: [] },
      cache: createInMemoryKeyValueCache(),
    });

    expect(provider).toMatchObject({ id: 'feed-list', sandbox: false });
    expect(await check(provider, 'phish.example')).toEqual({ outcome: 'no_feeds' });
    expect(await check(createFeedListProvider({}), 'phish.example')).toEqual({
      outcome: 'no_feeds',
    });
  });

  it('lists a host a domains feed lists, or one whose parent it lists, with the feed’s category', async () => {
    const { cache, clock } = await loaded();
    const provider = createFeedListProvider({ feeds: LIST, cache, clock });

    expect(await check(provider, 'phish.example')).toEqual({
      outcome: 'listed',
      categories: ['phishing'],
      feeds: ['synthetic-phishing'],
    });
    expect(await check(provider, 'login.www.parent.example')).toEqual({
      outcome: 'listed',
      categories: ['phishing'],
      feeds: ['synthetic-phishing'],
    });
  });

  it('lists only the exact host of a urls feed', async () => {
    const { cache, clock } = await loaded();
    const provider = createFeedListProvider({ feeds: LIST, cache, clock });

    expect(await check(provider, 'exact.example')).toEqual({
      outcome: 'listed',
      categories: ['malware'],
      feeds: ['synthetic-malware'],
    });
    expect(await check(provider, 'shop.exact.example')).toEqual({
      outcome: 'not_listed',
      feeds: ['synthetic-phishing', 'synthetic-malware'],
    });
  });

  it('never matches a top-level domain alone', async () => {
    const clock = fixedClock(AT);
    const cache = createInMemoryKeyValueCache(clock);
    await writeFeed(cache, PHISHING, ['example'], AT);
    const provider = createFeedListProvider({
      feeds: { schema_version: 1, feeds: [PHISHING] },
      cache,
      clock,
    });

    expect(await check(provider, 'utopia.example')).toMatchObject({ outcome: 'not_listed' });
  });

  it('answers stale while a feed was never loaded or is older than twice its interval', async () => {
    const clock = fixedClock(AT);
    const cache = createInMemoryKeyValueCache(clock);
    await writeFeed(cache, PHISHING, ['phish.example'], AT);
    const provider = createFeedListProvider({ feeds: LIST, cache, clock });

    expect(await check(provider, 'utopia.example')).toEqual({
      outcome: 'stale',
      feeds: ['synthetic-malware'],
    });
    await writeFeed(cache, MALWARE, ['exact.example'], AT);
    clock.advance(2 * 3600 * 1000 + 1);
    expect(await check(provider, 'utopia.example')).toEqual({
      outcome: 'stale',
      feeds: ['synthetic-phishing', 'synthetic-malware'],
    });
  });

  it('lists a host a fresh feed lists even while another is stale', async () => {
    const clock = fixedClock(AT);
    const cache = createInMemoryKeyValueCache(clock);
    await writeFeed(cache, PHISHING, ['phish.example'], AT);
    const provider = createFeedListProvider({ feeds: LIST, cache, clock });

    expect(await check(provider, 'phish.example')).toEqual({
      outcome: 'listed',
      categories: ['phishing'],
      feeds: ['synthetic-phishing'],
    });
  });

  it('reads each generation once, and the new one after a refresh', async () => {
    const { cache: store, clock } = await loaded();
    const counted = counting(store);
    const provider = createFeedListProvider({ feeds: LIST, cache: counted.cache, clock });

    await check(provider, 'phish.example');
    await check(provider, 'utopia.example');
    expect(counted.reads()).toBe(2);
    await writeFeed(store, PHISHING, ['newer.example'], clock.now());
    expect(await check(provider, 'newer.example')).toMatchObject({ outcome: 'listed' });
    expect(counted.reads()).toBe(3);
  });

  it('fails retryably while the store is down, and answers stale without a store', async () => {
    const { cache, clock } = await loaded();
    const provider = createFeedListProvider({ feeds: LIST, cache, clock });
    cache.failNext(new Error('Valkey is unavailable (reconnecting)'));

    const error = await check(provider, 'phish.example').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ code: 'feed_store_unavailable', retryable: true });
    expect(await check(createFeedListProvider({ feeds: LIST, clock }), 'phish.example')).toEqual({
      outcome: 'stale',
      feeds: ['synthetic-phishing', 'synthetic-malware'],
    });
  });
});

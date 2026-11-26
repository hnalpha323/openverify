/**
 * C61.5, C63: the malicious-website factory builds the feed-list provider over the operator's
 * feeds and the cache, or the sandbox provider.
 */
import { describe, expect, it } from 'vitest';
import { createInMemoryKeyValueCache, fixedClock } from '../../test-support/fakes.js';
import { createMaliciousWebsiteProvider } from './index.js';
import { writeFeed } from './store.js';

describe('createMaliciousWebsiteProvider (C61.5)', () => {
  it('builds the feed-list provider over the feeds and the cache', async () => {
    const clock = fixedClock();
    const cache = createInMemoryKeyValueCache(clock);
    const feed = {
      id: 'synthetic-phishing',
      url: 'https://feeds.example.test/phishing.txt',
      format: 'domains' as const,
      category: 'phishing' as const,
      refresh_interval_seconds: 3600,
      terms: 'Synthetic test feed.',
    };
    await writeFeed(cache, feed, ['phish.example'], clock.now());
    const provider = createMaliciousWebsiteProvider('feed-list', {
      feeds: { schema_version: 1, feeds: [feed] },
      cache,
      clock,
    });

    expect(provider).toMatchObject({ id: 'feed-list', sandbox: false });
    expect(
      await provider.check({ host: 'phish.example', url: 'https://phish.example/' }),
    ).toMatchObject({ outcome: 'listed' });
  });

  it('builds the sandbox provider', async () => {
    const provider = createMaliciousWebsiteProvider('sandbox');

    expect(provider).toMatchObject({ id: 'sandbox', sandbox: true });
    expect(
      await provider.check({ host: 'malicious.example', url: 'https://malicious.example/' }),
    ).toMatchObject({ outcome: 'listed' });
  });
});

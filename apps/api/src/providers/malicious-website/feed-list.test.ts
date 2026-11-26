/**
 * C61.5: the operator's malicious-website feeds, `data/malicious-feeds.json`. The file ships with
 * no feed (no feed is licensed for this use and useful worldwide); an operator adds feeds whose
 * terms they accept. The schema refuses what the refresh job could not fetch safely, and its
 * messages name the member, never a URL (a feed URL can carry an Auth-Key).
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MaliciousFeedListError,
  defaultMaliciousFeedListPath,
  loadMaliciousFeedList,
  maliciousFeedListSchema,
} from './feed-list.js';

const FEED = {
  id: 'operator-phishing',
  url: 'https://feeds.example.test/exports/synthetic-auth-key/recent.txt',
  format: 'domains',
  category: 'phishing',
  refresh_interval_seconds: 3600,
  terms: 'Accepted the feed terms for commercial use on 2026-10-23.',
};

async function written(content: string): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'openverify-feeds-'));
  const path = join(folder, 'malicious-feeds.json');
  await writeFile(path, content);
  return path;
}

describe('data/malicious-feeds.json (C61.5)', () => {
  it('ships with no feed', async () => {
    const list = await loadMaliciousFeedList(defaultMaliciousFeedListPath());
    expect(list.schema_version).toBe(1);
    expect(list.feeds).toEqual([]);
  });

  it('takes an operator feed with its format, category, interval and terms', () => {
    expect(maliciousFeedListSchema.parse({ schema_version: 1, feeds: [FEED] }).feeds).toEqual([
      FEED,
    ]);
  });

  it.each([
    ['plain http', { url: 'http://feeds.example.test/list.txt' }],
    ['credentials in the URL', { url: 'https://user:pass@feeds.example.test/list.txt' }],
    ['an unknown format', { format: 'csv' }],
    ['an unknown category', { category: 'spam-source' }],
    ['a refresh more often than every 5 minutes', { refresh_interval_seconds: 60 }],
    ['a refresh less often than weekly', { refresh_interval_seconds: 700_000 }],
    ['no terms', { terms: '' }],
    ['an id that is not a slug', { id: 'Operator Feed' }],
    ['an unknown member', { auth_key: 'synthetic-auth-key' }],
  ])('refuses a feed with %s', (_case, patch) => {
    expect(
      maliciousFeedListSchema.safeParse({ schema_version: 1, feeds: [{ ...FEED, ...patch }] })
        .success,
    ).toBe(false);
  });

  it('refuses two feeds with one id, and another schema version', () => {
    expect(
      maliciousFeedListSchema.safeParse({ schema_version: 1, feeds: [FEED, FEED] }).success,
    ).toBe(false);
    expect(maliciousFeedListSchema.safeParse({ schema_version: 2, feeds: [] }).success).toBe(false);
  });

  it('reads a missing file as no feed, and refuses a malformed one without echoing it', async () => {
    expect((await loadMaliciousFeedList('/nonexistent/openverify/feeds.json')).feeds).toEqual([]);
    const path = await written(
      JSON.stringify({
        schema_version: 1,
        feeds: [{ ...FEED, url: 'http://secret.example.test/k' }],
      }),
    );
    const error: unknown = await loadMaliciousFeedList(path).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MaliciousFeedListError);
    expect(String(error)).toContain('feeds.0.url');
    expect(String(error)).not.toContain('secret.example.test');
    await expect(loadMaliciousFeedList(await written('not json'))).rejects.toThrow(
      MaliciousFeedListError,
    );
  });
});

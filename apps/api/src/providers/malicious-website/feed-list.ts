/**
 * C61.5: the operator's malicious-website feeds, `data/malicious-feeds.json`. It ships empty:
 * no feed is both licensed for this use (rule 4) and useful worldwide (URLhaus needs an Auth-Key
 * and may need a subscription; Safe Browsing and OpenPhish Community are non-commercial;
 * `THIRD_PARTY_LICENSES.md` §4.2). An operator adds feeds whose terms they accept.
 *
 * Workflow 5B Stage 1 (`contracts-5b`) fixed the schema here (stub: refuses every file until the
 * next commit); `api-kyb` owns this folder.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeUrl } from '@openverify/contracts';
import { z } from 'zod';

/** A malformed feed list (its issue paths, never a value: a feed URL can carry a key). */
export class MaliciousFeedListError extends Error {
  override name = 'MaliciousFeedListError';
}

/** C61.5: what a feed lists. */
export const MALICIOUS_FEED_CATEGORIES = ['malware', 'phishing', 'spam_source'] as const;

/** At most this many feeds; each refreshed every 5 minutes to weekly. */
export const MAX_MALICIOUS_FEEDS = 32;
export const MALICIOUS_FEED_REFRESH_SECONDS = Object.freeze({ min: 300, max: 604_800 });

const httpsUrl = z.string().refine((value) => {
  const url = safeUrl(value);
  return url !== null && url.protocol === 'https:' && url.username === '' && url.password === '';
}, 'must be an https URL without credentials');

export const maliciousFeedSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,31}$/, 'must be a lower-case slug'),
  /** Fetched through the outbound client (C54.6); it may carry the operator's key in its path. */
  url: httpsUrl,
  /** `domains`: the domain and its parents match; `urls`: the exact host only (C61.5). */
  format: z.enum(['domains', 'urls']),
  category: z.enum(MALICIOUS_FEED_CATEGORIES),
  refresh_interval_seconds: z
    .int()
    .min(MALICIOUS_FEED_REFRESH_SECONDS.min)
    .max(MALICIOUS_FEED_REFRESH_SECONDS.max),
  /** The operator's note of the terms they accepted for this feed. */
  terms: z.string().min(1).max(500),
});
export type MaliciousFeed = z.infer<typeof maliciousFeedSchema>;

/** The schema of `data/malicious-feeds.json`. */
export const maliciousFeedListSchema = z
  .strictObject({
    schema_version: z.literal(1),
    description: z.string().max(2000).optional(),
    feeds: z.array(maliciousFeedSchema).max(MAX_MALICIOUS_FEEDS).readonly(),
  })
  .refine((list) => new Set(list.feeds.map((feed) => feed.id)).size === list.feeds.length, {
    message: 'each feed has its own id',
    path: ['feeds'],
  });
export type MaliciousFeedList = z.infer<typeof maliciousFeedListSchema>;

/**
 * Where the feed list is: `data/` at the repository (or image) root, five levels above this
 * module whether it runs from `src/providers/malicious-website` or `dist/…`.
 */
export function defaultMaliciousFeedListPath(): string {
  return join(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..'),
    'data',
    'malicious-feeds.json',
  );
}

/**
 * Reads and checks the feed list at `path`; a missing file is no feed (the check then answers
 * `provider_not_configured`).
 * @throws {MaliciousFeedListError} for a file that is not a valid feed list, naming the paths at
 *   fault, never their values.
 */
export async function loadMaliciousFeedList(path: string): Promise<MaliciousFeedList> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return { schema_version: 1, feeds: [] };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new MaliciousFeedListError('The malicious-website feed list is not JSON');
  }
  const parsed = maliciousFeedListSchema.safeParse(json);
  if (!parsed.success) {
    const paths = parsed.error.issues.map((issue) => issue.path.map(String).join('.'));
    throw new MaliciousFeedListError(
      `The malicious-website feed list is invalid at ${[...new Set(paths)].join(', ')}`,
    );
  }
  return parsed.data;
}

/**
 * C61.5, C63: the malicious-website provider, bound by
 * `OPENVERIFY_PROVIDER_MALICIOUS_WEBSITE_{SANDBOX,PRODUCTION}` in the worker: `feed-list` (the
 * operator's feeds in `data/malicious-feeds.json`, refreshed by the repeatable job into Valkey)
 * or `sandbox` (sandbox environments, C61.6); unset means unbound (`provider_not_configured`).
 * The feed list ships empty.
 *
 * Workflow 5B Stage 1 (`contracts-5b`) wrote the feed list's schema and loader (`feed-list.ts`);
 * `api-kyb` (Stage 3) built the providers (`feed-provider.ts`, `sandbox.ts`) and the store the
 * refresh job writes (`store.ts`).
 */
import type { Clock, KeyValueCache, MaliciousWebsiteProvider } from '../../ports.js';
import { createFeedListProvider } from './feed-provider.js';
import type { MaliciousFeedList } from './feed-list.js';
import { createSandboxMaliciousWebsiteProvider } from './sandbox.js';

export * from './feed-list.js';

export interface MaliciousWebsiteOptions {
  /** The operator's feeds (`data/malicious-feeds.json`), for `feed-list`. */
  feeds?: MaliciousFeedList | undefined;
  /** C61.5: where the refresh job keeps each feed's entries and last refresh. */
  cache?: KeyValueCache | undefined;
  clock?: Clock | undefined;
}

/** The provider `name` binds. */
export function createMaliciousWebsiteProvider(
  name: 'feed-list' | 'sandbox',
  options: MaliciousWebsiteOptions = {},
): MaliciousWebsiteProvider {
  return name === 'sandbox'
    ? createSandboxMaliciousWebsiteProvider()
    : createFeedListProvider({ feeds: options.feeds, cache: options.cache, clock: options.clock });
}

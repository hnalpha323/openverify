/**
 * C54.1 (5B Stage 1): the registry schedules a Phase 5 repeatable job only when the operator
 * turned its feature on: the feed refresh for a loaded feed list that holds a feed (C61.5), the
 * trust-store refresh with `OPENVERIFY_TRUST_ANCHOR_REFRESH=true` (C62.7).
 */
import type { Db } from '@openverify/db';
import { describe, expect, it } from 'vitest';
import type { MaliciousFeedList } from '../../providers/malicious-website/feed-list.js';
import { INQUIRY_EXPIRY_QUEUE } from '../inquiry-expiry.js';
import { RETENTION_QUEUE } from '../retention.js';
import { createCapturingLogger } from '../testing.js';
import { MALICIOUS_FEED_REFRESH_INTERVAL_MS, MALICIOUS_FEED_REFRESH_QUEUE } from './feeds.js';
import { createRecordingQueue } from '../../test-support/fakes.js';
import { phase5RepeatableJobs, type RepeatableJobDeps } from './index.js';
import {
  SUBMITTED_VERIFICATION_SWEEP_INTERVAL_MS,
  SUBMITTED_VERIFICATION_SWEEP_QUEUE,
} from './submitted-verifications.js';
import { TRUST_ANCHOR_REFRESH_INTERVAL_MS, TRUST_ANCHOR_REFRESH_QUEUE } from './trust-anchors.js';

const ONE_FEED: MaliciousFeedList = {
  schema_version: 1,
  feeds: [
    {
      id: 'synthetic-phishing',
      url: 'https://feeds.example.test/phishing.txt',
      format: 'domains',
      category: 'phishing',
      refresh_interval_seconds: 3600,
      terms: 'Synthetic test feed.',
    },
  ],
};

function deps(overrides: Partial<RepeatableJobDeps> = {}): RepeatableJobDeps {
  return {
    db: {} as Db,
    clock: { now: () => new Date('2026-10-23T00:00:00Z') },
    logger: createCapturingLogger(),
    ...overrides,
  };
}

const schedules = (options: Partial<RepeatableJobDeps>) =>
  phase5RepeatableJobs(deps(options)).map(({ name, repeat }) => ({ name, repeat }));

describe('phase5RepeatableJobs', () => {
  it('schedules nothing while no feature is on', () => {
    expect(schedules({})).toEqual([]);
    expect(schedules({ nfc: { allowIcaoCrls: true, trustAnchorRefresh: false } })).toEqual([]);
    expect(schedules({ maliciousFeeds: { schema_version: 1, feeds: [] } })).toEqual([]);
  });

  it('refreshes the feeds every five minutes once the list holds one (C61.5)', () => {
    expect(MALICIOUS_FEED_REFRESH_INTERVAL_MS).toBe(300_000);
    expect(schedules({ maliciousFeeds: ONE_FEED })).toEqual([
      { name: MALICIOUS_FEED_REFRESH_QUEUE, repeat: { every: 300_000 } },
    ]);
  });

  it('refreshes the trust store only with OPENVERIFY_TRUST_ANCHOR_REFRESH=true (C62.7)', () => {
    expect(schedules({ nfc: { allowIcaoCrls: false, trustAnchorRefresh: true } })).toEqual([
      { name: TRUST_ANCHOR_REFRESH_QUEUE, repeat: { every: TRUST_ANCHOR_REFRESH_INTERVAL_MS } },
    ]);
  });

  it('lists the feed refresh before the trust refresh, on queues of their own', () => {
    const names = phase5RepeatableJobs(
      deps({
        maliciousFeeds: ONE_FEED,
        nfc: { allowIcaoCrls: false, trustAnchorRefresh: true },
      }),
    ).map((job) => job.name);

    expect(names).toEqual(['malicious-feed-refresh', 'trust-anchor-refresh']);
    expect(new Set([...names, INQUIRY_EXPIRY_QUEUE, RETENTION_QUEUE]).size).toBe(names.length + 2);
  });

  it('sweeps verifications left submitted every minute when the worker has a verification queue (Workflow 5C review K1)', () => {
    expect(schedules({ verificationQueue: createRecordingQueue() })).toEqual([
      {
        name: SUBMITTED_VERIFICATION_SWEEP_QUEUE,
        repeat: { every: SUBMITTED_VERIFICATION_SWEEP_INTERVAL_MS },
      },
    ]);
    const names = phase5RepeatableJobs(
      deps({
        verificationQueue: createRecordingQueue(),
        maliciousFeeds: ONE_FEED,
        nfc: { allowIcaoCrls: false, trustAnchorRefresh: true },
      }),
    ).map((job) => job.name);
    expect(names).toEqual([
      'submitted-verification-sweep',
      'malicious-feed-refresh',
      'trust-anchor-refresh',
    ]);
  });

  it('logs nothing when it schedules nothing', () => {
    const logger = createCapturingLogger();
    phase5RepeatableJobs(deps({ logger }));
    expect(logger.entries).toEqual([]);
  });
});

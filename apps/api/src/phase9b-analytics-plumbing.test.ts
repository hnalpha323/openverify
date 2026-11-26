/**
 * Workflow 9B Stage 1b, checkpoint (A): the analytics plumbing `foundation-9b` freezes for
 * `api-analytics` (C163.2-C163.6, C164.8, C174.3-C174.5):
 *
 * - the six aggregate routes, under `analytics:read`, each counted by the `analytics` policy before
 *   anything else and answering its document (built by `api-analytics`), listed in the OpenAPI
 *   document with the contract's query and answer;
 * - the redaction hook, called in the redaction's transaction before anything is cleared (H04);
 * - the retention hook, whose counts join the C16 report;
 * - the settings hook, called with both sides of a change of the reporting zone;
 * - the built hooks, which record and delete nothing for an inquiry or rows that do not exist.
 *
 * Every value is synthetic.
 */
import { RATE_LIMIT_DEFAULTS, RATE_LIMIT_POLICY_WINDOWS } from '@openverify/contracts';
import { getInquiry, type Db } from '@openverify/db';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from './jobs/testing.js';
import type { RateLimiter } from './ports.js';
import * as analyticsRedaction from './services/analytics/redaction.js';
import * as analyticsRetention from './services/analytics/retention.js';
import * as analyticsSettings from './services/analytics/settings-hook.js';
import { forgetAnalyticsAssigneeInTx } from './services/analytics/assignees.js';
import { createInquiryTestApi, type InquiryTestApi } from './services/inquiries.test-support.js';
import { createRedactionService } from './services/redaction.js';
import { runRetention } from './services/retention.js';
import { updateDashboardSettings } from './services/settings.js';
import { bearer, createInquiry } from './test-support/harness.js';
import {
  createRecordingAuditLogger,
  createRecordingEventPublisher,
  fixedClock,
} from './test-support/fakes.js';

vi.mock('./services/analytics/redaction.js', { spy: true });
vi.mock('./services/analytics/retention.js', { spy: true });
vi.mock('./services/analytics/settings-hook.js', { spy: true });

const WINDOW = 'filter[from]=2026-10-01&filter[to]=2026-10-31';
const READS = ['inquiries', 'funnel', 'verifications', 'checks', 'cases', 'signals'] as const;

/** Refuses only the keys of `policy`; every other count passes, as Valkey would. */
function refusing(policy: string): RateLimiter {
  return {
    consume: (key, rule) =>
      Promise.resolve({
        allowed: !key.startsWith(`${policy}:`),
        limit: rule.limit,
        remaining: 0,
        resetAt: new Date(0),
        retryAfterSeconds: key.startsWith(`${policy}:`) ? 30 : 0,
      }),
  };
}

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('the aggregate routes, frozen for api-analytics (C164.8)', () => {
  it.each(READS)('GET /analytics/%s answers its document, built (api-analytics)', async (read) => {
    const response = await api.app.inject({
      url: `/api/v1/analytics/${read}?${WINDOW}`,
      headers: bearer(api.token),
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<{ data: { type: string } }>().data.type).toBe(`analytics-${read}`);
  });

  it('needs analytics:read, which inquiries:read does not give', async () => {
    const token = await api.newApiKey(api.environmentId, { scopes: ['inquiries:read'] });
    const response = await api.app.inject({
      url: `/api/v1/analytics/inquiries?${WINDOW}`,
      headers: bearer(token),
    });
    expect(response.statusCode, response.body).toBe(403);
  });

  it('reads the contract’s query: local dates, at most 400 days, no unknown filter', async () => {
    for (const query of [
      'filter[from]=2025-01-01&filter[to]=2026-10-31',
      'filter[from]=2026-10-31&filter[to]=2026-10-01',
      `${WINDOW}&filter[reference-id]=synthetic`,
      // `filter[tag]` is the inquiries answer's alone (B15).
      `${WINDOW}&filter[tag]=vip`,
    ]) {
      const response = await api.app.inject({
        url: `/api/v1/analytics/funnel?${query}`,
        headers: bearer(api.token),
      });
      expect(response.statusCode, query).toBe(400);
    }
  });

  it('lists them in the OpenAPI document with the contract’s answers', async () => {
    const { paths } = (await api.app.inject({ url: '/openapi.json' })).json<{
      paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
    }>();
    for (const read of READS) {
      const operation = paths[`/api/v1/analytics/${read}`]?.get;
      expect(operation, read).toBeDefined();
      expect(Object.keys(operation?.responses ?? {}), read).toEqual(
        expect.arrayContaining(['200', '400', '401', '403', '429']),
      );
    }
  });
});

describe('the analytics policy (C174.4)', () => {
  it('is 60 a minute per principal, and refuses a read with 429 before anything else', async () => {
    const policy = 'analytics';
    expect((RATE_LIMIT_DEFAULTS as Readonly<Record<string, number>>)[policy]).toBe(60);
    expect((RATE_LIMIT_POLICY_WINDOWS as Readonly<Record<string, number>>)[policy]).toBe(60);
    const limited = await createInquiryTestApi({ rateLimiter: refusing(policy) });
    try {
      const response = await limited.app.inject({
        url: `/api/v1/analytics/checks?${WINDOW}`,
        headers: bearer(limited.token),
      });
      expect(response.statusCode, response.body).toBe(429);
      expect(response.headers['retry-after']).toBe('30');
    } finally {
      await limited.close();
    }
  });

  it('counts the principal, not the environment', async () => {
    const keys: string[] = [];
    const counting = await createInquiryTestApi({
      rateLimiter: {
        consume: (key, rule) => {
          keys.push(key);
          return Promise.resolve({
            allowed: true,
            limit: rule.limit,
            remaining: rule.limit,
            resetAt: new Date(0),
            retryAfterSeconds: 0,
          });
        },
      },
    });
    try {
      await counting.app.inject({
        url: `/api/v1/analytics/signals?${WINDOW}`,
        headers: bearer(counting.token),
      });
      const analytics = keys.filter((key) => key.startsWith('analytics:'));
      expect(analytics).toHaveLength(1);
      expect(analytics[0]).toMatch(/^analytics:key_[0-9A-HJKMNP-TV-Z]{26}$/);
    } finally {
      await counting.close();
    }
  });
});

describe("the redaction records the inquiry's contribution first (C163.4; H04)", () => {
  it('calls the hook in its own transaction, before the inquiry is redacted, once per redaction', async () => {
    const inquiryId = await createInquiry(api);
    const service = createRedactionService({
      db: api.database.db,
      storage: createMemoryStorage(),
      events: createRecordingEventPublisher(),
      clock: fixedClock(),
      audit: createRecordingAuditLogger(),
    });
    const seen: (Date | null | undefined)[] = [];
    vi.mocked(analyticsRedaction.recordRedactedContributionInTx).mockImplementation(
      async (tx, input) => {
        // In the redaction's transaction, before its records are cleared.
        seen.push((await getInquiry(tx, input.environmentId, input.inquiryId))?.redactedAt);
      },
    );
    const ctx = { environmentId: api.environmentId, organizationId: api.organizationId };
    const actor = { type: 'api-key' as const, id: 'key_01M5CJXHG07XPHF3HRM6NREDH8' };

    await service.redactInquiry(ctx, inquiryId, actor);

    expect(seen).toEqual([null]);
    expect(analyticsRedaction.recordRedactedContributionInTx).toHaveBeenCalledWith(
      expect.anything(),
      { environmentId: api.environmentId, inquiryId, at: fixedClock().now() },
    );
    const stored = await getInquiry(api.database.db, api.environmentId, inquiryId);
    expect(stored?.redactedAt).not.toBeNull();
  });

  it('rolls the redaction back when the hook throws', async () => {
    const inquiryId = await createInquiry(api);
    const service = createRedactionService({
      db: api.database.db,
      storage: createMemoryStorage(),
      events: createRecordingEventPublisher(),
      clock: fixedClock(),
    });
    vi.mocked(analyticsRedaction.recordRedactedContributionInTx).mockRejectedValueOnce(
      new Error('synthetic rollup failure'),
    );
    const ctx = { environmentId: api.environmentId, organizationId: api.organizationId };

    await expect(service.redactInquiry(ctx, inquiryId, null)).rejects.toThrow(
      'synthetic rollup failure',
    );
    const stored = await getInquiry(api.database.db, api.environmentId, inquiryId);
    expect(stored?.redactedAt).toBeNull();
  });
});

describe('the C16 pass runs the analytics retention (C163.6; review P20)', () => {
  it('calls the hook once with the run’s now and batch, and reports its counts', async () => {
    vi.mocked(analyticsRetention.runAnalyticsRetention).mockResolvedValueOnce({
      deletedAnalyticsRollupRows: 7,
      deletedAnalyticsAssigneeRows: 2,
    });
    const clock = fixedClock();
    const report = await runRetention({
      db: api.database.db,
      redaction: api.redaction,
      storage: createMemoryStorage(),
      clock,
      batchSize: 50,
    });
    expect(analyticsRetention.runAnalyticsRetention).toHaveBeenCalledTimes(1);
    expect(analyticsRetention.runAnalyticsRetention).toHaveBeenCalledWith(
      { db: api.database.db },
      { now: clock.now(), limit: 50 },
    );
    expect(report).toMatchObject({
      deletedAnalyticsRollupRows: 7,
      deletedAnalyticsAssigneeRows: 2,
    });
  });
});

describe('the settings change calls the analytics hook with both sides (C163.2)', () => {
  it('passes the environment and its settings before and after, in the change’s transaction', async () => {
    const tenant = await api.newTenant();
    const seen: { environmentId: string; before: unknown; after: unknown }[] = [];
    vi.mocked(analyticsSettings.onAnalyticsSettingsChangedInTx).mockImplementation(
      (_tx: Db, environmentId, before, after) => {
        seen.push({
          environmentId,
          before: before['analytics-time-zone'] ?? null,
          after: after['analytics-time-zone'] ?? null,
        });
        return Promise.resolve();
      },
    );
    const ctx = { environmentId: tenant.environmentId, organizationId: tenant.organizationId };
    const actor = { type: 'user' as const, id: 'usr_01M5CJXHG07XPHF3HRM6NREDH8' };
    const audit = createRecordingAuditLogger();

    await updateDashboardSettings(
      api.database.db,
      audit,
      ctx,
      actor,
      { 'analytics-time-zone': 'Europe/Paris' },
      100,
    );
    await updateDashboardSettings(
      api.database.db,
      audit,
      ctx,
      actor,
      { 'analytics-time-zone': 'America/New_York' },
      100,
    );

    expect(seen).toEqual([
      { environmentId: tenant.environmentId, before: null, after: 'Europe/Paris' },
      { environmentId: tenant.environmentId, before: 'Europe/Paris', after: 'America/New_York' },
    ]);
  });
});

describe('the built hooks record and delete nothing for what does not exist (api-analytics)', () => {
  it('leave redaction, retention, settings and the assignee rows as they are', async () => {
    const { db } = api.database;
    const environmentId = api.environmentId;
    const real = await vi.importActual<typeof analyticsRedaction>(
      './services/analytics/redaction.js',
    );
    const retention = await vi.importActual<typeof analyticsRetention>(
      './services/analytics/retention.js',
    );
    const settings = await vi.importActual<typeof analyticsSettings>(
      './services/analytics/settings-hook.js',
    );
    await expect(
      real.recordRedactedContributionInTx(db, {
        environmentId,
        inquiryId: 'inq_01M5CK16P0D13FXHZSS4TCFBVH',
        at: new Date(0),
      }),
    ).resolves.toBeUndefined();
    await expect(
      retention.runAnalyticsRetention({ db }, { now: new Date(0), limit: 500 }),
    ).resolves.toEqual({ deletedAnalyticsRollupRows: 0, deletedAnalyticsAssigneeRows: 0 });
    await expect(
      settings.onAnalyticsSettingsChangedInTx(db, environmentId, {}, {}),
    ).resolves.toBeUndefined();
    await expect(
      forgetAnalyticsAssigneeInTx(db, {
        organizationId: api.organizationId,
        userId: 'usr_01M5CJXHG07XPHF3HRM6NREDH8',
      }),
    ).resolves.toBeUndefined();
  });
});

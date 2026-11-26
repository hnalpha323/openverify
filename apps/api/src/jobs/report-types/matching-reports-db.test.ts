/**
 * C69.4, C78.3, C79, C80.5 (Workflow 6A Stage 3, `api-reports`): the four matching report jobs
 * end to end on the database: the sandbox lists imported by `api-watchlists`' sync (its real
 * keys, identifiers and crypto rows), retrieval through the real frozen reads, the run framework
 * persisting the matches, and the served resource of each type checked against its contract
 * schema. Synthetic lists and fictional persons only.
 */
import { fileURLToPath } from 'node:url';
import { reportResourceSchema } from '@openverify/contracts';
import type { ReportType } from '@openverify/core';
import { createReport, getReport } from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  seedReportTemplate,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { keysVersion, matcherVersion, variantGroupsFrom } from '@openverify/watchlist';
import {
  FIXTURES_DIRECTORY,
  OPENVERIFY_SANDBOX_PEP_SOURCE,
  OPENVERIFY_SANDBOX_SOURCE,
  SANDBOX_PEP_MAGIC,
  SANDBOX_WATCHLIST_MAGIC,
} from '@openverify/watchlist/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { UNMASKED } from '../../auth/pii.js';
import { PHASE6_DEFAULTS, type WatchlistSettings } from '../../config.js';
import { reportResourceOf } from '../../services/reports/reports.js';
import { createRecordingEventPublisher, fixedClock } from '../../test-support/fakes.js';
import type { MatcherData } from '../../watchlists/matcher-data.js';
import { reconcileWatchlistSources } from '../../watchlists/reconcile.js';
import { sharedWatchlistSession, syncWatchlistSource } from '../../watchlists/sync.js';
import { createWorkerLogger } from '../logger.js';
import { createReportRunProcessor, type ReportRunProcessorDeps } from '../reports/run.js';
import { useScreeningKit } from '../reports/screening.js';

const SHA = 'cd'.repeat(32);
const GROUPS = variantGroupsFrom([], SHA);
const MATCHER: MatcherData = { status: 'loaded', groups: GROUPS, keysVersion: keysVersion(SHA) };
const SETTINGS: WatchlistSettings = {
  sourcesDisabled: [],
  refresh: false,
  removedRetentionDays: 90,
  euFsfToken: null,
  wikidataUserAgent: null,
  wikidataSparqlUrl: PHASE6_DEFAULTS.wikidataSparqlUrl,
  pep: {
    openTenureMaxYears: 20,
    includeRelatives: false,
    retentionMonths: 12,
    headRetentionMonths: 60,
  },
};
const silent = createWorkerLogger({ level: 'silent' });
const clock = fixedClock();

let database: TestDatabase;
let sandboxId: string;
let productionId: string;
let restore: () => void;

beforeAll(async () => {
  database = await createTestDatabase();
  const tenant = await createTestTenant(database.db);
  sandboxId = tenant.environment.id;
  productionId = (await createTestTenant(database.db, { kind: 'production' })).environment.id;
  await reconcileWatchlistSources(database.db, { disabled: [] });
  for (const [sourceId, file] of [
    [OPENVERIFY_SANDBOX_SOURCE, 'openverify-sandbox.json'],
    [OPENVERIFY_SANDBOX_PEP_SOURCE, 'openverify-sandbox-pep.json'],
  ] as const) {
    const result = await syncWatchlistSource(
      {
        db: database.db,
        connect: sharedWatchlistSession(database.db),
        clock,
        logger: silent,
        settings: SETTINGS,
        matcherData: () => MATCHER,
      },
      { sourceId, actor: 'seed', importPath: fileURLToPath(new URL(file, FIXTURES_DIRECTORY)) },
    );
    expect(result.outcome).toBe('applied');
  }
  restore = useScreeningKit({ groups: () => GROUPS });
}, 120_000);

afterAll(async () => {
  restore();
  await database.close();
});

function deps(): ReportRunProcessorDeps {
  return {
    db: database.db,
    clock,
    logger: silent,
    events: createRecordingEventPublisher(),
    keyring: database.keyring,
    blindIndexKey: new Uint8Array(32).fill(0x3d),
    watchlists: SETTINGS,
    limits: { perMinute: 600, maxRecurringPerEnvironment: 250_000, maxMediaRunsPerDay: 8_640 },
  };
}

/** Creates a report of `type` and runs its initial run with the registered jobs. */
async function screened(
  type: ReportType,
  query: Record<string, unknown>,
  config: Record<string, unknown> = {},
  environmentId = sandboxId,
) {
  const lists =
    type === 'politically-exposed-person'
      ? [OPENVERIFY_SANDBOX_PEP_SOURCE]
      : [OPENVERIFY_SANDBOX_SOURCE];
  const { templateId, versionId } = await seedReportTemplate(database.db, environmentId, {
    reportType: type,
    config: { 'search-lists': lists, ...config },
  });
  const runId = testId('rpr');
  const report = await createReport(database.db, environmentId, {
    id: testId('rep'),
    reportType: type,
    reportTemplateId: templateId,
    reportTemplateVersionId: versionId,
    origin: 'api',
    query,
    querySources: Object.fromEntries(Object.keys(query).map((key) => [key, 'request'])),
    inquiryId: null,
    accountId: null,
    recurrenceIntervalDays: null,
    nextRunAt: null,
    createdAt: clock.now(),
    initialRun: { id: runId, scheduledFor: clock.now() },
  });
  const outcome = await createReportRunProcessor()(
    { environmentId, reportId: report.id, runId },
    deps(),
    { lastAttempt: false },
  );
  const stored = await getReport(database.db, environmentId, report.id);
  if (stored === null) {
    throw new Error('the report is gone');
  }
  const resource = reportResourceSchema.parse(
    await reportResourceOf(database.db, stored, UNMASKED),
  );
  return { outcome, stored, attributes: resource.attributes as Record<string, unknown> };
}

describe('the matching reports on the database (C78.3, C79, C80.5)', () => {
  it('serves a watchlist hit on the imported sandbox list with its provenance', async () => {
    const { outcome, stored, attributes } = await screened('watchlist', {
      ...SANDBOX_WATCHLIST_MAGIC.listedPerson.query,
    });
    expect(outcome).toEqual({ outcome: 'completed', status: 'ready' });
    expect(stored.hasMatch).toBe(true);
    expect(attributes['matched-lists']).toEqual([
      expect.objectContaining({
        'source-id': OPENVERIFY_SANDBOX_SOURCE,
        entities: [
          expect.objectContaining({
            'entity-id': `${OPENVERIFY_SANDBOX_SOURCE}:${SANDBOX_WATCHLIST_MAGIC.listedPerson.entryId}`,
          }),
        ],
      }),
    ]);
    expect(attributes.sources).toEqual([
      expect.objectContaining({ 'source-id': OPENVERIFY_SANDBOX_SOURCE, origin: 'import' }),
    ]);
    expect(attributes['matcher-version']).toBe(matcherVersion(SHA));
  });

  it('serves a business hit by its LEI, with the unbuilt lists null', async () => {
    const { attributes } = await screened('business-watchlist', {
      ...SANDBOX_WATCHLIST_MAGIC.business.query,
    });
    expect(attributes['has-match']).toBe(true);
    expect(attributes['fitness-probity-list']).toBeNull();
    expect(attributes['lists-searched']).toEqual([OPENVERIFY_SANDBOX_SOURCE]);
    expect(attributes['sanction-list']).toHaveLength(1);
  });

  it('serves a crypto hit by the canonical address and indexes it', async () => {
    const { stored, attributes } = await screened('crypto-address-watchlist', {
      ...SANDBOX_WATCHLIST_MAGIC.cryptoParty.query,
    });
    expect(stored.cryptoAddressIndex).toMatch(/^[0-9a-f]{64}$/);
    expect(attributes['crypto-address-format']).toBe('evm');
    expect(attributes.result).toEqual([
      expect.objectContaining({
        'source-id': OPENVERIFY_SANDBOX_SOURCE,
        entities: [expect.objectContaining({ 'match-types': ['crypto_address_exact'] })],
      }),
    ]);
  });

  it('serves a PEP hit with its positions, and a relative only when asked', async () => {
    const { attributes } = await screened('politically-exposed-person', {
      ...SANDBOX_PEP_MAGIC.headOfGovernment.query,
    });
    expect(attributes.result).toEqual([
      expect.objectContaining({
        'pep-type': 'pep',
        'entity-id': expect.stringContaining('Q-test-1001') as unknown,
      }),
    ]);
    const relative = await screened(
      'politically-exposed-person',
      { ...SANDBOX_PEP_MAGIC.spouse.query },
      { 'include-relatives': true },
    );
    expect(relative.attributes.result).toEqual([
      expect.objectContaining({ 'pep-type': 'relative' }),
    ]);
  });

  it('never screens the sandbox list for a production environment (P13)', async () => {
    const { outcome, attributes } = await screened(
      'watchlist',
      { ...SANDBOX_WATCHLIST_MAGIC.listedPerson.query },
      {},
      productionId,
    );
    expect(outcome).toEqual({ outcome: 'completed', status: 'errored' });
    expect(attributes.errors).toEqual([
      { code: 'list_unavailable', source: OPENVERIFY_SANDBOX_SOURCE },
    ]);
    expect(attributes['has-match']).toBe(false);
  });
});

// The full validation's e2e after Workflow 6B polled a report while its run completed, and the
// API answered 500: the report row was read before the run committed and its matches after, so
// `has-match` disagreed with the matches and the response schema refused it.
describe('a report and its matches in one snapshot (C70.2, C75.1)', () => {
  it('serves a report read before its run completed as the run left it', async () => {
    const { templateId, versionId } = await seedReportTemplate(database.db, sandboxId, {
      config: { 'search-lists': [OPENVERIFY_SANDBOX_SOURCE] },
    });
    const query = { ...SANDBOX_WATCHLIST_MAGIC.listedPerson.query };
    const runId = testId('rpr');
    const report = await createReport(database.db, sandboxId, {
      id: testId('rep'),
      reportType: 'watchlist',
      reportTemplateId: templateId,
      reportTemplateVersionId: versionId,
      origin: 'api',
      query,
      querySources: Object.fromEntries(Object.keys(query).map((key) => [key, 'request'])),
      inquiryId: null,
      accountId: null,
      recurrenceIntervalDays: null,
      nextRunAt: null,
      createdAt: clock.now(),
      initialRun: { id: runId, scheduledFor: clock.now() },
    });
    const before = await getReport(database.db, sandboxId, report.id);
    if (before === null) {
      throw new Error('the report is gone');
    }
    expect(before.hasMatch).toBe(false);

    await createReportRunProcessor()(
      { environmentId: sandboxId, reportId: report.id, runId },
      deps(),
      {
        lastAttempt: false,
      },
    );
    const resource = reportResourceSchema.parse(
      await reportResourceOf(database.db, before, UNMASKED),
    );

    expect(resource.attributes).toMatchObject({ status: 'ready', 'has-match': true });
  });

  it('reads the report and its matches in one read-only repeatable-read transaction', async () => {
    const { stored } = await screened('watchlist', {
      ...SANDBOX_WATCHLIST_MAGIC.listedPerson.query,
    });
    const transaction = vi.spyOn(database.db, 'transaction');
    try {
      await reportResourceOf(database.db, stored, UNMASKED);

      expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'repeatable read',
        accessMode: 'read only',
      });
    } finally {
      transaction.mockRestore();
    }
  });
});

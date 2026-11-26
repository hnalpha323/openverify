/**
 * C69.4, C76.3, C78, C79, C80 (Workflow 6A Stage 3, `api-reports`): the four matching report jobs
 * (`watchlist`, `business-watchlist`, `crypto-address-watchlist`, `politically-exposed-person`)
 * over the matcher and `api-watchlists`' frozen reads (the in-memory fake here; the database
 * reads in `matching-reports-db.test.ts`). The lists are the synthetic sandbox lists of
 * `@openverify/watchlist/testing`: fictional persons, companies and addresses only.
 */
import { newId, resolveReportTemplateConfig } from '@openverify/contracts';
import type { ReportType } from '@openverify/core';
import type { Db, WatchlistSourceState } from '@openverify/db';
import {
  contentHash,
  keysVersion,
  matcherVersion,
  personSubject,
  queryNameReach,
  recordCryptoRows,
  recordIdentifierRows,
  recordNameRows,
  riskDataHash,
  variantGroupsFrom,
  type WatchlistRecord,
} from '@openverify/watchlist';
import {
  OPENVERIFY_SANDBOX_PEP_SOURCE,
  OPENVERIFY_SANDBOX_SOURCE,
  openverifySandboxList,
  openverifySandboxPepList,
  PUBLISHED_TEST_ADDRESSES,
  SANDBOX_PEP_MAGIC,
  SANDBOX_WATCHLIST_MAGIC,
} from '@openverify/watchlist/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PHASE6_DEFAULTS } from '../../config.js';
import type {
  BoundProviders,
  CryptoExposureProvider,
  CryptoExposureResult,
  EnvironmentKind,
} from '../../ports.js';
import {
  catalogOf,
  type WatchlistSourceDescription,
} from '../../services/reports/source-catalog.js';
import {
  createInMemoryWatchlists,
  fixedClock,
  type FakeWatchlistEntry,
  type InMemoryWatchlists,
  type TestClock,
} from '../../test-support/fakes.js';
import { createWorkerLogger } from '../logger.js';
import { useScreeningKit } from '../reports/screening.js';
import { reportTypeJob, type ReportRunContext, type ReportRunResult } from './index.js';

const SHA = 'ab'.repeat(32);
const GROUPS = variantGroupsFrom([], SHA);
const KEYS_VERSION = keysVersion(SHA);
const HOUR = 3_600_000;

const description = (
  id: string,
  kind: 'sanctions' | 'pep',
  extra: Partial<WatchlistSourceDescription> = {},
): WatchlistSourceDescription => ({
  id,
  kind,
  publisher: `Synthetic publisher of ${id}`,
  refreshIntervalHours: 6,
  staleAfterHours: 48,
  sandboxOnly: false,
  attribution: `Synthetic attribution of ${id}`,
  listUrl: null,
  flagCode: 'ZZ',
  ...extra,
});

const CATALOG = catalogOf([
  description(OPENVERIFY_SANDBOX_SOURCE, 'sanctions', {
    refreshIntervalHours: null,
    staleAfterHours: null,
    sandboxOnly: true,
  }),
  description(OPENVERIFY_SANDBOX_PEP_SOURCE, 'pep', {
    refreshIntervalHours: null,
    staleAfterHours: null,
    sandboxOnly: true,
  }),
  description('ofac-sdn', 'sanctions', { flagCode: 'US' }),
  description('eu-fsf', 'sanctions', { flagCode: 'EU' }),
  description('uk-sanctions-list', 'sanctions', { flagCode: 'GB' }),
  description('wikidata-pep', 'pep', { refreshIntervalHours: 168, staleAfterHours: 192 }),
]);

let clock: TestClock;
let reads: InMemoryWatchlists;
let restore: () => void;

function state(id: string, overrides: Partial<WatchlistSourceState> = {}): WatchlistSourceState {
  const checked = new Date(clock.now().getTime() - HOUR);
  return {
    id,
    enabled: true,
    sandboxOnly: id.startsWith('openverify-sandbox'),
    keysVersion: KEYS_VERSION,
    lastSyncId: 7,
    lastPublishedAt: new Date('2026-01-01T00:00:00.000Z'),
    lastSha256: 'c'.repeat(64),
    lastAppliedAt: checked,
    lastCheckedAt: checked,
    lastOrigin: id.startsWith('openverify-sandbox') ? 'import' : 'publisher',
    lastErrorCode: null,
    ...overrides,
  };
}

function entry(sourceId: string, record: WatchlistRecord): FakeWatchlistEntry {
  return {
    sourceId,
    entryId: record.entry_id,
    kind: record.kind,
    contentHash: contentHash(record),
    riskDataHash: riskDataHash(record),
    data: record,
    removedAt: null,
    keys: recordNameRows(record, GROUPS).flatMap((row) => row.keys),
    identifiers: recordIdentifierRows(record).map(({ kind, value, country }) => ({
      kind,
      value,
      country,
    })),
    cryptoAddresses: recordCryptoRows(record).map((row) => row.canonical),
  };
}

const SANDBOX_ENTRIES = openverifySandboxList(1).entries.map((record) =>
  entry(OPENVERIFY_SANDBOX_SOURCE, record),
);
const PEP_ENTRIES = openverifySandboxPepList().entries.map((record) =>
  entry(OPENVERIFY_SANDBOX_PEP_SOURCE, record),
);

beforeEach(() => {
  clock = fixedClock();
  reads = createInMemoryWatchlists(
    [...SANDBOX_ENTRIES, ...PEP_ENTRIES],
    [state(OPENVERIFY_SANDBOX_SOURCE), state(OPENVERIFY_SANDBOX_PEP_SOURCE)],
  );
  restore = useScreeningKit({ reads: () => reads, groups: () => GROUPS, catalog: () => CATALOG });
});

afterEach(() => {
  restore();
});

interface ContextOptions {
  config?: Record<string, unknown>;
  environmentKind?: EnvironmentKind;
  providers?: BoundProviders;
  run?: Partial<ReportRunContext['run']>;
}

function context(
  type: ReportType,
  query: Record<string, unknown>,
  options: ContextOptions = {},
): ReportRunContext {
  const lists =
    type === 'politically-exposed-person'
      ? [OPENVERIFY_SANDBOX_PEP_SOURCE]
      : [OPENVERIFY_SANDBOX_SOURCE];
  return {
    report: {
      id: 'rep_01JSYNTHETICREPORT0000000',
      environmentId: 'env_01JSYNTHETICENVIRONMENT00',
      environmentKind: options.environmentKind ?? 'sandbox',
      type,
      origin: 'api',
      inquiryId: null,
      accountId: null,
      query,
      querySources: {},
      config: resolveReportTemplateConfig(type, { 'search-lists': lists, ...options.config }),
      createdAt: clock.now(),
    },
    run: {
      id: 'rpr_01JSYNTHETICRUN000000000',
      runType: 'initial',
      triggerSyncId: null,
      attempt: 1,
      ...options.run,
    },
    deps: {
      db: {} as Db,
      clock,
      logger: createWorkerLogger({ level: 'silent' }),
      watchlists: {
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
      },
      limits: { perMinute: 600, maxRecurringPerEnvironment: 250_000, maxMediaRunsPerDay: 8_640 },
    },
    providers: options.providers ?? {},
    signal: new AbortController().signal,
  };
}

async function run(
  type: ReportType,
  query: Record<string, unknown>,
  options: ContextOptions = {},
): Promise<ReportRunResult> {
  const outcome = await reportTypeJob(type).run(context(type, query, options));
  if (outcome.kind !== 'completed') {
    throw new Error(`expected a completed run, got ${outcome.kind}`);
  }
  return outcome.result;
}

const LISTED = SANDBOX_WATCHLIST_MAGIC.listedPerson;
const OUTSIDER = { 'name-first': 'Perpetua', 'name-last': 'Nonesuchly' };

/** Owner decision 9 after 6B: two synthetic lists other than the SDN List, one with no programme. */
const MEMBERSHIPS = [
  { list: 'synthetic sectoral identifications list', program: 'SYNTHETIC-PROGRAM-9' },
  { list: 'synthetic non-sdn list', program: null },
];

/** The sandbox list entry `entryId`, now also on {@link MEMBERSHIPS} (as an OFAC record would be). */
function onOtherLists(entryId: string): void {
  const record = openverifySandboxList(1).entries.find((item) => item.entry_id === entryId);
  const at = reads.entries.findIndex(
    (item) => item.sourceId === OPENVERIFY_SANDBOX_SOURCE && item.entryId === entryId,
  );
  if (record === undefined || at < 0) {
    throw new Error(`no sandbox entry ${entryId}`);
  }
  reads.entries[at] = entry(OPENVERIFY_SANDBOX_SOURCE, {
    ...record,
    list_memberships: MEMBERSHIPS,
  });
}

describe('watchlist (C79.1)', () => {
  it('finds a listed person, with the entity, the list, the components and the provenance', async () => {
    const result = await run('watchlist', { ...LISTED.query });
    expect(result.errors).toEqual([]);
    expect(result.matcherVersion).toBe(matcherVersion(SHA));
    expect(result.thresholds).toMatchObject({ preset: 'tolerant' });
    expect(result.coverage).toEqual({ complete: true, limits: [] });
    expect(result.sources).toEqual([
      {
        sourceId: OPENVERIFY_SANDBOX_SOURCE,
        syncId: '7',
        publishedAt: new Date('2026-01-01T00:00:00.000Z'),
        checkedAt: new Date(clock.now().getTime() - HOUR),
        sha256: 'c'.repeat(64),
        origin: 'import',
        attribution: `Synthetic attribution of ${OPENVERIFY_SANDBOX_SOURCE}`,
      },
    ]);
    const [match] = result.matches;
    expect(result.matches).toHaveLength(1);
    expect(match).toMatchObject({
      sourceId: OPENVERIFY_SANDBOX_SOURCE,
      entryKey: `${OPENVERIFY_SANDBOX_SOURCE}:${LISTED.entryId}`,
    });
    const listed = SANDBOX_ENTRIES.find((candidate) => candidate.entryId === LISTED.entryId);
    expect(match?.contentHash).toBe(listed?.contentHash);
    expect(match?.riskDataHash).toBe(listed?.riskDataHash);
    expect(match?.score).toBeGreaterThanOrEqual(0.8);
    expect(match?.snapshot).toMatchObject({
      entity: {
        'entity-id': `${OPENVERIFY_SANDBOX_SOURCE}:${LISTED.entryId}`,
        'alias-type': 'primary_name',
        birthdates: [{ day: 12, month: 4, year: 1980, granularity: 'day' }],
        countries: expect.arrayContaining([LISTED.country]) as unknown,
        programs: ['SANDBOX-PROGRAM-1'],
      },
      list: {
        'source-id': OPENVERIFY_SANDBOX_SOURCE,
        'list-type': 'sanction',
        'list-types': ['sanction'],
        slug: OPENVERIFY_SANDBOX_SOURCE,
        'flag-code': 'ZZ',
      },
      components: { preset: 'tolerant' },
    });
    expect(match?.snapshot['match-types']).toContain('name_exact');
    expect(Object.keys(match?.snapshot.entity as object).sort()).toEqual([
      'alias-type',
      'birthdates',
      'countries',
      'entity-id',
      'match-types',
      'name',
      'programs',
    ]);
  });

  it('keeps the entry’s other lists in the snapshot, so a non-blocking listing is never read as an SDN block (owner decision 9 after 6B)', async () => {
    onOtherLists(LISTED.entryId);

    const result = await run('watchlist', { ...LISTED.query });

    const entity = result.matches[0]?.snapshot.entity as Record<string, unknown>;
    expect(entity['list-memberships']).toEqual(MEMBERSHIPS);
    expect(entity).not.toHaveProperty('relative-of-class');
  });

  it('finds nothing for a person on no list, and says so only as a ready result', async () => {
    const result = await run('watchlist', OUTSIDER);
    expect(result).toMatchObject({ errors: [], matches: [] });
    expect(result.coverage).toEqual({ complete: true, limits: [] });
  });

  it('decides the first name’s trigram path on its own keys, never on an additional name’s (R007)', async () => {
    const searched: { keys: readonly string[]; normalisedName: string | null }[] = [];
    const retrieve = reads.retrieveCandidates.bind(reads);
    reads.retrieveCandidates = (db, query) => {
      searched.push({ keys: query.keys, normalisedName: query.normalisedName });
      return retrieve(db, query);
    };
    await run('watchlist', {
      ...OUTSIDER,
      'additional-names': [{ 'name-first': 'Quillon', 'name-last': 'Zephyrine' }],
    });
    const first = searched.filter((search) => search.normalisedName?.includes('nonesuchly'));
    expect(first).toHaveLength(1);
    expect(first[0]?.keys).toContain('t:nonesuchly');
    expect(first[0]?.keys.filter((key) => key.includes('zephyrin'))).toEqual([]);
    // Every name's keys are still searched, with the identifiers, and each name has its own path.
    expect(searched.flatMap((search) => search.keys)).toContain('t:zephyrine');
    expect(searched.filter((search) => search.normalisedName?.includes('zephyrine'))).toHaveLength(
      1,
    );
  });

  it('gives every search the reach of the names it searches by key (owner decision 1 after 6B)', async () => {
    const searched: { keys: readonly string[]; reach: readonly (readonly string[])[] }[] = [];
    const retrieve = reads.retrieveCandidates.bind(reads);
    reads.retrieveCandidates = (db, query) => {
      searched.push({ keys: query.keys, reach: query.reach ?? [] });
      return retrieve(db, query);
    };
    const query = {
      ...OUTSIDER,
      'additional-names': [{ 'name-first': 'Quillon', 'name-last': 'Zephyrine' }],
    };
    await run('watchlist', query);
    const subject = personSubject(query);
    const keyed = searched.filter((search) => search.keys.length > 0);
    expect(keyed.map((search) => search.reach)).toEqual([
      queryNameReach(subject.names, GROUPS),
      queryNameReach(subject.names.slice(0, 1), GROUPS),
    ]);
    expect(
      searched.filter((search) => search.keys.length === 0).map((search) => search.reach),
    ).toEqual([[]]);
  });

  it('screens a list_update run trigger sync changed entries beside retrieval (owner decision 3 after 6B)', async () => {
    const listed = SANDBOX_ENTRIES.find((candidate) => candidate.entryId === LISTED.entryId);
    if (listed === undefined) {
      throw new Error('the sandbox list has no listed person');
    }
    reads.entries.splice(0, reads.entries.length, { ...listed, keys: [], changedSyncId: 9 });
    const scheduled = await run('watchlist', { ...LISTED.query });
    expect(scheduled.matches).toEqual([]);
    const listUpdate = await run(
      'watchlist',
      { ...LISTED.query },
      { run: { runType: 'list_update', triggerSyncId: 9 } },
    );
    expect(listUpdate.matches.map((match) => match.entryKey)).toEqual([
      `${OPENVERIFY_SANDBOX_SOURCE}:${LISTED.entryId}`,
    ]);
    const otherSync = await run(
      'watchlist',
      { ...LISTED.query },
      { run: { runType: 'list_update', triggerSyncId: 8 } },
    );
    expect(otherSync.matches).toEqual([]);
  });

  it('matches an exact identifier whatever the name says (H06)', async () => {
    const result = await run('watchlist', {
      ...OUTSIDER,
      'identification-number': LISTED.passport,
      'identification-type': 'passport',
    });
    expect(result.matches.map((match) => match.entryKey)).toEqual([
      `${OPENVERIFY_SANDBOX_SOURCE}:${LISTED.entryId}`,
    ]);
    expect(result.matches[0]?.snapshot['match-types']).toContain('identifier_exact');
  });

  it('errors insufficient_input when no name or identifier is left to screen', async () => {
    const result = await run('watchlist', {});
    expect(result.errors).toContainEqual({ code: 'insufficient_input' });
    expect(result.matches).toEqual([]);
  });
});

describe('the honesty of a run (C69.4, C76.3, C78.3)', () => {
  it('screens what it can and errors each source it could not: never synced, disabled, stale, another keys version', async () => {
    reads.sources.push(
      state('ofac-sdn', { lastCheckedAt: null, lastAppliedAt: null, lastSyncId: null }),
      state('eu-fsf', { enabled: false }),
      state('uk-sanctions-list', { keysVersion: 'names-0;old' }),
    );
    const result = await run(
      'watchlist',
      { ...LISTED.query },
      {
        config: {
          'search-lists': [
            OPENVERIFY_SANDBOX_SOURCE,
            'ofac-sdn',
            'eu-fsf',
            'uk-sanctions-list',
            'un-sc',
          ],
        },
      },
    );
    expect(result.errors).toEqual([
      { code: 'list_unavailable', source: 'ofac-sdn' },
      { code: 'list_unavailable', source: 'eu-fsf' },
      { code: 'matcher_data_unavailable', source: 'uk-sanctions-list' },
      { code: 'list_unavailable', source: 'un-sc' },
    ]);
    expect(result.sources.map((source) => source.sourceId)).toEqual([OPENVERIFY_SANDBOX_SOURCE]);
    expect(result.matches).toHaveLength(1);
  });

  it('counts freshness from the last check: the smaller of the source limit and max-list-age-hours (H02)', async () => {
    const at = (hours: number) => new Date(clock.now().getTime() - hours * HOUR);
    reads.sources.push(state('ofac-sdn', { lastCheckedAt: at(47), lastAppliedAt: at(400) }));
    const fresh = await run('watchlist', OUTSIDER, { config: { 'search-lists': ['ofac-sdn'] } });
    expect(fresh.errors).toEqual([]);
    const stale = await run('watchlist', OUTSIDER, {
      config: { 'search-lists': ['ofac-sdn'], 'max-list-age-hours': 24 },
    });
    expect(stale.errors).toEqual([{ code: 'list_stale', source: 'ofac-sdn' }]);
    reads.sources.splice(-1, 1, state('ofac-sdn', { lastCheckedAt: at(49) }));
    const late = await run('watchlist', OUTSIDER, { config: { 'search-lists': ['ofac-sdn'] } });
    expect(late.errors).toEqual([{ code: 'list_stale', source: 'ofac-sdn' }]);
  });

  it('never calls a sandbox-only list stale (V03)', async () => {
    reads.sources.splice(
      0,
      1,
      state(OPENVERIFY_SANDBOX_SOURCE, {
        lastCheckedAt: new Date(clock.now().getTime() - 900 * HOUR),
      }),
    );
    const result = await run('watchlist', { ...LISTED.query });
    expect(result.errors).toEqual([]);
    expect(result.matches).toHaveLength(1);
  });

  it('errors list_unavailable for an empty selection, without a source', async () => {
    const result = await run('watchlist', { ...LISTED.query }, { config: { 'search-lists': [] } });
    expect(result.errors).toEqual([{ code: 'list_unavailable' }]);
    expect(result.matches).toEqual([]);
  });

  it('never screens a sandbox-only list for a production environment (P13)', async () => {
    const result = await run('watchlist', { ...LISTED.query }, { environmentKind: 'production' });
    expect(result.errors).toEqual([
      { code: 'list_unavailable', source: OPENVERIFY_SANDBOX_SOURCE },
    ]);
    expect(result.matches).toEqual([]);
  });

  it('errors matcher_data_unavailable without the variant groups (F14), for every name type', async () => {
    restore();
    restore = useScreeningKit({ reads: () => reads, groups: () => null, catalog: () => CATALOG });
    for (const type of ['watchlist', 'politically-exposed-person'] as const) {
      const result = await run(type, { ...LISTED.query });
      expect(result.errors).toEqual([{ code: 'matcher_data_unavailable' }]);
      expect(result.matches).toEqual([]);
    }
    const business = await run('business-watchlist', { ...SANDBOX_WATCHLIST_MAGIC.business.query });
    expect(business.errors).toEqual([{ code: 'matcher_data_unavailable' }]);
  });

  it('states coverage from the scripts the source holds, not from the candidates of the run (owner decision 13 after 6B)', async () => {
    const arabic = { term: 'نوري الصفاء' };
    const holding = async (scripts: string[]) => {
      reads.sources.splice(0, reads.sources.length, state(OPENVERIFY_SANDBOX_SOURCE, { scripts }));
      return (await run('watchlist', arabic)).coverage;
    };
    expect(await holding(['latin'])).toEqual({ complete: false, limits: ['lossy_script'] });
    expect(await holding(['latin', 'arabic'])).toEqual({ complete: true, limits: [] });
  });

  it('states a lossy comparison of a Han-only subject in its coverage (H05)', async () => {
    const result = await run('watchlist', { term: '测试样本' });
    expect(result.errors).toEqual([]);
    expect(result.coverage).toEqual({ complete: false, limits: ['lossy_script'] });
  });

  it('errors result_truncated for a search cut at its cap that found nothing (H12)', async () => {
    const truncating = {
      ...reads,
      retrieveCandidates: async (
        ...args: Parameters<InMemoryWatchlists['retrieveCandidates']>
      ) => ({
        ...(await reads.retrieveCandidates(...args)),
        truncated: true,
      }),
    };
    restore();
    restore = useScreeningKit({
      reads: () => truncating,
      groups: () => GROUPS,
      catalog: () => CATALOG,
    });
    const none = await run('watchlist', OUTSIDER);
    expect(none.errors).toEqual([{ code: 'result_truncated' }]);
    expect(none.coverage).toEqual({ complete: false, limits: ['truncated'] });
    const found = await run('watchlist', { ...LISTED.query });
    expect(found.errors).toEqual([]);
    expect(found.matches).toHaveLength(1);
  });

  it('errors result_truncated when two tokens of the subject are out of reach and nothing matched (owner decision 1 after 6B)', async () => {
    // 501 entries hold the subject's two tokens together: over the bound of the cap (500), so
    // neither token nor their pair may be used alone, and no other key reaches them.
    const crowd = Array.from({ length: 501 }, (_, index) => {
      const record = {
        ...(SANDBOX_ENTRIES[0]?.data as unknown as WatchlistRecord),
        entry_id: `SBX-CROWD-${String(index).padStart(4, '0')}`,
        names: [
          {
            full: `Perpetua Nonesuchly ${String(index)}`,
            parts: [],
            script: 'latin' as const,
            quality: 'strong' as const,
            primary: true,
          },
        ],
        birth_dates: [{ value: '1901-01-01', precision: 'day' as const }],
      };
      return entry(OPENVERIFY_SANDBOX_SOURCE, record);
    });
    reads.entries.push(...crowd);
    const result = await run('watchlist', OUTSIDER);
    expect(result.coverage).toEqual({ complete: false, limits: ['truncated'] });
    expect(result.errors).toEqual([{ code: 'result_truncated' }]);
  });

  it('never matches an entry that left its source', async () => {
    const listed = reads.entries.find((candidate) => candidate.entryId === LISTED.entryId);
    if (listed !== undefined) {
      listed.removedAt = clock.now();
    }
    const loading = {
      ...reads,
      retrieveCandidates: () =>
        Promise.resolve({
          candidates: [
            {
              sourceId: OPENVERIFY_SANDBOX_SOURCE,
              entryId: LISTED.entryId,
              sharedKeys: 3,
              via: ['keys' as const],
            },
          ],
          truncated: false,
        }),
    };
    restore();
    restore = useScreeningKit({
      reads: () => loading,
      groups: () => GROUPS,
      catalog: () => CATALOG,
    });
    const result = await run('watchlist', { ...LISTED.query });
    expect(result.matches).toEqual([]);
  });
});

describe('business-watchlist (C79.2)', () => {
  const BUSINESS = SANDBOX_WATCHLIST_MAGIC.business;
  const VESSEL = SANDBOX_WATCHLIST_MAGIC.vessel;

  it('finds the business by name and LEI, says it is no ownership screening and leaves the unbuilt lists null', async () => {
    const result = await run('business-watchlist', { ...BUSINESS.query });
    expect(result.errors).toEqual([]);
    expect(result.thresholds).toMatchObject({ preset: 'strict' });
    expect(result.notices).toEqual(['no_ownership_screening']);
    expect(result.unavailableFields).toEqual([
      { field: 'fitness-probity-list', reason: 'list_not_configured' },
      { field: 'warning-list', reason: 'list_not_configured' },
    ]);
    expect(result.result).toMatchObject({ 'lists-searched': [OPENVERIFY_SANDBOX_SOURCE] });
    expect(result.matches.map((match) => match.entryKey)).toEqual([
      `${OPENVERIFY_SANDBOX_SOURCE}:${BUSINESS.entryId}`,
    ]);
    const entity = result.matches[0]?.snapshot.entity as Record<string, unknown>;
    expect(entity).toMatchObject({ kind: 'entity', programs: ['SANDBOX-PROGRAM-1'] });
    expect(entity.identifiers).toContainEqual({ kind: 'lei', value: BUSINESS.lei, country: null });
    expect(result.matches[0]?.snapshot['match-types']).toContain('identifier_exact');
  });

  it('keeps the business’s other lists in the snapshot (owner decision 9 after 6B)', async () => {
    onOtherLists(BUSINESS.entryId);

    const result = await run('business-watchlist', { ...BUSINESS.query });

    const entity = result.matches[0]?.snapshot.entity as Record<string, unknown>;
    expect(entity['list-memberships']).toEqual(MEMBERSHIPS);
  });

  it('meets a vessel by its IMO whatever entity-kinds says, and not by its name alone (H06)', async () => {
    const byImo = await run('business-watchlist', {
      term: 'Unrelated Trading Name',
      'imo-number': VESSEL.imo,
    });
    expect(byImo.matches.map((match) => match.entryKey)).toEqual([
      `${OPENVERIFY_SANDBOX_SOURCE}:${VESSEL.entryId}`,
    ]);
    expect((byImo.matches[0]?.snapshot.entity as Record<string, unknown>).kind).toBe('vessel');
    const byName = await run('business-watchlist', { term: VESSEL.name });
    expect(byName.matches).toEqual([]);
    const asked = await run(
      'business-watchlist',
      { term: VESSEL.name },
      {
        config: { 'entity-kinds': ['vessel'] },
      },
    );
    expect(asked.matches.map((match) => match.entryKey)).toEqual([
      `${OPENVERIFY_SANDBOX_SOURCE}:${VESSEL.entryId}`,
    ]);
  });
});

describe('crypto-address-watchlist (C79.3, C83)', () => {
  const PARTY = SANDBOX_WATCHLIST_MAGIC.cryptoParty;

  it('matches the canonical address exactly, indexes it and states that no exposure provider is bound', async () => {
    const result = await run('crypto-address-watchlist', {
      'crypto-address': `  ethereum:${PUBLISHED_TEST_ADDRESSES.eip55Example.toUpperCase().replace('0X', '0x')}?value=1 `,
    });
    expect(result.errors).toEqual([]);
    expect(result.cryptoAddress).toBe(PUBLISHED_TEST_ADDRESSES.eip55Example.toLowerCase());
    expect(result.result).toMatchObject({ 'crypto-address-format': 'evm', exposure: null });
    expect(result.unavailableFields).toEqual([
      { field: 'exposure', reason: 'provider_not_configured' },
    ]);
    expect(result.coverage).toEqual({ complete: true, limits: [] });
    expect(result.thresholds).toBeNull();
    expect(result.matches.map((match) => [match.entryKey, match.score])).toEqual([
      [`${OPENVERIFY_SANDBOX_SOURCE}:${PARTY.entryId}`, 1],
    ]);
    const entity = result.matches[0]?.snapshot.entity as Record<string, unknown>;
    expect(entity).toMatchObject({
      'entity-id': `${OPENVERIFY_SANDBOX_SOURCE}:${PARTY.entryId}`,
      name: PARTY.name,
      'alias-type': 'primary_name',
      'match-types': ['crypto_address_exact'],
      birthdates: [],
    });
    expect(entity['crypto-addresses']).toContainEqual({
      type: 'ETH',
      address: PUBLISHED_TEST_ADDRESSES.eip55Example,
      chain: 'unknown',
    });
    expect(Object.keys(entity).sort()).toEqual([
      'alias-type',
      'birthdates',
      'crypto-addresses',
      'entity-id',
      'match-types',
      'name',
    ]);
  });

  it('keeps the address holder’s other lists in the snapshot (owner decision 9 after 6B)', async () => {
    onOtherLists(PARTY.entryId);

    const result = await run('crypto-address-watchlist', { ...PARTY.query });

    const entity = result.matches[0]?.snapshot.entity as Record<string, unknown>;
    expect(entity['list-memberships']).toEqual(MEMBERSHIPS);
  });

  it('screens addresses without the variant groups, which only names need', async () => {
    restore();
    restore = useScreeningKit({ reads: () => reads, groups: () => null, catalog: () => CATALOG });
    const result = await run('crypto-address-watchlist', { ...PARTY.query });
    expect(result.errors).toEqual([]);
    expect(result.matches).toHaveLength(1);
  });

  it('adds the exposure block of a bound provider, and never a pass for an unrated address', async () => {
    const asked: unknown[] = [];
    const cryptoExposure: CryptoExposureProvider = {
      id: 'sandbox',
      sandbox: true,
      exposure: (request) => {
        asked.push(request);
        return Promise.resolve(
          request.address.endsWith('beef')
            ? { outcome: 'rated', categories: ['sanctioned_entity'], direct: 1, indirect: 0 }
            : { outcome: 'unavailable', reason: 'unsupported_chain' },
        );
      },
    };
    const address = `0x${'0'.repeat(36)}beef`;
    const rated = await run(
      'crypto-address-watchlist',
      { 'crypto-address': address, 'chain-id': 'eip155:1' },
      {
        providers: { cryptoExposure },
      },
    );
    expect(asked).toEqual([{ chainId: 'eip155:1', address }]);
    expect(rated.result.exposure).toEqual({
      'direct-sanctioned': true,
      exposures: [{ category: 'sanctioned_entity', share: 1, hops: 0 }],
      'risk-score': null,
    });
    expect(rated.unavailableFields).toEqual([]);
    expect(rated.provider).toEqual({ id: 'sandbox', sandbox: true });
    const unrated = await run(
      'crypto-address-watchlist',
      { ...PARTY.query },
      {
        providers: { cryptoExposure },
      },
    );
    expect(unrated.result.exposure).toBeNull();
    expect(unrated.unavailableFields).toEqual([{ field: 'exposure', reason: 'undetermined' }]);
    expect(unrated.matches).toHaveLength(1);
  });

  it('serves the provider’s hop distance for an indirect exposure, and at least one hop without it (owner decision 5 (a))', async () => {
    const answers: CryptoExposureResult[] = [
      { outcome: 'rated', categories: ['mixer'], direct: 0, indirect: 0.25, hops: 3 },
      { outcome: 'rated', categories: ['mixer'], direct: 0, indirect: 0.25 },
      { outcome: 'rated', categories: ['mixer'], direct: 0, indirect: 0.25, hops: 0 },
      { outcome: 'rated', categories: ['mixer'], direct: 0, indirect: 0.25, hops: 2.5 },
    ];
    const served: unknown[] = [];
    for (const answer of answers) {
      const cryptoExposure: CryptoExposureProvider = {
        id: 'sandbox',
        sandbox: true,
        exposure: () => Promise.resolve(answer),
      };
      const result = await run(
        'crypto-address-watchlist',
        { 'crypto-address': `0x${'0'.repeat(36)}cafe`, 'chain-id': 'eip155:1' },
        { providers: { cryptoExposure } },
      );
      served.push((result.result.exposure as { exposures: unknown[] }).exposures);
    }
    expect(served).toEqual([
      [{ category: 'mixer', share: 0.25, hops: 3 }],
      [{ category: 'mixer', share: 0.25, hops: 1 }],
      [{ category: 'mixer', share: 0.25, hops: 1 }],
      [{ category: 'mixer', share: 0.25, hops: 1 }],
    ]);
  });

  it('states an unclassified format, and errors insufficient_input for an empty address', async () => {
    const unclassified = await run('crypto-address-watchlist', {
      'crypto-address': 'zz-synthetic-unclassified-1',
    });
    expect(unclassified.errors).toEqual([]);
    expect(unclassified.coverage).toEqual({ complete: false, limits: ['unclassified_format'] });
    expect(unclassified.result).toMatchObject({ 'crypto-address-format': 'unclassified' });
    const empty = await run('crypto-address-watchlist', { 'crypto-address': 'bitcoin:' });
    expect(empty.errors).toEqual([{ code: 'insufficient_input' }]);
  });

  it('errors each crypto source it could not screen', async () => {
    const result = await run(
      'crypto-address-watchlist',
      { ...PARTY.query },
      {
        config: { 'search-lists': [OPENVERIFY_SANDBOX_SOURCE, 'ofac-sdn'] },
      },
    );
    expect(result.errors).toEqual([{ code: 'list_unavailable', source: 'ofac-sdn' }]);
    expect(result.matches).toHaveLength(1);
  });
});

describe('politically-exposed-person (C80.5)', () => {
  const HEAD = SANDBOX_PEP_MAGIC.headOfGovernment;
  const SPOUSE = SANDBOX_PEP_MAGIC.spouse;
  const BOARD = SANDBOX_PEP_MAGIC.stateEnterpriseBoardMember;

  it('finds an office holder with the public result shape and the coverage notice', async () => {
    const result = await run('politically-exposed-person', { ...HEAD.query });
    expect(result.errors).toEqual([]);
    expect(result.notices).toEqual(['pep_coverage_uneven']);
    expect(result.thresholds).toMatchObject({ preset: 'strict' });
    expect(result.matches.map((match) => match.entryKey)).toEqual([
      `${OPENVERIFY_SANDBOX_PEP_SOURCE}:${HEAD.entryId}`,
    ]);
    const entity = result.matches[0]?.snapshot.entity as Record<string, unknown>;
    expect(entity).toMatchObject({
      'entity-id': `${OPENVERIFY_SANDBOX_PEP_SOURCE}:${HEAD.entryId}`,
      'death-dates': [],
      'pep-type': 'pep',
      associates: [],
    });
    expect(entity.sources).toMatchObject({
      [HEAD.entryId]: `https://www.wikidata.org/wiki/${HEAD.entryId}`,
    });
    expect(entity.positions).toContainEqual(expect.objectContaining({ 'pep-class': 1 }));
    expect(Object.keys(entity).sort()).toEqual([
      'associates',
      'birthdates',
      'country',
      'death-dates',
      'entity-id',
      'match-types',
      'name',
      'pep-type',
      'positions',
      'sex',
      'sources',
    ]);
  });

  it('screens only the selected classes', async () => {
    expect((await run('politically-exposed-person', { ...BOARD.query })).matches).toEqual([]);
    const asked = await run(
      'politically-exposed-person',
      { ...BOARD.query },
      {
        config: { 'pep-classes': [3] },
      },
    );
    expect(asked.matches.map((match) => match.entryKey)).toEqual([
      `${OPENVERIFY_SANDBOX_PEP_SOURCE}:${BOARD.entryId}`,
    ]);
  });

  it('reads a relative’s class from its own record, not its linked holder (owner decision 9 after 6B)', async () => {
    const holderKey = (entry: FakeWatchlistEntry) => entry.entryId === HEAD.entryId;
    reads.entries.splice(
      0,
      reads.entries.length,
      ...reads.entries.filter((entry) => !holderKey(entry)),
    );
    const relative = await run(
      'politically-exposed-person',
      { ...SPOUSE.query },
      { config: { 'include-relatives': true, 'pep-classes': [HEAD.pepClass] } },
    );
    expect(relative.matches.map((match) => match.entryKey)).toEqual([
      `${OPENVERIFY_SANDBOX_PEP_SOURCE}:${SPOUSE.entryId}`,
    ]);
    const otherClass = await run(
      'politically-exposed-person',
      { ...SPOUSE.query },
      { config: { 'include-relatives': true, 'pep-classes': [3] } },
    );
    expect(otherClass.matches).toEqual([]);
  });

  it('screens a relative only with include-relatives, naming the holder as an associate (C80.3)', async () => {
    expect((await run('politically-exposed-person', { ...SPOUSE.query })).matches).toEqual([]);
    const result = await run(
      'politically-exposed-person',
      { ...SPOUSE.query },
      {
        config: { 'include-relatives': true },
      },
    );
    expect(result.matches.map((match) => match.entryKey)).toEqual([
      `${OPENVERIFY_SANDBOX_PEP_SOURCE}:${SPOUSE.entryId}`,
    ]);
    const entity = result.matches[0]?.snapshot.entity as Record<string, unknown>;
    expect(entity).toMatchObject({
      'pep-type': 'relative',
      positions: [],
      associates: [{ name: `${HEAD.givenName} ${HEAD.familyName}`, relationship: 'spouse' }],
    });
  });

  it('keeps a relative’s class in the snapshot, and none on an office holder (owner decision 9 after 6B)', async () => {
    const relative = await run(
      'politically-exposed-person',
      { ...SPOUSE.query },
      { config: { 'include-relatives': true } },
    );
    const holder = await run('politically-exposed-person', { ...HEAD.query });

    const entity = relative.matches[0]?.snapshot.entity as Record<string, unknown>;
    expect(entity).toMatchObject({ 'pep-type': 'relative', 'relative-of-class': HEAD.pepClass });
    expect(holder.matches[0]?.snapshot.entity).not.toHaveProperty('relative-of-class');
  });

  it('errors list_unavailable for a production PEP template before any sync (V01)', async () => {
    const result = await run(
      'politically-exposed-person',
      { ...HEAD.query },
      {
        environmentKind: 'production',
        config: { 'search-lists': ['wikidata-pep'] },
      },
    );
    expect(result.errors).toEqual([{ code: 'list_unavailable', source: 'wikidata-pep' }]);
    expect(result.matches).toEqual([]);
  });
});

describe('the screening path and the UN opt-in (C254.1, Q10 granted; KP11-31)', () => {
  const UN_CATALOG = catalogOf([
    description(OPENVERIFY_SANDBOX_SOURCE, 'sanctions', {
      refreshIntervalHours: null,
      staleAfterHours: null,
      sandboxOnly: true,
    }),
    description('un-sc', 'sanctions', { flagCode: 'UN' }),
  ]);
  const OPT_IN = {
    'watchlist-un-opt-in': {
      'source-id': 'un-sc',
      'terms-url': 'https://www.un.org/en/about-us/terms-of-use',
      'accepted-at': '2026-11-21T12:00:00.000Z',
      'accepted-by': newId('usr'),
    },
  };

  async function screenUn(allowed: boolean | undefined, settings: Record<string, unknown>) {
    reads.sources.push(state('un-sc'));
    restore();
    restore = useScreeningKit({
      reads: () => reads,
      groups: () => GROUPS,
      catalog: () => UN_CATALOG,
      environmentSettings: () => Promise.resolve(settings),
    });
    const ctx = context(
      'watchlist',
      { ...LISTED.query },
      { config: { 'search-lists': [OPENVERIFY_SANDBOX_SOURCE, 'un-sc'] } },
    );
    ctx.deps.watchlists = { ...ctx.deps.watchlists, unOptInAllowed: allowed };
    const outcome = await reportTypeJob('watchlist').run(ctx);
    if (outcome.kind !== 'completed') {
      throw new Error(`expected a completed run, got ${outcome.kind}`);
    }
    return outcome.result;
  }

  it('never screens un-sc for an environment that did not opt in, though its row is enabled', async () => {
    const result = await screenUn(true, {});
    expect(result.errors).toEqual([{ code: 'list_unavailable', source: 'un-sc' }]);
  });

  it('never screens un-sc while the install does not allow the opt-in, whatever the settings hold', async () => {
    for (const allowed of [false, undefined]) {
      const result = await screenUn(allowed, OPT_IN);
      expect(result.errors).toEqual([{ code: 'list_unavailable', source: 'un-sc' }]);
    }
  });

  it('screens un-sc for an environment that opted in while the install allows it', async () => {
    const result = await screenUn(true, OPT_IN);
    expect(result.errors).toEqual([]);
    expect(result.sources.map((source) => source.sourceId)).toEqual([
      OPENVERIFY_SANDBOX_SOURCE,
      'un-sc',
    ]);
  });
});

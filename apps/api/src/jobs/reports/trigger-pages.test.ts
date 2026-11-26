/**
 * Review C004 (owner decision 4 after Workflow 6C): a `list_update` run reads its trigger sync's
 * changed entries a page at a time and scores each page on its own (`keptOnly`), so it holds one
 * page of changed entries at most, and its whole result (matches, coverage, errors) equals the
 * screening of the whole set at once. Over the in-memory reads: a sync of 2,500 changed entries
 * (2.5 pages of 1,000) on a sanctions list and on a PEP list, at every preset, with PEP relatives
 * whose holders are on other pages, and a source whose scripts come from the entries the run loads.
 * Every name is fictional.
 */
import { resolveReportTemplateConfig } from '@openverify/contracts';
import type { ReportType } from '@openverify/core';
import type { Db, WatchlistReads, WatchlistSourceState } from '@openverify/db';
import * as watchlist from '@openverify/watchlist';
import {
  fictionalPersonName,
  OPENVERIFY_SANDBOX_PEP_SOURCE,
  OPENVERIFY_SANDBOX_SOURCE,
  seededRandom,
} from '@openverify/watchlist/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PHASE6_DEFAULTS } from '../../config.js';
import { catalogOf } from '../../services/reports/source-catalog.js';
import {
  createInMemoryWatchlists,
  fixedClock,
  type FakeWatchlistEntry,
} from '../../test-support/fakes.js';
import { createWorkerLogger } from '../logger.js';
import {
  reportTypeJob,
  type ReportRunContext,
  type ReportRunResult,
} from '../report-types/index.js';
import { useScreeningKit } from './screening.js';

vi.mock('@openverify/watchlist', async (original) => {
  const actual = await original<typeof import('@openverify/watchlist')>();
  return { ...actual, screenCandidates: vi.fn(actual.screenCandidates) };
});

const SHA = 'f0'.repeat(32);
const GROUPS = watchlist.variantGroupsFrom([], SHA);
/** Each list's trigger sync (a sync is of one source). */
const TRIGGERS = { 'openverify-sandbox': 9, 'openverify-sandbox-pep': 10 } as const;
const triggerOf = (sourceId: string) =>
  sourceId === OPENVERIFY_SANDBOX_PEP_SOURCE
    ? TRIGGERS['openverify-sandbox-pep']
    : TRIGGERS['openverify-sandbox'];
const CHANGED = 2_500;
const PAGE = 1_000;
const clock = fixedClock();
const random = seededRandom('trigger-pages');

const GIVEN = 'Orlanthe';
const FAMILY = 'Vexbury';
const ARABIC = ['أورلانث', 'فكسبري'] as const;

const individual = (
  entryId: string,
  first: string,
  last: string,
  extra: Partial<watchlist.WatchlistRecord> = {},
): watchlist.WatchlistRecord => ({
  entry_id: entryId,
  kind: 'individual',
  names: [
    {
      full: `${first} ${last}`,
      parts: [
        { role: 'given', value: first },
        { role: 'family', value: last },
      ],
      script: 'latin',
      quality: 'strong',
      primary: true,
    },
  ],
  birth_dates: [
    {
      value: `19${String(50 + random.between(0, 40))}-0${String(random.between(1, 9))}-12`,
      precision: 'day',
    },
  ],
  birth_places: [],
  countries: [],
  identifiers: [],
  addresses: [],
  crypto_addresses: [],
  programs: ['TRIGGER-PROGRAM'],
  listed_at: '2026-01-01',
  positions: [],
  relations: [],
  ...extra,
});

const position = (pepClass: number) => ({
  position: `Q-test-${String(3000 + pepClass)}`,
  label: `Synthetic office of class ${String(pepClass)}`,
  pep_class: pepClass,
  country: null,
  start: '2020-01-01',
  end: null,
  in_office: 'yes' as const,
});

const id = (prefix: string, index: number) => `${prefix}-${String(index).padStart(4, '0')}`;

/** The changed entries of one list: strangers, namesakes, typos and an Arabic-script namesake. */
function changedList(prefix: string, pep: boolean): watchlist.WatchlistRecord[] {
  return Array.from({ length: CHANGED }, (_, index) => {
    const extra = pep ? { positions: [position(1 + (index % 4))] } : {};
    if (index % 97 === 3) {
      return individual(id(prefix, index), GIVEN, FAMILY, extra);
    }
    if (index % 131 === 7) {
      return individual(id(prefix, index), GIVEN, `${FAMILY}r`, extra);
    }
    if (index === 1_222) {
      return {
        ...individual(id(prefix, index), GIVEN, FAMILY, extra),
        names: [
          {
            full: ARABIC.join(' '),
            parts: [],
            script: 'arabic',
            quality: 'strong',
            primary: true,
          },
        ],
      };
    }
    const name = fictionalPersonName(random);
    return individual(id(prefix, index), name.given.latin, name.family.latin, extra);
  });
}

function fake(
  sourceId: string,
  record: watchlist.WatchlistRecord,
  changed: boolean,
  keyed: boolean,
) {
  const entry: FakeWatchlistEntry = {
    sourceId,
    entryId: record.entry_id,
    kind: record.kind,
    contentHash: watchlist.contentHash(record),
    riskDataHash: watchlist.riskDataHash(record),
    data: record,
    removedAt: null,
    keys: keyed ? watchlist.recordNameRows(record, GROUPS).flatMap((row) => row.keys) : [],
    ...(changed ? { changedSyncId: triggerOf(sourceId) } : {}),
  };
  return entry;
}

const sanctions = changedList('TP', false);
const peps = changedList('PP', true);
// PEP relatives on the first page whose holders are on the third and second pages: one read
// through its linked holder (no class of its own), one with its own class.
peps[10] = individual(id('PP', 10), GIVEN, FAMILY, {
  relations: [{ relation: 'spouse', entity_id: id('PP', 2_400) }],
});
peps[20] = individual(id('PP', 20), GIVEN, `${FAMILY}r`, {
  relations: [{ relation: 'child', entity_id: id('PP', 1_500) }],
  relative_of_class: 2,
});
peps[2_400] = individual(id('PP', 2_400), 'Talmund', 'Corvane', { positions: [position(1)] });
peps[1_500] = individual(id('PP', 1_500), 'Ysolde', 'Corvane', { positions: [position(2)] });

const ENTRIES: FakeWatchlistEntry[] = [
  // Every 500th changed entry is also reached by its keys, so retrieval and the pages meet it.
  ...sanctions.map((record, index) =>
    fake(OPENVERIFY_SANDBOX_SOURCE, record, true, index % 500 === 3),
  ),
  ...peps.map((record, index) =>
    fake(OPENVERIFY_SANDBOX_PEP_SOURCE, record, true, index % 500 === 3),
  ),
  // Namesakes the sync did not change, which only retrieval reaches.
  fake(OPENVERIFY_SANDBOX_SOURCE, individual('TP-OLD-1', GIVEN, FAMILY), false, true),
  fake(
    OPENVERIFY_SANDBOX_PEP_SOURCE,
    individual('PP-OLD-1', GIVEN, FAMILY, { positions: [position(1)] }),
    false,
    true,
  ),
];

const description = (sourceId: string, kind: 'sanctions' | 'pep') => ({
  id: sourceId,
  kind,
  publisher: `Synthetic publisher of ${sourceId}`,
  refreshIntervalHours: null,
  staleAfterHours: null,
  sandboxOnly: true,
  attribution: `Synthetic attribution of ${sourceId}`,
  listUrl: null,
  flagCode: 'ZZ',
});
const CATALOG = catalogOf([
  description(OPENVERIFY_SANDBOX_SOURCE, 'sanctions'),
  description(OPENVERIFY_SANDBOX_PEP_SOURCE, 'pep'),
]);

const state = (sourceId: string): WatchlistSourceState => ({
  id: sourceId,
  enabled: true,
  sandboxOnly: true,
  keysVersion: watchlist.keysVersion(SHA),
  lastSyncId: triggerOf(sourceId),
  lastPublishedAt: new Date('2026-01-01T00:00:00.000Z'),
  lastSha256: 'c'.repeat(64),
  lastAppliedAt: clock.now(),
  lastCheckedAt: clock.now(),
  lastOrigin: 'import',
  lastErrorCode: null,
});

/** One load of a run: a page of the trigger's changes (after which entry), or entries by id. */
type Load = { page: string | null; rows: number } | { ids: string[] };

/**
 * The in-memory reads, with the sources' scripts left to the entries a run loads (a state without
 * them), and every load recorded; `whole` reads the trigger's changes as one page.
 */
function readsOf(loads: Load[], whole = false): WatchlistReads {
  const base = createInMemoryWatchlists(ENTRIES, [
    state(OPENVERIFY_SANDBOX_SOURCE),
    state(OPENVERIFY_SANDBOX_PEP_SOURCE),
  ]);
  return {
    retrieveCandidates: base.retrieveCandidates,
    getWatchlistSourceStates: async (db, sourceIds) =>
      (await base.getWatchlistSourceStates(db, sourceIds)).map((found) => ({
        ...found,
        scripts: undefined,
      })),
    loadEntries: async (db, query) => {
      const changed = query.changedInSync;
      const rows = await base.loadEntries(
        db,
        changed === undefined || !whole
          ? query
          : { ...query, changedInSync: { ...changed, limit: 1e9 } },
      );
      loads.push(
        changed === undefined
          ? { ids: query.entries.map(({ entryId }) => entryId) }
          : { page: changed.afterEntryId ?? null, rows: rows.length },
      );
      return rows;
    },
  };
}

function context(
  type: ReportType,
  query: Record<string, unknown>,
  config: Record<string, unknown>,
): ReportRunContext {
  const list =
    type === 'politically-exposed-person'
      ? OPENVERIFY_SANDBOX_PEP_SOURCE
      : OPENVERIFY_SANDBOX_SOURCE;
  return {
    report: {
      id: 'rep_01JSYNTHETICREPORT0000000',
      environmentId: 'env_01JSYNTHETICENVIRONMENT00',
      environmentKind: 'sandbox',
      type,
      origin: 'api',
      inquiryId: null,
      accountId: null,
      query,
      querySources: {},
      config: resolveReportTemplateConfig(type, { 'search-lists': [list], ...config }),
      createdAt: clock.now(),
    },
    run: {
      id: 'rpr_01JSYNTHETICRUN000000000',
      runType: 'list_update',
      triggerSyncId: triggerOf(list),
      attempt: 1,
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
    providers: {},
    signal: new AbortController().signal,
  };
}

let restore: () => void = () => undefined;

async function run(
  reads: WatchlistReads,
  type: ReportType,
  query: Record<string, unknown>,
  config: Record<string, unknown>,
): Promise<ReportRunResult> {
  restore = useScreeningKit({ reads: () => reads, groups: () => GROUPS, catalog: () => CATALOG });
  try {
    const outcome = await reportTypeJob(type).run(context(type, query, config));
    if (outcome.kind !== 'completed') {
      throw new Error(`expected a completed run, got ${outcome.kind}`);
    }
    return outcome.result;
  } finally {
    restore();
  }
}

const PRESETS = [
  { preset: 'exact' },
  { preset: 'strict' },
  { preset: 'tolerant' },
  {
    preset: 'custom',
    'min-score': 0.7,
    'allow-nicknames': true,
    'allow-variants': true,
    'typo-budget': 'high',
  },
] as const;

const CASES: {
  type: ReportType;
  query: Record<string, unknown>;
  config: Record<string, unknown>;
}[] = [
  { type: 'watchlist', query: { 'name-first': GIVEN, 'name-last': FAMILY }, config: {} },
  { type: 'watchlist', query: { 'name-first': ARABIC[0], 'name-last': ARABIC[1] }, config: {} },
  {
    type: 'politically-exposed-person',
    query: { 'name-first': GIVEN, 'name-last': FAMILY },
    config: { 'include-relatives': true },
  },
];

beforeEach(() => {
  vi.mocked(watchlist.screenCandidates).mockClear();
});

afterEach(() => {
  restore();
});

describe('a list_update run, a page of its trigger sync changes at a time (review C004)', () => {
  it.each(PRESETS.flatMap((preset) => CASES.map((item) => ({ ...item, preset }))))(
    'gives the whole-set result for $type at $preset.preset',
    async ({ type, query, config, preset }) => {
      const settings = { ...config, 'name-matching': preset };
      const whole = await run(readsOf([], true), type, query, settings);
      const paged = await run(readsOf([]), type, query, settings);

      expect(paged).toEqual(whole);
    },
  );

  it('keeps matches from every page, the relatives read through holders on other pages included', async () => {
    const result = await run(
      readsOf([]),
      'politically-exposed-person',
      { 'name-first': GIVEN, 'name-last': FAMILY },
      {
        'include-relatives': true,
        'name-matching': { preset: 'tolerant' },
      },
    );
    const kept = result.matches.map((match) => match.entryKey.split(':')[1]);
    expect(kept).toContain(id('PP', 10));
    expect(kept).toContain('PP-OLD-1');
    expect(kept.some((entryId) => (entryId ?? '') > id('PP', 2 * PAGE))).toBe(true);
    const spouse = result.matches.find((match) => match.entryKey.endsWith(id('PP', 10)));
    expect(spouse?.snapshot.entity).toMatchObject({
      'pep-type': 'relative',
      associates: [{ name: 'Talmund Corvane', relationship: 'spouse' }],
    });
  });

  it('states its coverage from the scripts of every page, not only the last', async () => {
    const result = await run(
      readsOf([]),
      'watchlist',
      { 'name-first': ARABIC[0], 'name-last': ARABIC[1] },
      { 'name-matching': { preset: 'tolerant' } },
    );

    // The only entry in Arabic script is on the second page of three.
    expect(result.coverage).toEqual({ complete: true, limits: [] });
  });

  it('scores each page on its own and loads its holders before it reads the next page', async () => {
    const loads: Load[] = [];
    await run(
      readsOf(loads),
      'politically-exposed-person',
      { 'name-first': GIVEN, 'name-last': FAMILY },
      {
        'include-relatives': true,
        'name-matching': { preset: 'tolerant' },
      },
    );

    const largest = Math.max(
      ...vi
        .mocked(watchlist.screenCandidates)
        .mock.calls.map(([, candidates]) => candidates.length),
    );
    expect(largest).toBeLessThanOrEqual(PAGE);
    const pages = loads.flatMap((load, at) => ('page' in load ? [at] : []));
    expect(pages.length).toBe(3);
    // The first page's relative names its holder on the third page, which is loaded by id before
    // the run reads the second page.
    const holder = loads.findIndex((load) => 'ids' in load && load.ids.includes(id('PP', 2_400)));
    expect(holder).toBeGreaterThan(pages[0] ?? Infinity);
    expect(holder).toBeLessThan(pages[1] ?? -1);
  });
});

/**
 * Owner decision 4 after Workflow 6C: the work one re-screen does, over PGlite. It must insert the
 * same `list_update` runs as the per-pair re-screen of Workflow 6C (the reference below: one
 * reverse index over every subject, keyed by the source's frequencies, and every (entry, subject)
 * pair it finds screened on its own at the subject's pinned configuration), while it reads each key
 * frequency once, resolves each pinned configuration once and screens each candidate subject once
 * per page of changed entries. Two sandbox environments, several chunks each, on a seeded synthetic
 * list (fictional names of `@openverify/watchlist/testing`) with namesakes, typos and strangers.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as contracts from '@openverify/contracts';
import { keyFrequencyBound, SCREENING_CONSTANTS, type ReportType } from '@openverify/core';
import {
  listChangedWatchlistEntries,
  listRecurringReportSubjects,
  type RecurringReportSubject,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  seedReport,
  seedReportTemplate,
  type TestDatabase,
} from '@openverify/db/testing';
import * as watchlist from '@openverify/watchlist';
import {
  normalisedImport,
  normalisedImportText,
  seededRandom,
  syntheticWatchlist,
} from '@openverify/watchlist/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { WatchlistSettings } from '../../config.js';
import type { MatcherData } from '../../watchlists/matcher-data.js';
import { reconcileWatchlistSources } from '../../watchlists/reconcile.js';
import { sharedWatchlistSession, syncWatchlistSource } from '../../watchlists/sync.js';
import { businessWatchlistScreening } from '../report-types/business-watchlist.js';
import { watchlistScreening } from '../report-types/watchlist.js';
import { processReportRescreen } from './rescreen.js';

vi.mock('@openverify/contracts', async (original) => {
  const actual = await original<typeof import('@openverify/contracts')>();
  return {
    ...actual,
    resolveReportTemplateConfig: vi.fn(actual.resolveReportTemplateConfig),
  };
});
vi.mock('@openverify/watchlist', async (original) => {
  const actual = await original<typeof import('@openverify/watchlist')>();
  return { ...actual, screenCandidates: vi.fn(actual.screenCandidates) };
});

const SOURCE = 'openverify-sandbox';
const NOW = new Date('2026-10-27T12:00:00.000Z');
const SHA = 'c'.repeat(64);
const GROUPS = watchlist.variantGroupsFrom([], SHA);
const MATCHER: MatcherData = {
  status: 'loaded',
  groups: GROUPS,
  keysVersion: watchlist.keysVersion(SHA),
};
const SETTINGS = {
  removedRetentionDays: 90,
  pep: {
    includeRelatives: false,
    openTenureMaxYears: 20,
    retentionMonths: 12,
    headRetentionMonths: 60,
  },
} as WatchlistSettings;
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
const TYPES: ReportType[] = ['watchlist', 'business-watchlist', 'crypto-address-watchlist'];
/** Subjects per chunk: each environment's reports take several chunks. */
const CHUNK = 7;

let database: TestDatabase;
let files: string;
let syncId: number;
const environments: string[] = [];

const listed = syntheticWatchlist({
  seed: 'rescreen-work',
  individuals: 40,
  entities: 12,
  vessels: 0,
  aircraft: 0,
  hanNames: false,
});

const primaryParts = (record: watchlist.WatchlistRecord | undefined) => {
  const primary = record?.names.find((name) => name.primary);
  const part = (role: string) => primary?.parts.find((item) => item.role === role)?.value ?? '';
  return { first: part('given'), last: part('family'), full: primary?.full ?? '' };
};

/** A person entry of `first last`, born on `birthdate`. */
const person = (
  entryId: string,
  first: string,
  last: string,
  birthdate: string,
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
  birth_dates: [{ value: birthdate, precision: 'day' }],
  birth_places: [],
  countries: [],
  identifiers: [],
  addresses: [],
  crypto_addresses: [],
  programs: ['WORK-PROGRAM'],
  listed_at: '2026-01-01',
  positions: [],
  relations: [],
});

async function sync(name: string, records: readonly watchlist.WatchlistRecord[], at: string) {
  const path = join(files, name);
  await writeFile(path, normalisedImportText(normalisedImport(SOURCE, at, [...records])));
  const result = await syncWatchlistSource(
    {
      db: database.db,
      connect: sharedWatchlistSession(database.db),
      clock: { now: () => NOW },
      logger: silent,
      settings: SETTINGS,
      matcherData: () => MATCHER,
    },
    { sourceId: SOURCE, actor: 'seed', importPath: path },
  );
  if (result.outcome !== 'applied' || result.syncId === null) {
    throw new Error(`the import of ${name} did not apply`);
  }
  return result.syncId;
}

/** One environment's recurring reports: namesakes in several chunks, typos, swaps and strangers. */
async function seedEnvironment(environmentId: string, stream: string): Promise<void> {
  const random = seededRandom(`rescreen-work/${stream}`);
  const recurring = { recurrenceIntervalDays: 30, nextRunAt: new Date('2026-11-26T12:00:00.000Z') };
  const pinned = { 'search-lists': [SOURCE] };
  const people = await Promise.all(
    [{ preset: 'tolerant' }, { preset: 'strict' }, { preset: 'exact' }].map((preset) =>
      seedReportTemplate(database.db, environmentId, {
        config: { ...pinned, 'name-matching': preset },
      }),
    ),
  );
  const business = await seedReportTemplate(database.db, environmentId, {
    reportType: 'business-watchlist',
    config: pinned,
  });
  const crypto = await seedReportTemplate(database.db, environmentId, {
    reportType: 'crypto-address-watchlist',
    config: pinned,
  });
  const individuals = listed.filter((record) => record.kind === 'individual');
  const queries: Record<string, unknown>[] = [];
  individuals.slice(0, 12).forEach((record) => {
    const { first, last } = primaryParts(record);
    queries.push(
      { 'name-first': first, 'name-last': last },
      { term: `${last} ${first}` },
      { 'name-first': first, 'name-last': `${last}e` },
      { 'name-first': `${first.charAt(0)}.`, 'name-last': last },
    );
  });
  for (let index = 0; index < 6; index += 1) {
    queries.push({ 'name-first': `Quillon${String(index)}`, 'name-last': 'Zephyrine' });
  }
  for (const query of queries) {
    await seedReport(database.db, environmentId, {
      ...random.pick(people),
      ...recurring,
      query,
    });
  }
  for (const record of listed.filter((item) => item.kind === 'entity').slice(0, 6)) {
    await seedReport(database.db, environmentId, {
      ...business,
      ...recurring,
      reportType: 'business-watchlist',
      query: { term: primaryParts(record).full },
    });
  }
  const address = listed.flatMap((record) => record.crypto_addresses)[0];
  if (address !== undefined) {
    await seedReport(database.db, environmentId, {
      ...crypto,
      ...recurring,
      reportType: 'crypto-address-watchlist',
      query: { 'crypto-address': address.raw },
    });
  }
}

beforeAll(async () => {
  database = await createTestDatabase();
  files = await mkdtemp(join(tmpdir(), 'openverify-rescreen-work-'));
  await reconcileWatchlistSources(database.db, { disabled: [] });
  await sync('v1.json', listed, '2026-10-01T00:00:00.000Z');
  for (const stream of ['a', 'b']) {
    const { environment } = await createTestTenant(database.db);
    environments.push(environment.id);
    await seedEnvironment(environment.id, stream);
  }
  // The changed entries: namesakes of listed persons (each met by its namesakes' subjects), people
  // who share only a family name with a listed one (met by key, never matched), and strangers.
  const individuals = listed.filter((record) => record.kind === 'individual');
  const added: watchlist.WatchlistRecord[] = [];
  individuals.slice(0, 12).forEach((record, index) => {
    const { first, last } = primaryParts(record);
    const day = String(10 + (index % 18));
    added.push(person(`WORK-N${String(index)}`, first, last, `1971-03-${day}`));
    for (let other = 0; other < 3; other += 1) {
      added.push(
        person(
          `WORK-F${String(index)}-${String(other)}`,
          `Ober${String(other)}lin`,
          last,
          '1980-05-05',
        ),
      );
    }
  });
  for (let index = 0; index < 4; index += 1) {
    added.push(
      person(`WORK-S${String(index)}`, `Quillon${String(index)}`, 'Zephyrine', '1960-02-02'),
    );
  }
  syncId = await sync('v2.json', [...listed, ...added], '2026-10-02T00:00:00.000Z');
}, 120_000);

afterAll(async () => {
  await database.close();
  await rm(files, { recursive: true, force: true });
});

const NAME_SCREENINGS: Partial<
  Record<ReportType, typeof watchlistScreening | typeof businessWatchlistScreening>
> = { watchlist: watchlistScreening, 'business-watchlist': businessWatchlistScreening };

/** The reference: the subject of a row and its screen of one entry, as Workflow 6C built them. */
function referenceSubject(row: RecurringReportSubject) {
  const type = row.reportType as ReportType;
  const query = contracts.REPORT_QUERY_SCHEMAS[type].parse(row.query) as Record<string, unknown>;
  if (type === 'crypto-address-watchlist') {
    const crypto = query as { 'crypto-address': string; 'chain-id'?: string | null };
    const address = watchlist.canonicaliseCryptoAddress(crypto['crypto-address'], {
      chainId: crypto['chain-id'] ?? null,
    });
    return {
      reverse: { id: row.reportId, cryptoAddress: address?.canonical },
      screen: (candidate: watchlist.ScreeningCandidate) =>
        watchlist.screenCryptoAddress(crypto, [candidate]).matches.length > 0,
    };
  }
  const config = contracts.resolveReportTemplateConfig(type, row.config);
  const spec = (NAME_SCREENINGS[type] ?? watchlistScreening)(query, config);
  const subject = spec.subject();
  const options = {
    ...spec.options,
    nameMatching: watchlist.resolveNameMatching(
      config['name-matching'] as watchlist.NameMatchingConfig,
    ),
    groups: GROUPS,
    keptOnly: true,
  };
  return {
    reverse: { id: row.reportId, subject },
    screen: (candidate: watchlist.ScreeningCandidate) =>
      watchlist.screenCandidates(subject, [candidate], options).length > 0,
  };
}

/** The reference's runs of one environment, and the (entry, subject) pairs it screened. */
async function referenceRuns(environmentId: string) {
  const rows = await listRecurringReportSubjects(database.db, environmentId, {
    sourceId: SOURCE,
    reportTypes: TYPES,
    limit: 50_000,
  });
  const frequencies = new Map(
    (
      await database.db.execute(
        sql`select key, count from watchlist_key_df where source_id = ${SOURCE}`,
      )
    ).rows.map((row) => [String(row.key), Number(row.count)]),
  );
  const subjects = new Map(rows.map((row) => [row.reportId, referenceSubject(row)]));
  const index = watchlist.buildReverseIndex(
    [...subjects.values()].map((subject) => subject.reverse),
    GROUPS,
    { frequencies, bound: keyFrequencyBound(SCREENING_CONSTANTS['candidate-cap'].value) },
  );
  const changed = await listChangedWatchlistEntries(database.db, {
    sourceId: SOURCE,
    syncId,
    limit: 10_000,
  });
  const hits = new Set<string>();
  let pairs = 0;
  for (const entry of changed) {
    const candidate = { sourceId: entry.sourceId, record: entry.data as watchlist.WatchlistRecord };
    for (const reportId of index.candidatesFor(candidate.record)) {
      pairs += 1;
      if (subjects.get(reportId)?.screen(candidate) === true) {
        hits.add(reportId);
      }
    }
  }
  return { runs: [...hits].sort(), pairs, subjects: rows.length };
}

const listUpdateRuns = async (environmentId: string) =>
  (
    await database.db.execute(
      sql`select report_id from report_runs
           where environment_id = ${environmentId} and trigger_sync_id = ${syncId}
           order by report_id`,
    )
  ).rows.map((row) => String(row.report_id));

/** What one re-screen did, counted: its result, configurations, screenings and frequency reads. */
async function rescreenWork(extra: { frequencyTableRows?: number } = {}) {
  const query = vi.spyOn(database.client, 'query');
  vi.mocked(contracts.resolveReportTemplateConfig).mockClear();
  vi.mocked(watchlist.screenCandidates).mockClear();
  try {
    const result = await processReportRescreen(
      { syncId },
      {
        db: database.db,
        clock: { now: () => NOW },
        logger: silent,
        watchlists: SETTINGS,
        matcherData: () => MATCHER,
        blindIndexKey: new Uint8Array(32).fill(0x5c),
        subjectsPerChunk: CHUNK,
        ...extra,
      },
    );
    return {
      result,
      configs: vi.mocked(contracts.resolveReportTemplateConfig).mock.calls.length,
      screens: vi.mocked(watchlist.screenCandidates).mock.calls.length,
      screened: vi
        .mocked(watchlist.screenCandidates)
        .mock.calls.map(([subject, candidates, options]) => ({ subject, candidates, options })),
      // The keys each statement on the frequencies bound (the source id left out).
      keyReads: query.mock.calls
        .filter(([text]) => text.includes('watchlist_key_df'))
        .map(([, params]) =>
          (params ?? []).flatMap((param) =>
            Array.isArray(param)
              ? param.map(String)
              : typeof param === 'string' && param !== SOURCE
                ? [param]
                : [],
          ),
        ),
    };
  } finally {
    query.mockRestore();
  }
}

describe('the work of one re-screen (owner decision 4 after 6C)', () => {
  const reference: Record<string, Awaited<ReturnType<typeof referenceRuns>>> = {};
  let work: Awaited<ReturnType<typeof rescreenWork>>;
  let keyByKey: Awaited<ReturnType<typeof rescreenWork>>;

  beforeAll(async () => {
    for (const environmentId of environments) {
      reference[environmentId] = await referenceRuns(environmentId);
    }
    work = await rescreenWork();
    // The same re-screen again, reading the frequencies key by key (its runs exist already).
    await database.db.execute(
      sql`update watchlist_syncs set rescreen_state = 'pending' where id = ${syncId}`,
    );
    keyByKey = await rescreenWork({ frequencyTableRows: 0 });
  }, 120_000);

  it('inserts the runs of the per-pair re-screen, in every environment and chunk', async () => {
    for (const environmentId of environments) {
      const expected = reference[environmentId];
      expect(expected?.subjects).toBeGreaterThan(3 * CHUNK);
      expect(expected?.runs.length).toBeGreaterThan(10);
      expect(await listUpdateRuns(environmentId)).toEqual(expected?.runs);
    }
    const runs = Object.values(reference).reduce((sum, item) => sum + item.runs.length, 0);
    expect(work.result.matched).toBe(runs);
    expect(keyByKey.result).toMatchObject({ matched: runs, runsInserted: 0 });
  });

  it('resolves each pinned configuration once, whatever its number of subjects', async () => {
    const [row] = (
      await database.db.execute(
        sql`select count(distinct report_template_version_id)::int as versions from reports
             where report_type in ('watchlist', 'business-watchlist') and next_run_at is not null`,
      )
    ).rows;
    expect(Number(row?.versions)).toBeGreaterThan(environments.length);
    expect(work.configs).toBe(Number(row?.versions));
  });

  it('screens each candidate subject once per page of changed entries, over every entry that reaches it', () => {
    const subjects = Object.values(reference).reduce((sum, item) => sum + item.subjects, 0);
    const pairs = Object.values(reference).reduce((sum, item) => sum + item.pairs, 0);
    // The per-pair re-screen screened each (entry, subject) pair on its own.
    expect(pairs).toBeGreaterThan(2 * subjects);
    expect(work.screens).toBeGreaterThan(0);
    expect(work.screens).toBeLessThanOrEqual(subjects);
  });

  it('screens only the candidates whose name bound reaches the display floor, when no identifier or weak alias can match', () => {
    const floor = SCREENING_CONSTANTS['display-floor'].value;
    const pairs = Object.values(reference).reduce((sum, item) => sum + item.pairs, 0);
    const screened = work.screened.flatMap(({ subject, candidates, options }) =>
      candidates.map((candidate) => ({ subject, candidate, options })),
    );
    expect(screened.length).toBeGreaterThan(0);
    expect(screened.length).toBeLessThan(pairs / 2);
    for (const { subject, candidate, options } of screened) {
      const bounds = candidate.record.names
        .filter((name) => name.quality === 'strong')
        .flatMap((name) =>
          subject.names.map((own) =>
            watchlist.nameScoreUpperBound(
              own,
              watchlist.analyseRecordName(name, candidate.record.kind),
              options.nameMatching,
              GROUPS,
            ),
          ),
        );
      expect(subject.identifiers.length > 0 || Math.max(0, ...bounds) >= floor).toBe(true);
    }
  });

  it('states where its time went, and how many pairs it found and screenings it made', () => {
    const pairs = Object.values(reference).reduce((sum, item) => sum + item.pairs, 0);
    expect(work.result.candidatePairs).toBe(pairs);
    expect(work.result.screenings).toBe(work.screens);
    const phases: Partial<Record<string, number>> = { ...work.result.phases };
    expect(Object.keys(phases).sort()).toEqual(
      [
        'build',
        'candidates',
        'changed',
        'frequencies',
        'prepare',
        'runs',
        'screen',
        'specs',
        'subjects',
      ].sort(),
    );
    for (const milliseconds of Object.values(phases)) {
      expect(milliseconds !== undefined && Number.isFinite(milliseconds) && milliseconds >= 0).toBe(
        true,
      );
    }
  });

  it('reads a source’s frequency table whole, in statements that bind no key, when it fits', () => {
    expect(work.keyReads.length).toBeGreaterThan(0);
    expect(work.keyReads.length).toBeLessThanOrEqual(2);
    expect(work.keyReads.flat()).toEqual([]);
  });

  it('reads each key frequency once, for every chunk and environment, when it reads them key by key', () => {
    const keys = keyByKey.keyReads.flat();
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.length).toBe(new Set(keys).size);
  });
});

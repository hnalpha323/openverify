/**
 * C271.2 (Workflow 11D, `matcher-c787-11d`; Stage 1a amendments 4 and 7): the re-screen's levers,
 * each behind its switch of `@openverify/db`'s registry and off by default. With a lever on, one
 * re-screen inserts exactly the `list_update` runs it inserts with the lever off, finds the same
 * (entry, subject) pairs and makes the same screenings, in every environment and chunk; the lever
 * only does less work. Over PGlite, on a seeded synthetic list (fictional names of
 * `@openverify/watchlist/testing`) with namesakes, typos and strangers in two sandbox environments.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useWatchlistSwitches, watchlistSwitchEnabled } from '@openverify/db';
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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WatchlistSettings } from '../../config.js';
import type { MatcherData } from '../../watchlists/matcher-data.js';
import { reconcileWatchlistSources } from '../../watchlists/reconcile.js';
import { sharedWatchlistSession, syncWatchlistSource } from '../../watchlists/sync.js';
import { processReportRescreen } from './rescreen.js';

const SOURCE = 'openverify-sandbox';
const NOW = new Date('2026-10-27T12:00:00.000Z');
const SHA = 'd'.repeat(64);
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
/** Subjects per chunk: each environment's reports take several chunks. */
const CHUNK = 9;

const listed = syntheticWatchlist({
  seed: 'rescreen-levers',
  individuals: 40,
  entities: 10,
  vessels: 0,
  aircraft: 0,
  hanNames: false,
});

const primaryParts = (record: watchlist.WatchlistRecord | undefined) => {
  const primary = record?.names.find((name) => name.primary);
  const part = (role: string) => primary?.parts.find((item) => item.role === role)?.value ?? '';
  return { first: part('given'), last: part('family'), full: primary?.full ?? '' };
};

const individuals = listed.filter((record) => record.kind === 'individual');
// Variant groups over the list's own given names, so group pairs are bounded too.
const GROUPS = watchlist.variantGroupsFrom(
  individuals.slice(0, 10).map((record, index) => {
    const first = primaryParts(record).first.toLowerCase();
    return [`Q${String(index + 1)}`, [first, `${first}a`]];
  }),
  SHA,
);
const MATCHER: MatcherData = {
  status: 'loaded',
  groups: GROUPS,
  keysVersion: watchlist.keysVersion(SHA),
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
  programs: ['LEVER-PROGRAM'],
  listed_at: '2026-01-01',
  positions: [],
  relations: [],
});

let database: TestDatabase;
let files: string;
let syncId: number;
const environments: string[] = [];

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

/** One environment's recurring reports at three presets: namesakes, typos, swaps and strangers. */
async function seedEnvironment(environmentId: string, stream: string): Promise<void> {
  const random = seededRandom(`rescreen-levers/${stream}`);
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
  for (const record of individuals.slice(0, 12)) {
    const { first, last } = primaryParts(record);
    for (const query of [
      { 'name-first': first, 'name-last': last },
      { term: `${last} ${first}` },
      { 'name-first': `${first}a`, 'name-last': last },
      { 'name-first': first, 'name-last': `${last}e` },
      { 'name-first': `${first.charAt(0)}.`, 'name-last': last },
    ]) {
      await seedReport(database.db, environmentId, { ...random.pick(people), ...recurring, query });
    }
  }
  for (let index = 0; index < 5; index += 1) {
    await seedReport(database.db, environmentId, {
      ...random.pick(people),
      ...recurring,
      query: { 'name-first': `Quillon${String(index)}`, 'name-last': 'Zephyrine' },
    });
  }
  for (const record of listed.filter((item) => item.kind === 'entity').slice(0, 5)) {
    await seedReport(database.db, environmentId, {
      ...business,
      ...recurring,
      reportType: 'business-watchlist',
      query: { term: primaryParts(record).full },
    });
  }
}

beforeAll(async () => {
  database = await createTestDatabase();
  files = await mkdtemp(join(tmpdir(), 'openverify-rescreen-levers-'));
  await reconcileWatchlistSources(database.db, { disabled: [] });
  await sync('v1.json', listed, '2026-10-01T00:00:00.000Z');
  for (const stream of ['a', 'b']) {
    const { environment } = await createTestTenant(database.db);
    environments.push(environment.id);
    await seedEnvironment(environment.id, stream);
  }
  // Namesakes of listed persons, people sharing only a family name with one, and strangers.
  const added: watchlist.WatchlistRecord[] = [];
  individuals.slice(0, 12).forEach((record, index) => {
    const { first, last } = primaryParts(record);
    added.push(person(`LEVER-N${String(index)}`, first, last, `1971-03-${String(10 + index)}`));
    added.push(person(`LEVER-V${String(index)}`, `${first}a`, last, '1975-07-07'));
    for (let other = 0; other < 2; other += 1) {
      added.push(
        person(
          `LEVER-F${String(index)}-${String(other)}`,
          `Ober${String(other)}lin`,
          last,
          '1980-05-05',
        ),
      );
    }
  });
  for (let index = 0; index < 3; index += 1) {
    added.push(
      person(`LEVER-S${String(index)}`, `Quillon${String(index)}`, 'Zephyrine', '1960-02-02'),
    );
  }
  syncId = await sync('v2.json', [...listed, ...added], '2026-10-02T00:00:00.000Z');
}, 120_000);

afterAll(async () => {
  await database.close();
  await rm(files, { recursive: true, force: true });
});

/** The `list_update` runs of the sync, by environment. */
async function listUpdateRuns(): Promise<Record<string, string[]>> {
  const runs: Record<string, string[]> = {};
  for (const environmentId of environments) {
    runs[environmentId] = (
      await database.db.execute(
        sql`select report_id from report_runs
             where environment_id = ${environmentId} and trigger_sync_id = ${syncId}
             order by report_id`,
      )
    ).rows.map((row) => String(row.report_id));
  }
  return runs;
}

/** One re-screen of the sync from scratch, with `switches` on: its runs, its counts and its work. */
async function rescreenWith(switches: Parameters<typeof useWatchlistSwitches>[0]) {
  await database.db.execute(
    sql`delete from report_runs where trigger_sync_id = ${syncId} and run_type = 'list_update'`,
  );
  await database.db.execute(
    sql`update watchlist_syncs set rescreen_state = 'pending' where id = ${syncId}`,
  );
  const restore = useWatchlistSwitches(switches);
  try {
    watchlist.resetScorerWork();
    const result = await processReportRescreen(
      { syncId },
      {
        db: database.db,
        clock: { now: () => NOW },
        logger: silent,
        watchlists: SETTINGS,
        matcherData: () => MATCHER,
        blindIndexKey: new Uint8Array(32).fill(0x3c),
        subjectsPerChunk: CHUNK,
      },
    );
    const work = watchlist.scorerWork();
    return {
      runs: await listUpdateRuns(),
      counts: {
        environments: result.environments,
        subjects: result.subjects,
        runsInserted: result.runsInserted,
        matched: result.matched,
        stale: result.stale,
        candidatePairs: result.candidatePairs,
        screenings: result.screenings,
      },
      pairScores: work.pairScores,
    };
  } finally {
    restore();
  }
}

describe('the re-screen levers (C271.2)', () => {
  it('rescreen-bound-memo is off by default, and on, inserts the same runs, finds and screens the same, and scores fewer token pairs', async () => {
    expect(watchlistSwitchEnabled('rescreen-bound-memo')).toBe(false);
    const off = await rescreenWith({});
    const on = await rescreenWith({ 'rescreen-bound-memo': true });
    expect(watchlistSwitchEnabled('rescreen-bound-memo')).toBe(false);

    expect(off.counts.environments).toBe(2);
    expect(off.counts.subjects).toBeGreaterThan(4 * CHUNK);
    expect(off.counts.matched).toBeGreaterThan(10);
    expect(on.runs).toEqual(off.runs);
    expect(on.counts).toEqual(off.counts);
    expect(on.pairScores).toBeLessThan(off.pairScores);
  });
});

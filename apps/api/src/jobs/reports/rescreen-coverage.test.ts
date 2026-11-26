/**
 * Owner decision 3 after 6B: the re-screen gives a `list_update` run to exactly the recurring
 * reports whose own full screening (retrieval, the entry loads and the score at the report's preset)
 * now matches an entry the sync added or changed: none missed, and none the report's own preset
 * would not keep. Over PGlite, on a seeded synthetic list (fictional names of
 * `@openverify/watchlist/testing`) and seeded subjects: listed names, their order swaps, typos,
 * initials and respellings, and strangers, at every fixed preset.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveReportTemplateConfig } from '@openverify/contracts';
import {
  createTestDatabase,
  createTestTenant,
  seedReport,
  seedReportTemplate,
  type TestDatabase,
} from '@openverify/db/testing';
import { keysVersion, variantGroupsFrom, type WatchlistRecord } from '@openverify/watchlist';
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
import { watchlistReportJob } from '../report-types/watchlist.js';
import type { ReportRunContext } from '../report-types/job.js';
import { processReportRescreen } from './rescreen.js';
import { useScreeningKit } from './screening.js';

const SOURCE = 'openverify-sandbox';
const NOW = new Date('2026-10-27T12:00:00.000Z');
const SHA = 'b'.repeat(64);
const GROUPS = variantGroupsFrom([], SHA);
const MATCHER: MatcherData = { status: 'loaded', groups: GROUPS, keysVersion: keysVersion(SHA) };
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

let database: TestDatabase;
let environmentId: string;
let files: string;
let syncId: number;
const configs = new Map<string, Record<string, unknown>>();
const queries = new Map<string, Record<string, unknown>>();

const listed = syntheticWatchlist({
  seed: 'rescreen-coverage',
  individuals: 80,
  entities: 0,
  vessels: 0,
  aircraft: 0,
  hanNames: false,
});

const partsOf = (record: WatchlistRecord | undefined) => {
  const primary = record?.names.find((name) => name.primary);
  const part = (role: string) => primary?.parts.find((item) => item.role === role)?.value ?? '';
  return { first: part('given'), last: part('family') };
};

/** A person entry of `first last`, with a birth date. */
const person = (
  entryId: string,
  first: string,
  last: string,
  birthdate: string,
): WatchlistRecord => ({
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
  programs: ['COVERAGE-PROGRAM'],
  listed_at: '2026-01-01',
  positions: [],
  relations: [],
});

async function sync(name: string, records: readonly WatchlistRecord[], publishedAt: string) {
  const path = join(files, name);
  await writeFile(path, normalisedImportText(normalisedImport(SOURCE, publishedAt, [...records])));
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

beforeAll(async () => {
  database = await createTestDatabase();
  files = await mkdtemp(join(tmpdir(), 'openverify-rescreen-coverage-'));
  await reconcileWatchlistSources(database.db, { disabled: [] });
  ({
    environment: { id: environmentId },
  } = await createTestTenant(database.db));
  await sync('v1.json', listed, '2026-10-01T00:00:00.000Z');

  const random = seededRandom('rescreen-coverage/subjects');
  const templates = await Promise.all(
    PRESETS.map((preset) =>
      seedReportTemplate(database.db, environmentId, {
        config: { 'search-lists': [SOURCE], 'name-matching': preset },
      }),
    ),
  );
  // The added entries: a namesake, a typo and a respelling of some listed names, and strangers.
  const added: WatchlistRecord[] = [];
  listed.slice(0, 30).forEach((record, index) => {
    const { first, last } = partsOf(record);
    const variant = index % 3;
    added.push(
      person(
        `COV-${String(index).padStart(3, '0')}`,
        variant === 2 ? `${first}a` : first,
        variant === 1 ? `${last.slice(0, -1)}${last.endsWith('e') ? 'a' : 'e'}` : last,
        `19${String(50 + (index % 40))}-0${String(1 + (index % 9))}-1${String(index % 9)}`,
      ),
    );
  });
  for (let index = 0; index < 10; index += 1) {
    added.push(
      person(`COV-S${String(index)}`, `Quillon${String(index)}`, 'Zephyrine', '1960-02-02'),
    );
  }
  // The subjects: each listed name as written, swapped, with a typo or an initial, and strangers,
  // each at a preset drawn from the seed.
  const subjects: Record<string, unknown>[] = [];
  listed.slice(0, 40).forEach((record) => {
    const { first, last } = partsOf(record);
    subjects.push(
      { 'name-first': first, 'name-last': last },
      { term: `${last} ${first}` },
      { 'name-first': first, 'name-last': `${last.slice(0, -1)}${last.endsWith('e') ? 'a' : 'e'}` },
      { term: `${first.charAt(0)}. ${last}` },
      { 'name-first': `${first}a`, 'name-last': last },
    );
  });
  for (let index = 0; index < 20; index += 1) {
    subjects.push({ 'name-first': `Quillon${String(index)}`, 'name-last': 'Zephyrine' });
  }
  for (const query of subjects) {
    const template = random.pick(templates);
    const reportId = await seedReport(database.db, environmentId, {
      ...template,
      recurrenceIntervalDays: 30,
      nextRunAt: new Date('2026-11-26T12:00:00.000Z'),
      query,
    });
    queries.set(reportId, query);
    const preset = PRESETS[templates.indexOf(template)];
    configs.set(reportId, { 'search-lists': [SOURCE], 'name-matching': preset });
  }
  syncId = await sync('v2.json', [...listed, ...added], '2026-10-02T00:00:00.000Z');
}, 120_000);

afterAll(async () => {
  await database.close();
  await rm(files, { recursive: true, force: true });
});

/**
 * A report's own full screening (nothing persisted): as a scheduled run makes it, or as its
 * `list_update` run of the sync makes it, which also screens the entries the sync changed.
 */
async function screened(reportId: string, listUpdate = false): Promise<string[]> {
  const ctx: ReportRunContext = {
    report: {
      id: reportId,
      environmentId,
      environmentKind: 'sandbox',
      type: 'watchlist',
      origin: 'api',
      inquiryId: null,
      accountId: null,
      query: queries.get(reportId) ?? {},
      querySources: {},
      config: resolveReportTemplateConfig('watchlist', configs.get(reportId) ?? {}),
      createdAt: NOW,
    },
    run: listUpdate
      ? { id: 'rpr_coverage', runType: 'list_update', triggerSyncId: syncId, attempt: 1 }
      : { id: 'rpr_coverage', runType: 'scheduled', triggerSyncId: null, attempt: 1 },
    deps: {
      db: database.db,
      clock: { now: () => NOW },
      logger: silent,
      watchlists: SETTINGS,
      limits: { perMinute: 600, maxRecurringPerEnvironment: 250_000, maxMediaRunsPerDay: 8_640 },
    },
    providers: {},
    signal: new AbortController().signal,
  };
  const outcome = await watchlistReportJob.run(ctx);
  return outcome.kind === 'completed'
    ? outcome.result.matches.map((match) => match.entryKey.slice(SOURCE.length + 1))
    : [];
}

describe('the re-screen against the full screening (owner decision 3 after 6B)', () => {
  it('gives a run to every report whose own screening now matches a changed entry, and only to reports whose list_update run keeps one', async () => {
    const restore = useScreeningKit({ groups: () => GROUPS });
    try {
      const result = await processReportRescreen(
        { syncId },
        {
          db: database.db,
          clock: { now: () => NOW },
          logger: silent,
          watchlists: SETTINGS,
          matcherData: () => MATCHER,
          blindIndexKey: new Uint8Array(32).fill(0x3d),
        },
      );
      const changed = new Set(
        (
          await database.db.execute(
            sql`select entry_id from watchlist_entries where changed_sync_id = ${syncId}`,
          )
        ).rows.map((row) => String(row.entry_id)),
      );
      expect(changed.size).toBe(40);
      const scheduled: string[] = [];
      const listUpdate: string[] = [];
      for (const reportId of queries.keys()) {
        if ((await screened(reportId)).some((entryId) => changed.has(entryId))) {
          scheduled.push(reportId);
        }
        if ((await screened(reportId, true)).some((entryId) => changed.has(entryId))) {
          listUpdate.push(reportId);
        }
      }
      const runs = (
        await database.db.execute(
          sql`select report_id from report_runs where trigger_sync_id = ${syncId} order by report_id`,
        )
      ).rows.map((row) => String(row.report_id));

      expect(scheduled.length).toBeGreaterThan(20);
      // None missed: every report its own retrieval and score match gets a run.
      expect(scheduled.filter((reportId) => !runs.includes(reportId))).toEqual([]);
      // None wasted: every run's report keeps a match on a changed entry in that run.
      expect(runs.filter((reportId) => !listUpdate.includes(reportId))).toEqual([]);
      expect(runs.length).toBeLessThan(165);
      expect(result.runsInserted).toBe(runs.length);
    } finally {
      restore();
    }
  }, 120_000);
});

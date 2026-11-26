/**
 * C76.2 (P07), C78.3, C78.7 (V11): the watchlist sync and candidate retrieval on real Postgres
 * (Testcontainers, `pgvector/pgvector:pg17` with bind-parameter logging off, C73.8), each sync on
 * its own pool connection as the CLIs and the worker run it. Every list is synthetic and imported
 * from a temporary file, so nothing touches a publisher or the network.
 *
 * **The 100,000-name gate (owner decision 2 after 6B, decision 6 after 6C).** Its table is the
 * calibration's, by construction: `@openverify/watchlist/testing`'s `heavyHeadedTable`, the one
 * definition `benchmark-performance.mjs` draws too, of the gate's fixed seed, the evaluation seed
 * `docs/calibration/watchlist-phase6c.md` published (`test-support/heavy-headed-list.ts`), so it
 * screens the table and subjects that report measured: the raw rigour groups of `data/` plus 40,000
 * fictional names by Zipf's law with exponent 1 (a flat draw of rare tokens would make every search
 * short), the sanctions profile, 100,000 names, 150 listed and 150 unlisted subjects. Generated
 * from a seed, its own law's draws differ: the limits on the cap below were set on this draw, and a
 * fresh seed bound the cap in 11 of 300 searches. It is keyed with the shipped variant groups
 * (`data/variant-groups.json` with the shipped digest). One screening is the `watchlist` job's with
 * the default `tolerant` configuration: the source state, retrieval, the entry loads, scoring and
 * coverage.
 *
 * **One round, as one calibration take.** The gate screens the 300 subjects once after 20 warm-ups,
 * the benchmark's `100k-measure --rounds 1`. **The calibration report is the authority for the
 * budgets**: it takes the median of three such rounds at a load of at most 4, under the e2e lock
 * (`docs/calibration/watchlist-phase6c.md`, then Workflow 6D's `watchlist-phase6d.md`), so a gate
 * pass alone is not the budget met.
 *
 * **The case it ran** opens its output line: `shipped-variant-groups` when both data files are
 * there (the calibration's case), else each one missing (`no-variant-groups`, `no-raw-groups`).
 *
 * It asserts what does not depend on the machine, as decision 2 after 6B set it: every listed
 * subject found, the candidates' p95 within the cap, the cap binding in at most 6 of 300 searches,
 * a would-be `result_truncated` in at most 3 of 300, and that no statement scans every entry. It
 * prints its timings, and asserts the latency budget (100 ms at the 95th percentile) only with
 * `OPENVERIFY_C787_TIMING=assert`: on shared CI runners or under a full local test run a timing
 * measures the machine, not the matcher.
 */
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveReportTemplateConfig } from '@openverify/contracts';
import { SCREENING_CONSTANTS } from '@openverify/core';
import {
  DB_WATCHLIST_READS,
  createDatabase,
  getWatchlistSourceStates,
  loadLiveEntryHashes,
  rebuildWatchlistKeyDf,
  retrieveCandidates,
  runMigrations,
  tryLockWatchlistSourceSession,
  unlockWatchlistSourceSession,
  type Database,
  type WatchlistReads,
} from '@openverify/db';
import {
  createIntegrationPool,
  createRuntimeRole,
  ifSet,
  startIntegrationPostgres,
  TEST_RUNTIME_ROLE,
} from '@openverify/db/testing';
import {
  keysVersion,
  personSubject,
  retrievalQuery,
  variantGroupsFrom,
  type VariantGroups,
  type WatchlistRecord,
} from '@openverify/watchlist';
import {
  normalisedImport,
  normalisedImportText,
  syntheticWatchlist,
  type TableSubject,
} from '@openverify/watchlist/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WatchlistSettings } from '../config.js';
import { watchlistReportJob } from '../jobs/report-types/watchlist.js';
import type { ReportRunContext } from '../jobs/report-types/job.js';
import { useScreeningKit } from '../jobs/reports/screening.js';
import { loadMatcherData, type MatcherData } from './matcher-data.js';
import { reconcileWatchlistSources } from './reconcile.js';
import { rekeyWatchlistSource } from './rekey.js';
import { poolWatchlistSessions, watchlistSessionsOf } from './sync-session.js';
import { syncWatchlistSource, type WatchlistSyncRequest } from './sync.js';
import {
  GATE_SEED,
  gateCase,
  gateTable,
  rigourPersonNamesPath,
} from './test-support/heavy-headed-list.js';

const GROUPS = variantGroupsFrom([], 'a'.repeat(64));
const MATCHER = {
  status: 'loaded',
  groups: GROUPS,
  keysVersion: keysVersion('a'.repeat(64)),
} as const;
const SETTINGS: WatchlistSettings = {
  sourcesDisabled: [],
  refresh: false,
  removedRetentionDays: 90,
  euFsfToken: null,
  wikidataUserAgent: null,
  wikidataSparqlUrl: 'https://query.wikidata.org/sparql',
  pep: {
    openTenureMaxYears: 20,
    includeRelatives: false,
    retentionMonths: 12,
    headRetentionMonths: 60,
  },
};
const NOW = new Date('2026-10-27T12:00:00.000Z');
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let files: string;

const sync = (request: Omit<WatchlistSyncRequest, 'actor'>, matcher: MatcherData = MATCHER) =>
  syncWatchlistSource(
    {
      db,
      connect: poolWatchlistSessions(pool),
      clock: { now: () => NOW },
      logger: silent,
      settings: SETTINGS,
      matcherData: () => matcher,
    },
    { actor: 'cli', allowNormalised: true, ...request },
  );

async function listFile(name: string, publishedAt: string, records: WatchlistRecord[]) {
  const path = join(files, name);
  await writeFile(
    path,
    normalisedImportText(normalisedImport('uk-sanctions-list', publishedAt, records)),
  );
  return path;
}

/** Every `WARNING` the runtime role's connections receive (C249.3: none). */
const warnings: string[] = [];

beforeAll(async () => {
  container = await startIntegrationPostgres();
  // C249.3 (Workflow 11B, platform-ops): the owner migrates; every sync, read and re-key below runs
  // as the runtime role from createRuntimeRole (what db:grant-runtime grants), never as the owner.
  const owner = createIntegrationPool(container.getConnectionUri(), { max: 2 });
  try {
    await runMigrations(createDatabase(owner));
  } finally {
    await owner.end();
  }
  pool = createIntegrationPool(await createRuntimeRole(container.getConnectionUri()), { max: 10 });
  pool.on('connect', (client) => {
    client.on('notice', (notice) => {
      if (notice.severity === 'WARNING') {
        warnings.push(notice.message ?? '');
      }
    });
  });
  db = createDatabase(pool);
  await reconcileWatchlistSources(db, { disabled: [] });
  files = await mkdtemp(join(tmpdir(), 'openverify-watchlists-it-'));
}, 180_000);

afterAll(async () => {
  await ifSet(pool)?.end();
  await container?.stop();
  await rm(files, { recursive: true, force: true });
});

describe('the sync on its own connections (C76.2, P07)', () => {
  const records = syntheticWatchlist({
    seed: 'integration',
    idStyle: 'uk',
    individuals: 120,
    entities: 0,
    vessels: 0,
    aircraft: 0,
    hanNames: false,
  });

  it('ends busy while another session holds the source, and applies once it is released', async () => {
    const path = await listFile('newer.json', '2026-10-26T00:00:00.000Z', records);
    const holder = await pool.connect();
    try {
      const held = createDatabase(holder as unknown as Pool);
      expect(await tryLockWatchlistSourceSession(held, 'uk-sanctions-list')).toBe(true);

      expect((await sync({ sourceId: 'uk-sanctions-list', importPath: path })).outcome).toBe(
        'busy',
      );

      await unlockWatchlistSourceSession(held, 'uk-sanctions-list');
    } finally {
      holder.release();
    }
    expect(await sync({ sourceId: 'uk-sanctions-list', importPath: path })).toMatchObject({
      outcome: 'applied',
      added: 120,
    });
  });

  it('refuses an older publication under the lock and keeps the data, unless overridden and audited', async () => {
    const older = await listFile('older.json', '2026-10-20T00:00:00.000Z', records.slice(0, 115));

    expect((await sync({ sourceId: 'uk-sanctions-list', importPath: older })).outcome).toBe(
      'refused_rollback',
    );
    expect((await loadLiveEntryHashes(db, 'uk-sanctions-list')).size).toBe(120);

    const accepted = await sync({
      sourceId: 'uk-sanctions-list',
      importPath: older,
      acceptOlderPublication: true,
    });
    expect(accepted).toMatchObject({ outcome: 'applied', removed: 5 });
    const [state] = await getWatchlistSourceStates(db, ['uk-sanctions-list']);
    expect(state?.lastPublishedAt?.toISOString()).toBe('2026-10-20T00:00:00.000Z');
  });

  it('refuses a mass removal under the lock', async () => {
    const fewer = await listFile('fewer.json', '2026-10-27T00:00:00.000Z', records.slice(0, 80));

    expect((await sync({ sourceId: 'uk-sanctions-list', importPath: fewer })).outcome).toBe(
      'refused_mass_removal',
    );
    expect((await loadLiveEntryHashes(db, 'uk-sanctions-list')).size).toBe(115);
  });

  it('gives each sync of a pool-backed handle its own connection', async () => {
    const connect = watchlistSessionsOf(db);
    const first = await connect();
    const second = await connect();
    try {
      expect(await tryLockWatchlistSourceSession(first.db, 'ofac-sdn')).toBe(true);
      expect(await tryLockWatchlistSourceSession(second.db, 'ofac-sdn')).toBe(false);
      await unlockWatchlistSourceSession(first.db, 'ofac-sdn');
    } finally {
      await first.release();
      await second.release();
    }
  });
});

describe('the 100,000-name screening gate (C78.7, V11; owner decision 2 after 6B)', () => {
  const CAP = SCREENING_CONSTANTS['candidate-cap'].value;
  const shipped = loadMatcherData();
  const groups: VariantGroups = shipped.status === 'loaded' ? shipped.groups : GROUPS;
  const matcher: MatcherData =
    shipped.status === 'loaded'
      ? shipped
      : { status: 'loaded', groups, keysVersion: keysVersion(groups.sha256) };
  const rawPath = rigourPersonNamesPath();
  const CASE = gateCase({ variantGroups: shipped.status, rawGroups: rawPath !== null });
  const { records, subjects } = gateTable({
    seed: GATE_SEED,
    rawText: rawPath === null ? null : readFileSync(rawPath, 'utf8'),
  });
  const percentile = (values: readonly number[], fraction: number) =>
    [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)] ?? 0;
  let importMs = 0;

  beforeAll(async () => {
    const path = join(files, 'gate.json');
    await writeFile(
      path,
      JSON.stringify(normalisedImport('ofac-sdn', '2026-10-26T00:00:00.000Z', records)),
    );
    const started = performance.now();
    expect((await sync({ sourceId: 'ofac-sdn', importPath: path }, matcher)).outcome).toBe(
      'applied',
    );
    importMs = performance.now() - started;
  }, 600_000);

  /** The repository's reads, timed per phase and with each retrieval's diagnostics. */
  function timedReads() {
    const phases = { state: 0, retrieve: 0, load: 0 };
    const retrievals: { candidates: number; capReached: boolean; unreachable: boolean }[] = [];
    const reads: WatchlistReads = {
      getWatchlistSourceStates: async (...args) => {
        const at = performance.now();
        const states = await DB_WATCHLIST_READS.getWatchlistSourceStates(...args);
        phases.state += performance.now() - at;
        return states;
      },
      retrieveCandidates: async (...args) => {
        const at = performance.now();
        const result = await DB_WATCHLIST_READS.retrieveCandidates(...args);
        phases.retrieve += performance.now() - at;
        retrievals.push({
          candidates: result.candidates.length,
          capReached: result.capReached === true,
          unreachable: result.unreachable === true,
        });
        return result;
      },
      loadEntries: async (...args) => {
        const at = performance.now();
        const entries = await DB_WATCHLIST_READS.loadEntries(...args);
        phases.load += performance.now() - at;
        return entries;
      },
    };
    const take = () => {
      const taken = { phases: { ...phases }, retrievals: [...retrievals] };
      phases.state = 0;
      phases.retrieve = 0;
      phases.load = 0;
      retrievals.length = 0;
      return taken;
    };
    return { reads, take };
  }

  function context(query: Readonly<Record<string, string>>): ReportRunContext {
    return {
      report: {
        id: 'rep_gate',
        environmentId: 'env_gate',
        environmentKind: 'production',
        type: 'watchlist',
        origin: 'api',
        inquiryId: null,
        accountId: null,
        query,
        querySources: {},
        config: resolveReportTemplateConfig('watchlist', { 'search-lists': ['ofac-sdn'] }),
        createdAt: NOW,
      },
      run: { id: 'rpr_gate', runType: 'manual', triggerSyncId: null, attempt: 1 },
      deps: {
        db,
        clock: { now: () => NOW },
        logger: silent,
        watchlists: SETTINGS,
        limits: { perMinute: 600, maxRecurringPerEnvironment: 250_000, maxMediaRunsPerDay: 8_640 },
      },
      providers: {},
      signal: new AbortController().signal,
    };
  }

  it('finds every listed subject within the cap on a heavy-headed list, and prints its timings', async () => {
    const timed = timedReads();
    const restore = useScreeningKit({ groups: () => groups, reads: () => timed.reads });
    try {
      const screen = async (item: TableSubject) => {
        timed.take();
        const at = performance.now();
        const outcome = await watchlistReportJob.run(context(item.query));
        const ms = performance.now() - at;
        const { phases, retrievals } = timed.take();
        if (outcome.kind !== 'completed') {
          throw new Error('a screening asked to wait');
        }
        const kept = outcome.result.matches.map((match) => match.entryKey);
        return {
          ms,
          phases,
          candidates: retrievals.reduce((sum, one) => sum + one.candidates, 0),
          capReached: retrievals.some((one) => one.capReached),
          unreachable: retrievals.some((one) => one.unreachable),
          wouldError: outcome.result.errors.some((error) => error.code === 'result_truncated'),
          kept: kept.length,
          found: item.entryId === null ? null : kept.includes(`ofac-sdn:${item.entryId}`),
          errors: outcome.result.errors.filter((error) => error.code !== 'result_truncated'),
        };
      };
      // One round, as one calibration take: 20 warm-ups, then the 300 subjects once.
      for (const item of subjects.slice(0, 20)) {
        await screen(item);
      }
      const round: Awaited<ReturnType<typeof screen>>[] = [];
      for (const item of subjects) {
        round.push(await screen(item));
      }
      const ms = round.map((one) => one.ms);
      const phaseP95 = (phase: 'state' | 'retrieve' | 'load') =>
        percentile(
          round.map((one) => one.phases[phase]),
          0.95,
        ).toFixed(1);
      const rest = percentile(
        round.map((one) => one.ms - one.phases.state - one.phases.retrieve - one.phases.load),
        0.95,
      ).toFixed(1);
      const candidates = round.map((one) => one.candidates);
      const count = (test: (one: (typeof round)[number]) => boolean) => round.filter(test).length;
      const listed = round.filter((one) => one.found !== null);
      const found = listed.filter((one) => one.found === true).length;
      const timing = process.env.OPENVERIFY_C787_TIMING === 'assert' ? 'asserted' : 'printed';
      process.stdout.write(
        `[C78.7 gate] case=${CASE} table=heavy-headed-100k seed=${GATE_SEED} law=zipf-1 names=${String(
          records.reduce((sum, record) => sum + record.names.length, 0),
        )} entries=${String(records.length)} import=${importMs.toFixed(0)}ms rounds=1 ` +
          `p50=${percentile(ms, 0.5).toFixed(1)}ms p95=${percentile(ms, 0.95).toFixed(1)}ms ` +
          `p99=${percentile(ms, 0.99).toFixed(1)}ms ` +
          `p95-state/retrieve/load/rest=${phaseP95('state')}/${phaseP95('retrieve')}/${phaseP95('load')}/${rest}ms ` +
          `candidates-p50/p95=${String(percentile(candidates, 0.5))}/${String(percentile(candidates, 0.95))} ` +
          `cap-binds=${String(count((one) => one.capReached))}/300 unreachable=${String(
            count((one) => one.unreachable),
          )}/300 would-error=${String(count((one) => one.wouldError))}/300 ` +
          `listed-found=${String(found)}/${String(listed.length)} unlisted-alerted=${String(
            count((one) => one.found === null && one.kept > 0),
          )}/150 timing=${timing}\n`,
      );
      expect(round.flatMap((one) => one.errors)).toEqual([]);
      expect(subjects).toHaveLength(300);
      expect(found).toBe(150);
      expect(percentile(candidates, 0.95)).toBeLessThan(CAP);
      expect(count((one) => one.capReached)).toBeLessThanOrEqual(6);
      expect(count((one) => one.wouldError)).toBeLessThanOrEqual(3);
      if (timing === 'asserted') {
        expect(percentile(ms, 0.95)).toBeLessThanOrEqual(100);
      }
    } finally {
      restore();
    }
  }, 600_000);

  it('checks each candidate entry by its key and reads the names by the key index, never by scanning every entry or every name (owner decision 1 after 6B)', async () => {
    const dialect = new PgDialect();
    const statements: { sql: string; params: unknown[] }[] = [];
    // Records every statement, also inside the transaction retrieval opens.
    const recorder = <T extends object>(handle: T): T =>
      new Proxy(handle, {
        get(target, property, receiver) {
          const value: unknown = Reflect.get(target, property, receiver);
          if (property === 'execute' && typeof value === 'function') {
            return (query: Parameters<typeof dialect.sqlToQuery>[0]) => {
              statements.push(dialect.sqlToQuery(query));
              return (value as (query: unknown) => unknown).call(target, query);
            };
          }
          if (property === 'transaction' && typeof value === 'function') {
            return (run: (tx: object) => Promise<unknown>) =>
              (value as (run: (tx: object) => Promise<unknown>) => Promise<unknown>).call(
                target,
                (tx: object) => run(recorder(tx)),
              );
          }
          return value;
        },
      });
    const recording: Database = recorder(db);
    // The first subjects, the subjects whose names give the most keys, and a six-word name (its
    // fifteen token pairs each have a key): however many keys a name has, each is probed by the index.
    // Last, the commonest given name with the commonest family name, a pair out of reach that is
    // looked up by its pair key.
    const commonest = (role: string) => {
      const counts = new Map<string, number>();
      for (const record of records) {
        const value = record.names[0]?.parts.find((part) => part.role === role)?.value ?? '';
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    };
    const queries = [
      ...subjects.map((item) => item.query),
      {
        term: records
          .slice(0, 3)
          .map((record) => record.names[0]?.full ?? '')
          .join(' '),
      },
    ].map((query) => retrievalQuery(personSubject(query), groups));
    const most = [...queries].sort((a, b) => b.keys.length - a.keys.length).slice(0, 10);
    expect(most[0]?.keys.length ?? 0).toBeGreaterThanOrEqual(30);
    const common = retrievalQuery(
      personSubject({ 'name-first': commonest('given'), 'name-last': commonest('family') }),
      groups,
    );
    let pairLookups = 0;
    // The names as just after a sync that wrote some of them: until the next vacuum, their keys wait
    // in the key index's pending list, which every probe also reads, so that a probe per key looks
    // dearer to the planner than one scan of every name (as measured on the development tables,
    // docs/calibration/watchlist-phase6c.md).
    // (A key added and taken away again: each write gives the index new entries, the keys unchanged.)
    for (const keys of [`keys || array['x:pending']`, `array_remove(keys, 'x:pending')`]) {
      await pool.query(
        `update watchlist_names set keys = ${keys}
          where source_id = 'ofac-sdn' and entry_id in (
            select entry_id from watchlist_entries where source_id = 'ofac-sdn'
             order by entry_id limit 2000)`,
      );
    }
    /**
     * Screens each query's retrieval and explains its statements. While names are pending, only the
     * key statement is held to the key index; once the sync's writes end, every statement that looks
     * names up by their keys is.
     */
    const check = async (pending: boolean) => {
      for (const keys of [...queries.slice(0, 20), ...most, common]) {
        for (const normalisedName of [null, keys.normalisedNames[0]?.split(' ')[0] ?? null]) {
          statements.length = 0;
          await retrieveCandidates(recording, {
            environmentKind: 'production',
            sourceIds: ['ofac-sdn'],
            keys: keys.keys,
            reach: keys.reach,
            identifiers: [],
            cryptoAddresses: [],
            normalisedName,
            cap: CAP,
            entryKinds: ['individual'],
          });
          for (const statement of statements.filter(({ sql }) => !sql.startsWith('set local'))) {
            const plan = await pool.query<{ 'QUERY PLAN': { Plan: Record<string, unknown> }[] }>(
              `explain (format json) ${statement.sql}`,
              statement.params,
            );
            const scans: string[] = [];
            const nameAccess: string[] = [];
            const walk = (node: Record<string, unknown>) => {
              if (node['Node Type'] === 'Seq Scan') {
                scans.push(String(node['Relation Name']));
              }
              if (node['Relation Name'] === 'watchlist_names') {
                nameAccess.push(String(node['Node Type']));
              }
              for (const child of (node.Plans as Record<string, unknown>[] | undefined) ?? []) {
                walk(child);
              }
            };
            walk(plan.rows[0]?.['QUERY PLAN'][0]?.Plan ?? {});
            expect(scans).not.toContain('watchlist_entries');
            // A statement that looks names up by their keys reads them through the key index only
            // (a GIN index serves bitmap scans): neither a scan of every name nor a walk of another
            // index that tests each name's keys. (The trigram statement is one look-up, whose
            // access the planner prices from the trigram statistics.)
            const byKeys = /\.keys (?:@>|&&)/.test(statement.sql);
            const pairLookup = statement.sql.includes('.keys &&');
            if (byKeys && !(pending && pairLookup)) {
              pairLookups += pairLookup ? 1 : 0;
              expect(nameAccess.filter((type) => type !== 'Bitmap Heap Scan')).toEqual([]);
            }
          }
        }
      }
    };
    await check(true);
    // The sync's writes end with the key frequency rebuild, which empties the pending lists.
    await rebuildWatchlistKeyDf(db, 'ofac-sdn');
    await check(false);
    expect(pairLookups).toBeGreaterThan(0);
  }, 300_000);
});

describe('as the runtime role (C249.3; Workflow 11B, platform-ops)', () => {
  it('re-keys a synced source as a non-owner role, and no statement of the file raised a WARNING', async () => {
    const rekeyed = await rekeyWatchlistSource(
      {
        db,
        connect: poolWatchlistSessions(pool),
        clock: { now: () => NOW },
        logger: silent,
        matcherData: () => ({ ...MATCHER, keysVersion: keysVersion('b'.repeat(64)) }),
      },
      { sourceId: 'uk-sanctions-list', actor: 'cli' },
    );
    expect(rekeyed.outcome).toBe('rekeyed');
    expect(rekeyed.entries).toBeGreaterThan(0);

    const who = await pool.query<{ name: string; owner: boolean }>(
      `select current_user as name,
              pg_has_role(current_user, (select pg_get_userbyid(datdba) from pg_database
                                          where datname = current_database()), 'member') as owner`,
    );
    expect(who.rows[0]).toEqual({ name: TEST_RUNTIME_ROLE, owner: false });
    expect(warnings).toEqual([]);
  });
});

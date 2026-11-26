// @ts-check
/**
 * The Postgres harness of the watchlist benchmarks (evaluation-6, plan C78.7 and C78.8).
 *
 * - **Database.** `pgvector/pgvector:pg17` started through Testcontainers with the C73.8 flags
 *   (`POSTGRES_TEST_COMMAND`), migrated with the repository's migrations, the source rows
 *   reconciled from the committed manifest. The container is reusable and labelled with the
 *   benchmark's name, so the steps of one benchmark (each a process that fits a 10-minute call)
 *   share it; {@link stopBenchmarkPostgres} removes it.
 * - **Lists** go through `syncWatchlistSource` (the C76.2 sync, so `analyzeWatchlistTables` and the
 *   key-frequency rebuild run as for an operator, owner decision 10) into the synthetic sandbox
 *   source `openverify-sandbox`, with a copy of the manifest whose byte caps for that source are
 *   raised for the benchmark's files.
 * - **Screenings** go through the report jobs' `screenNames` (`apps/api`), with the repository's
 *   reads, for a sandbox environment.
 *
 * It imports the API's and the database package's sources by path (this package depends on
 * neither); the database package's helper loads Testcontainers from its development dependencies.
 * Nothing it prints or writes holds a name.
 */
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { reportConfigDefaultValues } from '@openverify/core';
import { reconcileWatchlistSources } from '../../../apps/api/src/watchlists/reconcile.js';
import { watchlistManifest } from '../../../apps/api/src/watchlists/manifest.js';
import {
  poolWatchlistSessions,
  syncWatchlistSource,
} from '../../../apps/api/src/watchlists/sync.js';
import { useScreeningKit } from '../../../apps/api/src/jobs/reports/screening.js';
import {
  DB_WATCHLIST_READS,
  createDatabase,
  createKeyring,
  runMigrations,
  setDefaultKeyring,
} from '../../db/src/index.js';
import { createIntegrationPool, startIntegrationPostgres } from '../../db/src/testing.js';
import { keysVersion } from '../src/keys/index.js';
import { reuseReads, timeReads } from './benchmark-reads.mjs';

/** @typedef {import('../../db/src/index.js').Database} Database */
/** @typedef {import('../../db/src/index.js').WatchlistReads} WatchlistReads */
/** @typedef {import('../src/keys/index.js').VariantGroups} VariantGroups */
/** @typedef {import('../../../apps/api/src/jobs/report-types/job.js').ReportTypeJob} ReportTypeJob */
/** @typedef {import('../../../apps/api/src/jobs/report-types/job.js').ReportRunContext} ReportRunContext */
/** @typedef {import('../../../apps/api/src/jobs/report-types/job.js').RunOutcome} RunOutcome */
/** @typedef {import('../../../apps/api/src/config.js').WatchlistSettings} WatchlistSettings */
/** @typedef {import('../../../apps/api/src/watchlists/manifest.js').WatchlistManifest} WatchlistManifest */
/** @typedef {ReturnType<typeof createIntegrationPool>} Pool */

/** The image the repository's Testcontainers tests pin (CLAUDE.md). */
export const POSTGRES_IMAGE =
  'pgvector/pgvector:pg17@sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f';

/** The synthetic sandbox source every benchmark list is imported into. */
export const BENCHMARK_SOURCE = 'openverify-sandbox';

/** The label that marks the benchmark's reusable containers. */
const LABEL = 'openverify.benchmark';

/** The byte cap the benchmark's manifest copy gives the sandbox source (2 GiB). */
const BENCHMARK_CAP_BYTES = 2 ** 31;

/** A logger that writes nothing (the sync and the jobs log ids and counts only, but stay quiet). */
export const SILENT = Object.freeze({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
});

/** The watchlist settings of the benchmark: the defaults, no refresh, no relatives. */
/** @type {WatchlistSettings} */
export const BENCHMARK_SETTINGS = Object.freeze({
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
});

/**
 * The benchmark's reusable container, labelled with its name, started through the integration
 * helper (K7B-13: a real `select 1` before it is used, a fresh container when the port refuses).
 * @param {string} name
 */
function containerOf(name) {
  return startIntegrationPostgres({
    image: POSTGRES_IMAGE,
    configure: (container) => container.withLabels({ [LABEL]: name }).withReuse(),
  });
}

/**
 * The benchmark's container itself, started or found again (the write steps run `pg_dump` and
 * `pg_restore` in it: Workflow 11D review, fix-11d).
 * @param {string} name
 */
export function benchmarkContainer(name) {
  return containerOf(name);
}

/**
 * The benchmark's database, started or found again, migrated, its source rows reconciled.
 * @param {string} name
 * @returns {Promise<{ pool: Pool, db: Database, close: () => Promise<void> }>}
 */
export async function startBenchmarkPostgres(name) {
  const container = await containerOf(name);
  const pool = createIntegrationPool(container.getConnectionUri(), { max: 8 });
  const db = createDatabase(pool);
  await runMigrations(db);
  await reconcileWatchlistSources(db, { disabled: [] });
  return { pool, db, close: () => pool.end() };
}

/**
 * Removes the benchmark's container.
 * @param {string} name
 */
export async function stopBenchmarkPostgres(name) {
  const container = await containerOf(name);
  await container.stop({ remove: true });
}

/**
 * The keyring of the sealed report columns, kept in the benchmark's output directory so every
 * step of one benchmark reads what another sealed (a throwaway key of a throwaway database).
 * @param {string} path
 */
export async function installBenchmarkKeyring(path) {
  /** @type {Buffer} */
  let key;
  try {
    key = Buffer.from((await readFile(path, 'utf8')).trim(), 'base64');
  } catch {
    key = randomBytes(32);
    await writeFile(path, `${key.toString('base64')}\n`, { mode: 0o600 });
  }
  setDefaultKeyring(createKeyring(key));
}

/**
 * The committed manifest, with the sandbox source's byte caps raised for the benchmark's files.
 * @returns {WatchlistManifest}
 */
export function benchmarkManifest() {
  const committed = watchlistManifest();
  return {
    ...committed,
    sources: committed.sources.map((source) =>
      source.id === BENCHMARK_SOURCE
        ? {
            ...source,
            max_bytes: { compressed: BENCHMARK_CAP_BYTES, inflated: BENCHMARK_CAP_BYTES },
          }
        : source,
    ),
  };
}

/**
 * C76.2: imports a normalised file into the sandbox source through the sync, keyed with `groups`.
 * @param {{ pool: Pool, db: Database, groups: VariantGroups, path: string, now?: Date }} input
 */
export function importList(input) {
  /** @type {import('../../../apps/api/src/watchlists/matcher-data.js').MatcherData} */
  const matcher = {
    status: 'loaded',
    groups: input.groups,
    keysVersion: keysVersion(input.groups.sha256),
  };
  return syncWatchlistSource(
    {
      db: input.db,
      connect: poolWatchlistSessions(input.pool),
      clock: { now: () => input.now ?? new Date() },
      logger: SILENT,
      settings: BENCHMARK_SETTINGS,
      matcherData: () => matcher,
      manifest: benchmarkManifest(),
    },
    { sourceId: BENCHMARK_SOURCE, actor: 'cli', importPath: input.path },
  );
}

/**
 * The state after autovacuum: dead rows of the successive syncs reclaimed, statistics fresh.
 * @param {Pool} pool
 */
export async function vacuumAnalyse(pool) {
  await pool.query(
    'vacuum analyze watchlist_entries, watchlist_names, watchlist_identifiers, watchlist_crypto_addresses, watchlist_key_df',
  );
}

/**
 * The compacted state (owner decision 7): the list tables rewritten without the dead space of the
 * successive syncs, statistics fresh.
 * @param {Pool} pool
 */
export async function vacuumFull(pool) {
  await pool.query(
    'vacuum (full, analyze) watchlist_entries, watchlist_names, watchlist_identifiers, watchlist_crypto_addresses, watchlist_key_df',
  );
}

/**
 * The server's version line and the list tables' sizes, for the report.
 * @param {Pool} pool
 */
export async function databaseFacts(pool) {
  const version = await pool.query('select version() as version');
  const sizes = await pool.query(
    `select relname as "table", pg_total_relation_size(c.oid)::bigint as bytes
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and relname like 'watchlist_%'
      order by relname`,
  );
  return {
    version: String(version.rows[0]?.version ?? ''),
    tables: Object.fromEntries(sizes.rows.map((row) => [String(row.table), Number(row.bytes)])),
  };
}

/**
 * The repository's reads, each call's duration added to its phase and each retrieval recorded
 * (every member is wrapped, `benchmark-reads.mjs`).
 * @param {WatchlistReads} reads
 */
export function timedReads(reads = DB_WATCHLIST_READS) {
  return timeReads(reads);
}

/**
 * The repository's reads, each answer kept by its arguments: one query's database reads serve the
 * three presets (retrieval does not depend on the preset), and `clear()` frees them per query
 * (every member is wrapped, `benchmark-reads.mjs`).
 * @param {WatchlistReads} reads
 */
export function cachedReads(reads = DB_WATCHLIST_READS) {
  return reuseReads(reads);
}

/**
 * Installs the screening kit: the variant groups and the reads the jobs use.
 * @param {{ groups: VariantGroups, reads: WatchlistReads }} kit
 * @returns {() => void} Restores the previous kit.
 */
export function installScreeningKit(kit) {
  return useScreeningKit({ groups: () => kit.groups, reads: () => kit.reads });
}

/**
 * A type's default configuration, pinned to the sandbox source, with a preset.
 * @param {'watchlist' | 'business-watchlist'} type
 * @param {'exact' | 'strict' | 'tolerant'} preset
 * @returns {Record<string, unknown>}
 */
export function screeningConfig(type, preset) {
  return {
    ...reportConfigDefaultValues(type),
    'search-lists': [BENCHMARK_SOURCE],
    'name-matching': { preset },
  };
}

/**
 * One screening by a report type's job, for a sandbox environment (nothing is persisted). A
 * `manual` run unless `run` says otherwise: owner decision 8 after 6C executes the `list_update`
 * runs a re-screen inserted, with their trigger sync (`benchmark-performance.mjs`, `rescreen-runs`).
 * @param {{ job: ReportTypeJob, db: Database, query: Readonly<Record<string, unknown>>, config: Record<string, unknown>, now?: Date, run?: { runType: 'manual' | 'list_update', triggerSyncId: number | null } }} input
 * @returns {Promise<RunOutcome>}
 */
export function screenOnce(input) {
  const now = input.now ?? new Date();
  /** @type {ReportRunContext} */
  const ctx = {
    report: {
      id: 'rep_benchmark',
      environmentId: 'env_benchmark',
      environmentKind: 'sandbox',
      type: input.job.type,
      origin: 'api',
      inquiryId: null,
      accountId: null,
      query: input.query,
      querySources: {},
      config: input.config,
      createdAt: now,
    },
    run: {
      id: 'rpr_benchmark',
      runType: input.run?.runType ?? 'manual',
      triggerSyncId: input.run?.triggerSyncId ?? null,
      attempt: 1,
    },
    deps: {
      db: input.db,
      clock: { now: () => now },
      logger: SILENT,
      watchlists: BENCHMARK_SETTINGS,
      limits: { perMinute: 600, maxRecurringPerEnvironment: 250_000, maxMediaRunsPerDay: 8640 },
    },
    providers: {},
    signal: new AbortController().signal,
  };
  return input.job.run(ctx);
}

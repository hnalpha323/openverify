// @ts-check
/**
 * C270 (Workflow 11D, matcher-write-11d): the matcher's write-cost steps, run through
 * `benchmark:performance` (which registers them and hands them its scale helpers). The method is
 * `docs/calibration/watchlist-phase11.md` (items 7 to 9); the pure helpers and their tests are
 * `benchmark-write.mjs`. Each step works on its own copy of a snapshot database in the scale's
 * reusable container, so the measure, re-screen and share steps keep reading the table they built.
 *
 *   pnpm --filter @openverify/watchlist benchmark:performance --seed <hex> [--out <dir>] \
 *     [--namespace <name>] [--smoke] --step <scale>-<write step> [flags]
 *
 * - `<scale>-snapshot --as <name>`: copies the scale's database to `snapshot_<name>` (`table` after
 *   the scale's import; `before-last` after part 7 of the 2,000,000-name import, before part 8).
 * - `<scale>-keydf-identity` (C270.1, method item 7): on a copy of `table`, a sequence of four syncs
 *   behind `incremental-key-df` (adds, removals, renames, re-listings, one variant-group change),
 *   each followed by a check of the table against a full rebuild (in a transaction rolled back);
 *   then the scale's subjects screened on the incremental table, a full rebuild committed, and the
 *   subjects screened again: every created match's digest must agree. Resumable by action (exit 3
 *   while an action is left); the variant-group change re-keys the whole source (at 2,000,000
 *   names a long take: run it in the background under the e2e lock with `--heartbeat`).
 * - `<scale>-keydf-sync --size <n> [--takes 3]` (C270.1's timing): on a copy of `table`, a sync
 *   adding `n` entries with the switch off, then on, each followed by an untimed restore (the table
 *   again, the switch on), after an untimed warm-up pair; resumable by sync. Its summary also checks
 *   the table against a full rebuild.
 * - `<scale>-rekey [--tune rekey-batch=<n>] --take <k>` (C270.2, method item 8): one re-key of a
 *   fresh copy of `table` per call (so each take's peak memory is its own process's), timed, with
 *   its largest RSS and V8 heap beside the process's before it (the variant groups loaded), and
 *   the digest of every derived column before and after (the same groups: the output must be
 *   identical). The first call digests the snapshot and exits 3: run it again for the take.
 *   Without `--tune` it runs the tree's own `REKEY_BATCH`, so at the base it runs the base's
 *   re-key.
 * - `<scale>-gin-sync [--switch gin-fastupdate-off | --tune gin-pending-list-limit=<kB> |
 *   --tune gin-clean-every=<n>] --take <k> [--heartbeat <file>]` (C270.3 and C269.4, method item 9):
 *   on a fresh copy of `before-last`, one idle round of the scale's subjects, then the last part's
 *   sync with the subjects screened over and over until it commits; the p95 during the sync against
 *   idle and the sync's own time. A long take at 2,000,000 names.
 *
 * Every step takes `--heartbeat <file>` (the time written every 10 s, the largest gap printed or
 * recorded) for the long-take exception.
 *
 * Everything generated stays in the output directory and the container, outside git; stdout
 * carries counts and timings only, never a name.
 */
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { rekeyWatchlistSource } from '../../../apps/api/src/watchlists/rekey.js';
import { poolWatchlistSessions } from '../../../apps/api/src/watchlists/sync.js';
import { createDatabase, rebuildWatchlistKeyDf } from '../../db/src/index.js';
import { createIntegrationPool } from '../../db/src/testing.js';
import { keysVersion, variantGroupsFrom } from '../src/keys/index.js';
import { syntheticEntries } from '../src/testing/heavy-headed.js';
import {
  BENCHMARK_SOURCE,
  SILENT,
  benchmarkContainer,
  benchmarkManifest,
  importList,
  installScreeningKit,
  startBenchmarkPostgres,
  timedReads,
} from './benchmark-postgres.mjs';
import { partTarget } from './benchmark-scale.mjs';
import { writeNormalisedImport } from './benchmark-tables.mjs';
import {
  SNAPSHOT_DIRECTORY,
  configurationLabel,
  dumpCommand,
  duringSyncSummary,
  identityPlan,
  identityPublication,
  peakMemory,
  restoreCommand,
  snapshotDumpPath,
  syncTakesPlan,
} from './benchmark-write.mjs';

/** @typedef {import('./benchmark-write.mjs').WriteTunes} WriteTunes */
/** @typedef {import('./benchmark-write.mjs').WriteStepName} WriteStepName */
/** @typedef {import('../src/record/index.js').WatchlistRecord} WatchlistRecord */
/** @typedef {import('../src/keys/index.js').VariantGroups} VariantGroups */
/** @typedef {import('../src/testing/heavy-headed.js').NamePool} NamePool */
/** @typedef {import('../src/testing/heavy-headed.js').TableSubject} Subject */
/** @typedef {import('../src/testing/heavy-headed.js').TableProfile} TableProfile */
/** @typedef {import('../../db/src/index.js').Database} Database */
/** @typedef {ReturnType<typeof createIntegrationPool>} Pool */

/**
 * @typedef {object} WriteScale A scale as `benchmark-performance.mjs` sizes it for the run.
 * @property {string} container
 * @property {number} names
 * @property {TableProfile} profile
 * @property {number} parts
 */

/**
 * @typedef {object} WriteRun The options every write step shares.
 * @property {string} seed
 * @property {string} out
 * @property {boolean} smoke
 * @property {string | undefined} namespace
 * @property {'100k' | '2m'} scale
 * @property {number} [parts]
 */

/**
 * @typedef {object} WriteKit What `benchmark-performance.mjs` lends the write steps.
 * @property {(run: WriteRun) => WriteScale} scaleOf
 * @property {(seed: string) => NamePool} poolOf
 * @property {() => VariantGroups} shippedGroups
 * @property {(run: WriteRun, pool: NamePool, names: number) => Iterable<WatchlistRecord>} entriesOf
 * @property {(run: WriteRun, pool: NamePool, table?: readonly WatchlistRecord[]) => Subject[]} subjectsOf
 * @property {(db: Database, timed: ReturnType<typeof timedReads>) => (item: Subject, round: number) => Promise<{ ms: number, digest: string, errors: string[] }>} timedScreener
 * @property {number} publishedBase
 * @property {number} warmUp
 */

/**
 * @typedef {object} WriteOptions A write step's own flags.
 * @property {string | undefined} as
 * @property {number | undefined} size
 * @property {number | undefined} takes
 * @property {number | undefined} take
 * @property {string | undefined} switch
 * @property {WriteTunes} tunes
 * @property {string | undefined} heartbeat
 */

/** A resumable step's budget per call, as the other resumable steps (8 of the 10 minutes). */
const STEP_BUDGET_MS = 8 * 60_000;
/** The switches a write step turns on (Stage 1a amendment 7). */
const WRITE_SWITCHES = Object.freeze(['incremental-key-df', 'gin-fastupdate-off']);
/** The GIN indexes of the names (C78.3) that the pending lists belong to. */
const NAME_GIN_INDEXES = Object.freeze([
  'watchlist_names_keys_idx',
  'watchlist_names_normalised_trgm_idx',
]);
/** The variant groups of the identity sequence's group change: none (another keys version). */
const NO_GROUPS = variantGroupsFrom([], 'c'.repeat(64));

/** @param {number} started */
const secondsSince = (started) => Math.round((performance.now() - started) / 100) / 10;

/** @param {string} path @param {unknown} value */
const writeJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);

/** @param {string} path */
const readJson = async (path) => {
  const text = await readFile(path, 'utf8').catch(() => null);
  return text === null ? null : /** @type {unknown} */ (JSON.parse(text));
};

/** @param {string} path @returns {Promise<Record<string, unknown>[]>} */
const readLines = async (path) => {
  const text = await readFile(path, 'utf8').catch(() => '');
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => /** @type {Record<string, unknown>} */ (JSON.parse(line)));
};

/** @param {VariantGroups} groups */
const matcherOf = (groups) => ({
  status: /** @type {const} */ ('loaded'),
  groups,
  keysVersion: keysVersion(groups.sha256),
});

/**
 * The head's switch registry (`packages/db/src/repositories/watchlist-switches.ts`), imported when
 * a step needs it, so the base without it still runs every step that does not.
 * @param {string} need What the step needs it for.
 */
async function registryOf(need) {
  const db = /** @type {Record<string, unknown>} */ (await import('../../db/src/index.js'));
  const switches = db.useWatchlistSwitches;
  const tuning = db.useWatchlistWriteTuning;
  if (typeof switches !== 'function' || typeof tuning !== 'function') {
    throw new Error(`this tree has no Phase 11 watchlist switches (needed for ${need})`);
  }
  return {
    setSwitches: /** @type {(switches: Record<string, boolean>) => () => void} */ (switches),
    setTuning: /** @type {(tuning: WriteTunes) => () => void} */ (tuning),
  };
}

/**
 * Applies a step's `--switch` and `--tune` flags; returns what restores them. Without either it
 * imports nothing (the base's own behaviour).
 * @param {{ switch?: string | undefined, tunes: WriteTunes }} flags
 * @param {readonly string[]} allowed The switches the step takes.
 */
async function applyFlags(flags, allowed) {
  if (flags.switch !== undefined && !allowed.includes(flags.switch)) {
    throw new Error(`--switch is one of ${allowed.join(', ')} for this step`);
  }
  if (flags.switch === undefined && Object.keys(flags.tunes).length === 0) {
    return () => undefined;
  }
  const registry = await registryOf(configurationLabel(flags));
  const restoreTuning = registry.setTuning(flags.tunes);
  const restoreSwitch =
    flags.switch === undefined ? () => undefined : registry.setSwitches({ [flags.switch]: true });
  return () => {
    restoreSwitch();
    restoreTuning();
  };
}

/** @param {Pool} pool */
const uriOf = (pool) =>
  /** @type {{ options: { connectionString: string } }} */ (/** @type {unknown} */ (pool)).options
    .connectionString;

/** @param {string} uri @param {string} database */
function withDatabase(uri, database) {
  const url = new URL(uri);
  url.pathname = `/${database}`;
  return url.toString();
}

/** A database name the steps make: lower case, digits and `_` only. */
const DATABASE_NAME = /^[a-z][a-z0-9_]{0,62}$/u;

/** @param {string} name */
function databaseName(name) {
  const database = name.replaceAll('-', '_');
  if (!DATABASE_NAME.test(database)) {
    throw new Error(`${name} is not a database name the write steps make`);
  }
  return database;
}

/**
 * The scale's container: its main database's URI (migrated and reconciled by the shared harness),
 * and the server's maintenance database for copies.
 * @param {WriteScale} scale
 */
async function containerUri(scale) {
  const main = await startBenchmarkPostgres(scale.container);
  const uri = uriOf(main.pool);
  await main.close();
  return uri;
}

/** Parallel restore jobs: the index builds dominate a restore and each takes one job. */
const RESTORE_JOBS = 4;

/**
 * Runs `command` in the scale's container and fails with its last lines when it does not exit 0
 * (`pg_dump` and `pg_restore` print object names and errors, never row values).
 * @param {{ container: string }} scale
 * @param {string[]} command
 */
async function inContainer(scale, command) {
  const container = await benchmarkContainer(scale.container);
  const result = await container.exec(command);
  if (result.exitCode !== 0) {
    const tail = result.output.split('\n').slice(-5).join('\n');
    throw new Error(`${command[0] ?? 'command'} exited ${String(result.exitCode)}: ${tail}`);
  }
}

/**
 * Dumps database `from` to snapshot `snapshot`'s file (Workflow 11D review, fix-11d: in place of
 * `CREATE DATABASE … TEMPLATE`, watchlist-phase11 finding 1).
 * @param {{ container: string }} scale
 * @param {string} uri
 * @param {string} from
 * @param {string} snapshot
 */
async function dumpSnapshot(scale, uri, from, snapshot) {
  await inContainer(scale, ['mkdir', '-p', SNAPSHOT_DIRECTORY]);
  await inContainer(
    scale,
    dumpCommand({
      user: decodeURIComponent(new URL(uri).username),
      database: databaseName(from),
      file: snapshotDumpPath(databaseName(snapshot)),
    }),
  );
}

/**
 * Makes database `to` (dropped first) a copy of snapshot `from`: an empty database restored from
 * the snapshot's dump, then vacuumed and analysed, so every take starts from the same planner
 * statistics and visibility map (untimed; Workflow 11D review, fix-11d).
 * @param {{ container: string }} scale
 * @param {string} uri
 * @param {string} from
 * @param {string} to
 */
async function copyDatabase(scale, uri, from, to) {
  const admin = createIntegrationPool(withDatabase(uri, 'postgres'), { max: 1 });
  try {
    await admin.query(`drop database if exists "${databaseName(to)}" with (force)`);
    await admin.query(`create database "${databaseName(to)}" template template0`);
  } finally {
    await admin.end();
  }
  await inContainer(
    scale,
    restoreCommand({
      user: decodeURIComponent(new URL(uri).username),
      database: databaseName(to),
      file: snapshotDumpPath(databaseName(from)),
      jobs: RESTORE_JOBS,
    }),
  );
  const copy = openDatabase(uri, to);
  try {
    // Every table, so autovacuum has nothing a restore left to do during the take.
    await copy.pool.query('vacuum analyze');
  } finally {
    await copy.close();
  }
}

/**
 * Drops database `name` on the server of `uri`.
 * @param {string} uri
 * @param {string} name
 */
async function dropDatabase(uri, name) {
  const admin = createIntegrationPool(withDatabase(uri, 'postgres'), { max: 1 });
  try {
    await admin.query(`drop database if exists "${databaseName(name)}" with (force)`);
  } finally {
    await admin.end();
  }
}

/**
 * A pool and drizzle handle on database `name` of the server of `uri`.
 * @param {string} uri
 * @param {string} name
 */
function openDatabase(uri, name) {
  const pool = createIntegrationPool(withDatabase(uri, databaseName(name)), { max: 8 });
  return { pool, db: createDatabase(pool), close: () => pool.end() };
}

/** @param {string} name */
const snapshotOf = (name) => `snapshot_${databaseName(name)}`;

/**
 * `<scale>-snapshot --as <name>`.
 * @param {WriteRun} run
 * @param {WriteKit} kit
 * @param {WriteOptions} options
 */
async function snapshotStep(run, kit, options) {
  if (options.as === undefined) {
    throw new Error('--step <scale>-snapshot takes --as <name> (table, before-last)');
  }
  const scale = kit.scaleOf(run);
  const uri = await containerUri(scale);
  const started = performance.now();
  const source = new URL(uri).pathname.slice(1);
  await dumpSnapshot(scale, uri, source, snapshotOf(options.as));
  const copy = openDatabase(uri, source);
  try {
    const size = await copy.pool.query('select pg_database_size(current_database())::bigint as b');
    const entries = await copy.pool.query(
      'select count(*)::int as live from watchlist_entries where source_id = $1 and removed_at is null',
      [BENCHMARK_SOURCE],
    );
    const record = {
      scale: run.scale,
      snapshot: options.as,
      bytes: Number(size.rows[0]?.b ?? 0),
      liveEntries: Number(entries.rows[0]?.live ?? 0),
      seconds: secondsSince(started),
    };
    const directory = join(run.out, run.scale, 'write');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeJson(join(directory, `snapshot-${options.as}.json`), record);
    process.stdout.write(`${JSON.stringify(record)}\n`);
  } finally {
    await copy.close();
  }
}

/**
 * The key frequencies against a full rebuild, read in one transaction that is rolled back: the
 * rows each holds that the other does not, and the rows whose counts differ.
 * @param {Pool} pool
 */
async function compareWithRebuild(pool) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `create temp table write_key_df_kept on commit drop as
         select key, count from watchlist_key_df where source_id = '${BENCHMARK_SOURCE}'`,
    );
    await rebuildWatchlistKeyDf(
      createDatabase(/** @type {Pool} */ (/** @type {unknown} */ (client))),
      BENCHMARK_SOURCE,
    );
    const { rows } = await client.query(
      `select count(*) filter (where kept.key is null)::int as missing,
              count(*) filter (where fresh.key is null)::int as extra,
              count(*) filter (where kept.count <> fresh.count)::int as differing,
              count(fresh.key)::int as rows
         from write_key_df_kept kept
         full join (select key, count from watchlist_key_df where source_id = $1) fresh
           on fresh.key = kept.key`,
      [BENCHMARK_SOURCE],
    );
    await client.query('rollback');
    const row = rows[0] ?? {};
    const counts = {
      rows: Number(row.rows ?? 0),
      missing: Number(row.missing ?? 0),
      extra: Number(row.extra ?? 0),
      differing: Number(row.differing ?? 0),
    };
    return { ...counts, identical: counts.missing + counts.extra + counts.differing === 0 };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Writes a publication of `records` for the sandbox source, dated `publishedAt`, if it is not
 * there yet (a step's cached file); returns its path.
 * @param {string} path
 * @param {Iterable<WatchlistRecord>} records
 * @param {number} publishedAt
 */
async function publicationFile(path, records, publishedAt) {
  if ((await readJson(`${path}.done`)) === null) {
    await writeNormalisedImport(path, {
      source: BENCHMARK_SOURCE,
      publishedAt: new Date(publishedAt).toISOString(),
      records,
    });
    await writeJson(`${path}.done`, { publishedAt });
  }
  return path;
}

/** @param {string} path */
const removePublication = async (path) => {
  await rm(path, { force: true });
  await rm(`${path}.done`, { force: true });
};

/**
 * One sync of the file at `path` into the sandbox source of `database`, which must apply.
 * @param {{ pool: Pool, db: Database }} database
 * @param {VariantGroups} groups
 * @param {string} path
 */
async function applied(database, groups, path) {
  const before = loadavg();
  const started = performance.now();
  const sync = await importList({ pool: database.pool, db: database.db, groups, path });
  const seconds = secondsSince(started);
  if (sync.outcome !== 'applied') {
    throw new Error(`the sync did not apply: ${sync.outcome}`);
  }
  return {
    seconds,
    rekeyed: sync.rekeyed,
    added: sync.added,
    changed: sync.changed,
    removed: sync.removed,
    loadAverage: { before, after: loadavg() },
  };
}

/**
 * `<scale>-keydf-sync --size <n> [--takes 3]` (C270.1's timing).
 * @param {WriteRun} run
 * @param {WriteKit} kit
 * @param {WriteOptions} options
 */
async function keyDfSyncStep(run, kit, options) {
  const size = options.size;
  if (size === undefined || !Number.isInteger(size) || size < 1) {
    throw new Error('--step <scale>-keydf-sync takes --size <n>');
  }
  const started = performance.now();
  const registry = await registryOf('incremental-key-df');
  const scale = kit.scaleOf(run);
  const directory = join(run.out, run.scale, 'write');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const state = join(directory, `keydf-sync-${String(size)}.jsonl`);
  const work = `write_keydf_sync_${String(size)}`;
  const uri = await containerUri(scale);
  const done = await readLines(state);
  if (done.length === 0) {
    await copyDatabase(scale, uri, snapshotOf('table'), work);
  }
  const pool = kit.poolOf(run.seed);
  const groups = kit.shippedGroups();
  const table = [...kit.entriesOf(run, pool, scale.names)];
  const added = [
    ...syntheticEntries({
      seed: `${run.seed}/write-keydf-added`,
      pool,
      names: size * 10,
      profile: scale.profile,
      idPrefix: 'BW-',
    }),
  ].slice(0, size);
  // One date for both files: the rollback guard refuses only an older publication.
  const publishedAt = kit.publishedBase + 400 * 60_000;
  const base = await publicationFile(join(directory, 'keydf-base.json'), table, publishedAt);
  const add = await publicationFile(
    join(directory, `keydf-add-${String(size)}.json`),
    [...table, ...added],
    publishedAt,
  );
  /** @type {{ take: number, state: 'off' | 'on', kind: 'timed' | 'restore' }[]} */
  const plan = [
    { take: 0, state: 'on', kind: 'timed' },
    { take: 0, state: 'on', kind: 'restore' },
    ...syncTakesPlan(options.takes ?? 3),
  ];
  const database = openDatabase(uri, work);
  try {
    let last = 0;
    for (const action of plan.slice(done.length)) {
      if (performance.now() - started + last > STEP_BUDGET_MS) {
        process.stdout.write(
          `${JSON.stringify({ done: (await readLines(state)).length, of: plan.length })}\nincomplete: run the keydf-sync step again\n`,
        );
        process.exitCode = 3;
        return;
      }
      const restore = registry.setSwitches({ 'incremental-key-df': action.state === 'on' });
      try {
        const sync = await applied(database, groups, action.kind === 'timed' ? add : base);
        last = sync.seconds * 1000;
        const line = { ...action, warmUp: action.take === 0, ...sync };
        await appendFile(state, `${JSON.stringify(line)}\n`);
        process.stdout.write(`${JSON.stringify(line)}\n`);
      } finally {
        restore();
      }
    }
    const lines = await readLines(state);
    const timed = (/** @type {'off' | 'on'} */ which) =>
      lines
        .filter((line) => line.kind === 'timed' && line.warmUp === false && line.state === which)
        .map((line) => Number(line.seconds));
    const median = (/** @type {number[]} */ values) =>
      [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)] ?? null;
    const summary = {
      scale: run.scale,
      size,
      takes: options.takes ?? 3,
      off: { seconds: timed('off'), median: median(timed('off')) },
      on: { seconds: timed('on'), median: median(timed('on')) },
      table: await compareWithRebuild(database.pool),
    };
    await writeJson(join(directory, `keydf-sync-${String(size)}.json`), summary);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    await database.close();
  }
  await removePublication(base);
  await removePublication(add);
  await dropDatabase(uri, work);
}

/**
 * `<scale>-keydf-identity` (C270.1's identity, method item 7).
 * @param {WriteRun} run
 * @param {WriteKit} kit
 */
async function keyDfIdentityStep(run, kit) {
  const started = performance.now();
  const registry = await registryOf('incremental-key-df');
  const scale = kit.scaleOf(run);
  const directory = join(run.out, run.scale, 'write');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const state = join(directory, 'keydf-identity.jsonl');
  const work = 'write_keydf_identity';
  const uri = await containerUri(scale);
  const plan = identityPlan();
  const done = await readLines(state);
  if (done.length === 0) {
    await copyDatabase(scale, uri, snapshotOf('table'), work);
  }
  const pool = kit.poolOf(run.seed);
  const table = [...kit.entriesOf(run, pool, scale.names)];
  const others = [
    ...kit.entriesOf({ ...run, seed: `${run.seed}/write-renamed` }, pool, scale.names),
  ];
  const added = [
    ...syntheticEntries({
      seed: `${run.seed}/write-identity-added`,
      pool,
      names: Math.ceil(table.length / 100) * 10,
      profile: scale.profile,
      idPrefix: 'BI-',
    }),
  ].slice(0, Math.ceil(table.length / 100));
  const shipped = kit.shippedGroups();
  const groupsOf = (/** @type {'shipped' | 'none' | undefined} */ which) =>
    which === 'none' ? NO_GROUPS : shipped;
  const lastGroups = groupsOf(plan.filter((item) => item.action === 'sync').at(-1)?.groups);
  const database = openDatabase(uri, work);
  try {
    let last = 0;
    for (const action of plan.slice(done.length)) {
      if (performance.now() - started + last > STEP_BUDGET_MS) {
        process.stdout.write(
          `${JSON.stringify({ done: (await readLines(state)).length, of: plan.length })}\nincomplete: run the keydf-identity step again\n`,
        );
        process.exitCode = 3;
        return;
      }
      const actionStarted = performance.now();
      /** @type {Record<string, unknown>} */
      let line;
      if (action.action === 'sync') {
        const path = await publicationFile(
          join(directory, `identity-${String(action.op)}.json`),
          identityPublication({ table, others, added, op: action.op }),
          kit.publishedBase + (500 + action.op) * 60_000,
        );
        const restore = registry.setSwitches({ 'incremental-key-df': true });
        try {
          line = { ...action, ...(await applied(database, groupsOf(action.groups), path)) };
        } finally {
          restore();
        }
        await removePublication(path);
      } else if (action.action === 'check') {
        line = { ...action, ...(await compareWithRebuild(database.pool)) };
      } else if (action.action === 'rebuild') {
        await database.db.transaction((tx) => rebuildWatchlistKeyDf(tx, BENCHMARK_SOURCE));
        line = { ...action };
      } else {
        const subjects = kit.subjectsOf(run, pool, table);
        const timed = timedReads();
        const restore = installScreeningKit({ groups: lastGroups, reads: timed.reads });
        try {
          const screen = kit.timedScreener(database.db, timed);
          const digests = [];
          for (const item of subjects) {
            digests.push((await screen(item, 1)).digest);
          }
          await writeJson(join(directory, `keydf-identity-${String(action.tree)}.json`), digests);
          line = { ...action, subjects: digests.length };
        } finally {
          restore();
        }
      }
      line.seconds = secondsSince(actionStarted);
      last = Number(line.seconds) * 1000;
      await appendFile(state, `${JSON.stringify(line)}\n`);
      process.stdout.write(`${JSON.stringify(line)}\n`);
    }
    const lines = await readLines(state);
    const [incremental, rebuilt] = /** @type {string[][]} */ (
      await Promise.all([
        readJson(join(directory, 'keydf-identity-incremental.json')),
        readJson(join(directory, 'keydf-identity-rebuilt.json')),
      ])
    );
    const differing =
      incremental === undefined || rebuilt === undefined
        ? null
        : incremental.filter((digest, index) => digest !== rebuilt[index]).length;
    const checks = lines.filter((line) => line.action === 'check');
    const summary = {
      scale: run.scale,
      checks: checks.map((line) => ({
        op: line.op,
        rows: line.rows,
        missing: line.missing,
        extra: line.extra,
        differing: line.differing,
      })),
      tablesIdentical: checks.every((line) => line.identical === true),
      subjects: incremental?.length ?? 0,
      differingDigests: differing,
      identical: checks.every((line) => line.identical === true) && differing === 0,
    };
    await writeJson(join(directory, 'keydf-identity.json'), summary);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    await database.close();
  }
  await dropDatabase(uri, work);
}

/**
 * The SHA-256 of every derived column of the sandbox source (the names, the identifiers and crypto
 * addresses, the key frequencies), read in a stable order through a cursor.
 * @param {Pool} pool
 */
async function derivedDigest(pool) {
  const statements = {
    names: `select entry_id, ordinal, name, normalised, script, quality, "primary", keys
              from watchlist_names where source_id = $1 order by entry_id collate "C", ordinal`,
    identifiers: `select entry_id, ordinal, kind, value_normalised, country
                    from watchlist_identifiers where source_id = $1
                   order by entry_id collate "C", ordinal`,
    cryptoAddresses: `select entry_id, ordinal, chain, canonical, raw, ticker
                        from watchlist_crypto_addresses where source_id = $1
                       order by entry_id collate "C", ordinal`,
    keyFrequencies: `select key, count from watchlist_key_df where source_id = $1
                      order by key collate "C"`,
  };
  /** @type {Record<string, { rows: number, sha256: string }>} */
  const digests = {};
  const client = await pool.connect();
  try {
    for (const [name, statement] of Object.entries(statements)) {
      const hash = createHash('sha256');
      let rows = 0;
      await client.query('begin');
      await client.query(`declare derived no scroll cursor for ${statement}`, [BENCHMARK_SOURCE]);
      for (;;) {
        const page = await client.query('fetch 20000 from derived');
        for (const row of page.rows) {
          hash.update(`${JSON.stringify(row)}\n`);
        }
        rows += page.rows.length;
        if (page.rows.length < 20_000) {
          break;
        }
      }
      await client.query('commit');
      digests[name] = { rows, sha256: hash.digest('hex') };
    }
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return digests;
}

/**
 * Samples this process's memory every 100 ms until stopped.
 * @returns {{ stop: () => { rss: number, heapUsed: number }[] }}
 */
function memorySampler() {
  /** @type {{ rss: number, heapUsed: number }[]} */
  const samples = [];
  const take = () => {
    const usage = process.memoryUsage();
    samples.push({ rss: usage.rss, heapUsed: usage.heapUsed });
  };
  take();
  const timer = setInterval(take, 100);
  return {
    stop: () => {
      clearInterval(timer);
      take();
      return samples;
    },
  };
}

/**
 * `<scale>-rekey [--tune rekey-batch=<n>] --take <k>` (C270.2).
 * @param {WriteRun} run
 * @param {WriteKit} kit
 * @param {WriteOptions} options
 */
async function rekeyStep(run, kit, options) {
  if (options.take === undefined || !Number.isInteger(options.take) || options.take < 1) {
    throw new Error('--step <scale>-rekey takes --take <k>');
  }
  const extra = Object.keys(options.tunes).filter((name) => name !== 'rekeyBatch');
  if (options.switch !== undefined || extra.length > 0) {
    throw new Error('--step <scale>-rekey takes only --tune rekey-batch=<n>');
  }
  const label = configurationLabel({ tunes: options.tunes });
  const directory = join(run.out, run.scale, 'write', 'rekey');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${label}-take-${String(options.take)}.json`);
  const existing = await readJson(path);
  if (existing !== null) {
    process.stdout.write(`${JSON.stringify(existing)}\n`);
    return;
  }
  const scale = kit.scaleOf(run);
  const uri = await containerUri(scale);
  const work = 'write_rekey';
  await copyDatabase(scale, uri, snapshotOf('table'), work);
  const database = openDatabase(uri, work);
  const restore = await applyFlags({ tunes: options.tunes }, []);
  try {
    // The digest of the snapshot's derived columns, read once in a call of its own, so no take's
    // peak memory holds what reading it allocated.
    const cached = join(directory, 'derived-table.json');
    const before = /** @type {Record<string, { rows: number, sha256: string }> | null} */ (
      await readJson(cached)
    );
    if (before === null) {
      await writeJson(cached, await derivedDigest(database.pool));
      process.stdout.write('the snapshot is digested: run the rekey step again for the take\n');
      process.exitCode = 3;
      return;
    }
    const groups = kit.shippedGroups();
    const load = loadavg();
    const sampler = memorySampler();
    const started = performance.now();
    const result = await rekeyWatchlistSource(
      {
        db: database.db,
        connect: poolWatchlistSessions(database.pool),
        clock: { now: () => new Date() },
        logger: SILENT,
        matcherData: () => matcherOf(groups),
        manifest: benchmarkManifest(),
      },
      { sourceId: BENCHMARK_SOURCE, actor: 'cli' },
    );
    const seconds = secondsSince(started);
    const samples = sampler.stop();
    const peak = peakMemory(samples);
    // Before the re-key, with the variant groups loaded (the worker holds them too).
    const baseline = peakMemory(samples.slice(0, 1));
    if (result.outcome !== 'rekeyed') {
      throw new Error(`the re-key did not run: ${result.outcome}`);
    }
    const after = await derivedDigest(database.pool);
    const record = {
      scale: run.scale,
      configuration: label,
      take: options.take,
      entries: result.entries,
      seconds,
      baseline,
      peak,
      maxRssMiB: Math.round(process.resourceUsage().maxRSS / 102.4) / 10,
      identical: JSON.stringify(after) === JSON.stringify(before),
      derived: after,
      loadAverage: { before: load, after: loadavg() },
    };
    await writeJson(path, record);
    process.stdout.write(`${JSON.stringify(record)}\n`);
  } finally {
    restore();
    await database.close();
  }
  await dropDatabase(uri, work);
}

/**
 * Writes the time to `path` every 10 s until stopped, and keeps the largest gap between beats.
 * @param {string | undefined} path
 */
function heartbeat(path) {
  let previous = Date.now();
  let largestGapMs = 0;
  if (path === undefined) {
    return { stop: () => largestGapMs };
  }
  const beat = () => {
    const now = Date.now();
    largestGapMs = Math.max(largestGapMs, now - previous);
    previous = now;
    writeFile(path, `${new Date(now).toISOString()}\n`).catch(() => undefined);
  };
  beat();
  const timer = setInterval(beat, 10_000);
  return {
    stop: () => {
      clearInterval(timer);
      beat();
      return largestGapMs;
    },
  };
}

/**
 * `<scale>-gin-sync [--switch gin-fastupdate-off | --tune …] --take <k> [--heartbeat <file>]`
 * (C270.3, C269.4).
 * @param {WriteRun} run
 * @param {WriteKit} kit
 * @param {WriteOptions} options
 */
async function ginSyncStep(run, kit, options) {
  if (options.take === undefined || !Number.isInteger(options.take) || options.take < 1) {
    throw new Error('--step <scale>-gin-sync takes --take <k>');
  }
  if (options.tunes.rekeyBatch !== undefined) {
    throw new Error('--step <scale>-gin-sync takes no rekey-batch');
  }
  const label = configurationLabel({ switch: options.switch, tunes: options.tunes });
  const directory = join(run.out, run.scale, 'write', 'gin-sync');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${label}-take-${String(options.take)}.json`);
  const existing = await readJson(path);
  if (existing !== null) {
    process.stdout.write(`${JSON.stringify(existing)}\n`);
    return;
  }
  const beats = heartbeat(options.heartbeat);
  const takeStarted = new Date().toISOString();
  const scale = kit.scaleOf(run);
  const parts = run.parts ?? scale.parts;
  const uri = await containerUri(scale);
  const work = 'write_gin_sync';
  const pool = kit.poolOf(run.seed);
  const groups = kit.shippedGroups();
  const table = [...kit.entriesOf(run, pool, partTarget(scale.names, parts, parts))];
  const subjects = kit.subjectsOf(run, pool, table);
  const file = await publicationFile(
    join(run.out, run.scale, 'write', 'gin-last-part.json'),
    table,
    kit.publishedBase + parts * 60_000,
  );
  await copyDatabase(scale, uri, snapshotOf('before-last'), work);
  const database = openDatabase(uri, work);
  const restore = await applyFlags(
    { switch: options.switch, tunes: options.tunes },
    WRITE_SWITCHES.filter((name) => name === 'gin-fastupdate-off'),
  );
  const timed = timedReads();
  const restoreKit = installScreeningKit({ groups, reads: timed.reads });
  try {
    if (options.switch === 'gin-fastupdate-off') {
      // Option 1 (Stage 1a amendment 7): the index owner's DDL in the benchmark's own database,
      // then what was already pending moved into the indexes.
      for (const index of NAME_GIN_INDEXES) {
        await database.pool.query(`alter index ${index} set (fastupdate = off)`);
        await database.pool.query(`select gin_clean_pending_list('${index}'::regclass)`);
      }
    }
    const screen = kit.timedScreener(database.db, timed);
    for (const item of subjects.slice(0, kit.warmUp)) {
      await screen(item, 0);
    }
    const idleLoad = loadavg();
    /** @type {number[]} */
    const idle = [];
    for (const item of subjects) {
      idle.push((await screen(item, 1)).ms);
    }
    const syncLoad = loadavg();
    const syncStarted = performance.now();
    let syncEnded = Number.POSITIVE_INFINITY;
    const syncing = importList({ pool: database.pool, db: database.db, groups, path: file }).then(
      (result) => {
        syncEnded = performance.now();
        return result;
      },
      (/** @type {unknown} */ error) => {
        syncEnded = performance.now();
        throw error;
      },
    );
    const finished = () => syncEnded !== Number.POSITIVE_INFINITY;
    /** @type {number[]} */
    const during = [];
    let screenings = 0;
    while (!finished()) {
      const item = subjects[screenings % subjects.length];
      screenings += 1;
      if (item === undefined) {
        break;
      }
      const screenStarted = performance.now();
      const timing = await screen(item, 2);
      if (screenStarted + timing.ms <= syncEnded) {
        during.push(timing.ms);
      }
    }
    const sync = await syncing;
    if (sync.outcome !== 'applied') {
      throw new Error(`the last part did not apply: ${sync.outcome}`);
    }
    const summary = duringSyncSummary({
      idle,
      during,
      syncSeconds: Math.round((syncEnded - syncStarted) / 100) / 10,
    });
    const record = {
      scale: run.scale,
      configuration: label,
      take: options.take,
      parts,
      sync: { added: sync.added, changed: sync.changed, removed: sync.removed },
      ...summary,
      screenings,
      loadAverage: { idle: idleLoad, sync: syncLoad, end: loadavg() },
      take_started: takeStarted,
      take_ended: new Date().toISOString(),
      largestHeartbeatGapMs: beats.stop(),
    };
    await writeJson(path, record);
    process.stdout.write(`${JSON.stringify(record)}\n`);
  } finally {
    beats.stop();
    restoreKit();
    restore();
    await database.close();
  }
  await dropDatabase(uri, work);
}

/**
 * Runs one write step (`benchmark-performance.mjs` calls this for `<scale>-<write step>`).
 * @param {WriteStepName} name
 * @param {WriteRun} run
 * @param {WriteKit} kit
 * @param {WriteOptions} options
 */
export async function runWriteStep(name, run, kit, options) {
  await mkdir(run.out, { recursive: true, mode: 0o700 });
  if (name === 'gin-sync') {
    // Its own heartbeat: the take records the largest gap beside its figure.
    return ginSyncStep(run, kit, options);
  }
  // The long-take exception (review F01): any step can beat while it runs in the background.
  const beats = heartbeat(options.heartbeat);
  try {
    switch (name) {
      case 'snapshot':
        return await snapshotStep(run, kit, options);
      case 'keydf-identity':
        return await keyDfIdentityStep(run, kit);
      case 'keydf-sync':
        return await keyDfSyncStep(run, kit, options);
      case 'rekey':
        return await rekeyStep(run, kit, options);
    }
  } finally {
    const gap = beats.stop();
    if (options.heartbeat !== undefined) {
      process.stdout.write(`${JSON.stringify({ largestHeartbeatGapMs: gap })}\n`);
    }
  }
}

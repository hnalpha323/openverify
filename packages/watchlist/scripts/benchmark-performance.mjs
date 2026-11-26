// @ts-check
/**
 * C78.7 (evaluation-6): the performance benchmark of watchlist screening, on synthetic tables in
 * Postgres (Testcontainers). The method is in `docs/calibration/watchlist-phase6.md`; the helpers
 * are tested beside this script. Each step fits a 10-minute call; the database of a scale lives in
 * a reusable container between its steps.
 *
 *   pnpm --filter @openverify/watchlist benchmark:performance --seed <hex>
 *     [--out /tmp/openverify-eval-6/performance] --step <step> [--part <n>]
 *
 * Steps, in order:
 * - `machine`: the machine and the toolchain;
 * - `100k-import`, `100k-measure`: the sanctions-like table of 100,000 names, one sync;
 * - `rescreen-seed`: 200,000 recurring watchlist reports in one sandbox environment;
 * - `rescreen-100`, `rescreen-300`, `rescreen-1000`, `rescreen-3000`: a sync adding that many
 *   entries, then the re-screen (`processReportRescreen`) timed end to end (10,000 does not fit one
 *   10-minute call at 200,000 subjects on the development machine; see the report's amendments);
 * - `100k-teardown`;
 * - `2m-import --part 1` to `--part 8`: the PEP-like table of 2,000,000 names, growing by
 *   250,000 names a sync (each a full publication), `VACUUM ANALYZE` after the last;
 * - `2m-measure [--rounds 1]` (resumes by round; `--rounds` bounds the new rounds of one call),
 *   `2m-teardown`.
 *
 * Workflow 6C added, each after its scale's measure step (never renaming a step or a flag):
 * - `100k-unlisted`, `2m-unlisted` (owner decision 7): the first measure round's unlisted subjects
 *   with a kept `tolerant` match, read from the round files (no database);
 * - `100k-variants`, `2m-variants` (owner decisions 1 and 5): variant cases of the development
 *   table's listed entries and the unlisted subjects at each fixed preset, recall per source
 *   (`benchmark-variants.mjs`); it resumes, and exits 3 when it stops at its 8-minute budget;
 * - `100k-compact`, `2m-compact` (owner decision 7): `VACUUM (FULL, ANALYZE)` of the list tables,
 *   then one measure round. It rewrites the tables, so run it after the scale's measure,
 *   unlisted and variants steps (and, at 100,000 names, after the re-screens).
 * - `rescreen-check --size <n> [--workers <k> --worker <i>]` (owner decision 3, review finding
 *   C003): the re-screen's no-miss check, right after `rescreen-<n>` and before the next size. Every
 *   recurring report's subject is screened in full as its own scheduled run would screen it, and
 *   the subjects keeping a match on an entry that sync changed are compared with the reports the
 *   re-screen gave a `list_update` run. `k` processes side by side each screen every `k`-th
 *   subject; it resumes, exits 3 while a subject is unscreened, and the call that finds every
 *   subject screened writes `rescreen-check-<n>/summary.json`.
 *
 * Workflow 6D added (owner decision 8 after 6C; no step or flag renamed):
 * - every screening of a measure round records `digest`, the SHA-256 of its full created matches;
 * - `<scale>-shares --switch <name> [--takes 3]`: one switchable change's share at a scale, its
 *   rounds off then on alternately in one call, each subject's digest checked against a priming
 *   round, written to `<scale>/shares/<name>.json` (a head-only step: it needs the head's switches);
 * - `rescreen-runs --size <n> [--workers <k> --worker <i>]`: right after `rescreen-<n>` (and its
 *   `rescreen-check`, if run), the inserted `list_update` runs executed as the worker would run them,
 *   nothing persisted; it resumes, exits 3 while a run is not executed, and writes
 *   `rescreen-runs-<n>/summary.json`;
 * - `identity --base <dir> --head <dir> --out <dir>`: the first measure round of each scale at two
 *   trees of one seed, subject by subject, written to `<out>/performance-identity.json`.
 *
 * Workflow 11D added (matcher-write-11d; C270; no step or flag renamed): the write steps
 * `<scale>-snapshot --as <name>`, `<scale>-keydf-identity`, `<scale>-keydf-sync --size <n>
 * [--takes 3]`, `<scale>-rekey [--tune rekey-batch=<n>] --take <k>` and `<scale>-gin-sync
 * [--switch gin-fastupdate-off | --tune gin-pending-list-limit=<kB> | --tune gin-clean-every=<n>]
 * --take <k> [--heartbeat <file>]`, documented and run by `benchmark-write-steps.mjs` (imported
 * only when one runs); and `<scale>-shares --switch <name>` takes every switch of the Phase 11
 * registry (`WATCHLIST_PHASE11_SWITCHES`) beside the screening and read shortcuts.
 *
 * Flags (Workflow 6C): `--smoke` (development only: small tables and counts, never a published
 * number), `--namespace <name>` (the containers' names carry it, so two worktrees or a smoke run
 * never share a database; teardown takes the same flags), `--parts <n>` (the 2,000,000-name import
 * in `n` syncs instead of 8; the final table is the same, so base and head take the same `n`).
 *
 * Everything generated stays in the output directory, outside git; stdout carries counts and
 * timings only, never a name.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { cpus, loadavg, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { watchlistReportJob } from '../../../apps/api/src/jobs/report-types/watchlist.js';
import { processReportRescreen } from '../../../apps/api/src/jobs/reports/rescreen.js';
import { resolveReportTemplateConfig } from '../../contracts/src/index.js';
import { listRecurringReportSubjects, RESCREEN_CHUNK_LIMIT } from '../../db/src/index.js';
import { createTestTenant, seedReport, seedReportTemplate } from '../../db/src/testing.js';
import {
  keysVersion,
  loadVariantGroups,
  SHIPPED_VARIANT_GROUPS_SHA256,
} from '../src/keys/index.js';
import {
  HEAVY_HEADED_100K,
  RIGOUR_PERSON_NAMES_ENTRY,
  TABLE_PROFILES,
  heavyHeadedEntries,
  heavyHeadedPool,
  heavyHeadedSubjects,
  parseRigourPersonNames,
  syntheticEntries,
  tableSubjects,
  unlistedQueries,
} from '../src/testing/heavy-headed.js';
import { percentile, performanceSummary } from './benchmark-metrics.mjs';
import {
  rescreenCheck,
  rescreenSubject,
  rescreenSubjectLines,
  unlistedAlerts,
} from './benchmark-posthoc.mjs';
import {
  canonicalJson,
  containerName,
  executedRunsCheck,
  identityCheck,
  matchDigest,
  partTarget,
  stepWriter,
  switchShare,
} from './benchmark-scale.mjs';
import { developmentVariants, variantSummary } from './benchmark-variants.mjs';
import {
  BENCHMARK_SETTINGS,
  BENCHMARK_SOURCE,
  POSTGRES_IMAGE,
  SILENT,
  cachedReads,
  databaseFacts,
  importList,
  installBenchmarkKeyring,
  installScreeningKit,
  screenOnce,
  screeningConfig,
  startBenchmarkPostgres,
  stopBenchmarkPostgres,
  timedReads,
  vacuumAnalyse,
  vacuumFull,
} from './benchmark-postgres.mjs';
import { writeNormalisedImport } from './benchmark-tables.mjs';
import { parseTunes, writeStepOf } from './benchmark-write.mjs';

/** @typedef {import('./benchmark-tables.mjs').NamePool} NamePool */
/** @typedef {import('./benchmark-metrics.mjs').TimedScreening} TimedScreening */
/** @typedef {import('../src/record/index.js').WatchlistRecord} WatchlistRecord */

const ROOT = join(import.meta.dirname, '..', '..', '..');

/** C78.7's two scales. */
const SCALES = Object.freeze({
  '100k': Object.freeze({
    container: 'evaluation-6-100k',
    names: HEAVY_HEADED_100K.names,
    profile: HEAVY_HEADED_100K.profile,
    idPrefix: HEAVY_HEADED_100K.idPrefix,
    parts: 1,
    budgetMs: 100,
  }),
  '2m': Object.freeze({
    container: 'evaluation-6-2m',
    names: 2_000_000,
    profile: TABLE_PROFILES.pep,
    idPrefix: 'BP-',
    parts: 8,
    budgetMs: 250,
  }),
});

const SUBJECTS = HEAVY_HEADED_100K.listed;
const WARM_UP = 20;
const ROUNDS = 3;
const RESCREEN_REPORTS = 200_000;
const RESCREEN_SIZES = Object.freeze([100, 300, 1000, 3000]);
const RESCREEN_BUDGET_MS = 60_000;
const PUBLISHED_BASE = Date.parse('2026-10-01T00:00:00.000Z');
const INSERTS_IN_FLIGHT = 32;
/** The development variant cases of a scale (Workflow 6C): 30 of each source. */
const VARIANT_CASES = 210;
/** The fixed presets the variants step screens at. */
const PRESETS = Object.freeze(/** @type {const} */ (['exact', 'strict', 'tolerant']));
const STEP_BUDGET_MS = 8 * 60_000;
const BATCH = 50;

/**
 * Development only (Workflow 6C, never a published number): the smoke run's sizes, to check every
 * step end to end on a scratch seed.
 */
const SMOKE = Object.freeze({
  names: Object.freeze({ '100k': 5000, '2m': 16_000 }),
  subjects: 20,
  warmUp: 2,
  rescreenReports: 2000,
  variantCases: 14,
});

/**
 * @typedef {object} Run The options every step shares.
 * @property {string} seed
 * @property {string} out
 * @property {boolean} smoke
 * @property {string | undefined} namespace
 */

/**
 * A scale as this run uses it: smaller in a smoke run, its container named for the run.
 * @param {keyof typeof SCALES} name
 * @param {{ smoke: boolean, namespace: string | undefined }} run
 */
function scaleOf(name, run) {
  const scale = SCALES[name];
  return {
    ...scale,
    names: run.smoke ? SMOKE.names[name] : scale.names,
    container: containerName(scale.container, run),
  };
}

/** @param {{ smoke: boolean }} run */
const subjectCount = (run) => (run.smoke ? SMOKE.subjects : SUBJECTS);

/** @param {number} started */
const secondsSince = (started) => Math.round((performance.now() - started) / 100) / 10;

/** @param {string} path @param {unknown} value */
const writeJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);

/**
 * The pinned group source's groups (every one: the performance tables use the shipped build), read
 * by the shared module's own parser (owner decision 6 after 6C), never the held-out generator's.
 */
function rawGroups() {
  /** @type {{ data: { name: string, filename: string }[] }} */
  const manifest = JSON.parse(readFileSync(join(ROOT, 'data', 'manifest.json'), 'utf8'));
  const entry = manifest.data.find((item) => item.name === RIGOUR_PERSON_NAMES_ENTRY);
  if (entry === undefined) {
    throw new Error('data/manifest.json has no rigour_person_names entry');
  }
  return parseRigourPersonNames(readFileSync(join(ROOT, 'data', entry.filename), 'utf8'));
}

/** The shipped variant groups (C78.3), as the worker loads them. */
function shippedGroups() {
  const loaded = loadVariantGroups(
    join(ROOT, 'data', 'variant-groups.json'),
    SHIPPED_VARIANT_GROUPS_SHA256,
  );
  if (loaded.status !== 'loaded') {
    throw new Error(`the shipped variant groups are ${loaded.status} (build:variant-groups)`);
  }
  return loaded.groups;
}

/**
 * The pool of the seed's tables (owner decision 6 after 6C: `heavyHeadedPool`).
 * @param {string} seed
 */
const poolOf = (seed) => heavyHeadedPool(seed, rawGroups());

/**
 * A scale's table stream up to `names` names: the 100,000-name table is the shared module's
 * (`heavyHeadedEntries`, owner decision 6 after 6C), the 2,000,000-name one its PEP profile.
 * @param {Run & { scale: keyof typeof SCALES }} options
 * @param {NamePool} pool
 * @param {number} names
 * @returns {Generator<WatchlistRecord>}
 */
function entriesOf(options, pool, names) {
  if (options.scale === '100k') {
    return heavyHeadedEntries({ seed: options.seed, pool, names });
  }
  const scale = SCALES[options.scale];
  return syntheticEntries({
    seed: `${options.seed}/${options.scale}`,
    pool,
    names,
    profile: scale.profile,
    idPrefix: scale.idPrefix,
  });
}

/**
 * The first `count` entries of a table stream.
 * @param {Iterable<WatchlistRecord>} records
 * @param {number} count
 */
function firstOf(records, count) {
  /** @type {WatchlistRecord[]} */
  const taken = [];
  for (const record of records) {
    if (taken.length >= count) {
      break;
    }
    taken.push(record);
  }
  return taken;
}

/** @param {{ out: string }} options */
async function machine(options) {
  const model = /model name\s*:\s*(.+)/u.exec(readFileSync('/proc/cpuinfo', 'utf8'))?.[1] ?? '';
  const lscpu = execFileSync('lscpu', { encoding: 'utf8' });
  const field = (/** @type {string} */ name) =>
    new RegExp(`^${name}:\\s*(.+)$`, 'mu').exec(lscpu)?.[1]?.trim() ?? null;
  const facts = {
    cpu: model.trim(),
    logicalCpus: cpus().length,
    coresPerSocket: field('Core\\(s\\) per socket'),
    sockets: field('Socket\\(s\\)'),
    threadsPerCore: field('Thread\\(s\\) per core'),
    memoryGiB: Math.round((totalmem() / 2 ** 30) * 10) / 10,
    kernel: release(),
    node: process.version,
    docker: execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], {
      encoding: 'utf8',
    }).trim(),
    postgresImage: POSTGRES_IMAGE,
    loadAverage: loadavg(),
  };
  await writeJson(join(options.out, 'machine.json'), facts);
  process.stdout.write(`${JSON.stringify(facts)}\n`);
}

/**
 * One sync of part `part` of a scale's table: a full publication of the stream up to its names.
 * @param {Run & { scale: keyof typeof SCALES, part: number, parts?: number }} options
 */
async function importPart(options) {
  const scale = scaleOf(options.scale, options);
  const parts = options.parts ?? scale.parts;
  const target = partTarget(scale.names, options.part, parts);
  const directory = join(options.out, options.scale);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const started = performance.now();
  const pool = poolOf(options.seed);
  const groups = shippedGroups();
  const path = join(directory, `list-${String(options.part)}.json`);
  const written = await writeNormalisedImport(path, {
    source: 'openverify-sandbox',
    publishedAt: new Date(PUBLISHED_BASE + options.part * 60_000).toISOString(),
    records: entriesOf(options, pool, target),
  });
  const generatedSeconds = secondsSince(started);
  const database = await startBenchmarkPostgres(scale.container);
  try {
    const syncStarted = performance.now();
    const sync = await importList({ ...database, groups, path });
    const syncSeconds = secondsSince(syncStarted);
    if (sync.outcome !== 'applied' && sync.outcome !== 'unchanged') {
      throw new Error(`the table did not apply: ${sync.outcome}`);
    }
    let vacuumSeconds = null;
    if (options.part === parts) {
      const vacuumStarted = performance.now();
      await vacuumAnalyse(database.pool);
      vacuumSeconds = secondsSince(vacuumStarted);
    }
    const record = {
      scale: options.scale,
      part: options.part,
      of: parts,
      file: {
        entries: written.entries,
        names: written.names,
        bytes: written.bytes,
        sha256: written.sha256,
      },
      sync: {
        outcome: sync.outcome,
        entryCount: sync.entryCount,
        added: sync.added,
        changed: sync.changed,
        removed: sync.removed,
      },
      generatedSeconds,
      syncSeconds,
      vacuumSeconds,
      loadAverage: loadavg(),
      database: options.part === parts ? await databaseFacts(database.pool) : null,
    };
    await writeJson(join(directory, `import-${String(options.part)}.json`), record);
    process.stdout.write(`${JSON.stringify(record)}\n`);
  } finally {
    await database.close();
    await rm(path, { force: true });
  }
}

/**
 * A scale's whole table, as its import step wrote it.
 * @param {Run & { scale: keyof typeof SCALES }} options
 * @param {NamePool} pool
 */
function tableOf(options, pool) {
  return [...entriesOf(options, pool, scaleOf(options.scale, options).names)];
}

/**
 * The subjects of a scale: listed entries' primary names and unlisted names, interleaved.
 * @param {Run & { scale: keyof typeof SCALES }} options
 * @param {NamePool} pool
 * @param {readonly WatchlistRecord[]} [table] The scale's table, when the caller has it.
 */
function subjectsOf(options, pool, table = tableOf(options, pool)) {
  const count = subjectCount(options);
  return options.scale === '100k'
    ? heavyHeadedSubjects({ seed: options.seed, pool, records: table, count })
    : tableSubjects({
        records: table,
        pool,
        count,
        unlistedSeed: `${options.seed}/${options.scale}/unlisted`,
      });
}

/** @typedef {import('../src/testing/heavy-headed.js').TableSubject} Subject */

/**
 * One timed `tolerant` screening at a time, its reads timed by phase (C78.7).
 * @param {import('../../db/src/index.js').Database} db
 * @param {ReturnType<typeof timedReads>} timed
 */
function timedScreener(db, timed) {
  const config = screeningConfig('watchlist', 'tolerant');
  return async (/** @type {Subject} */ item, /** @type {number} */ round) => {
    timed.take();
    const started = performance.now();
    const outcome = await screenOnce({
      job: watchlistReportJob,
      db,
      query: item.query,
      config,
    });
    const ms = performance.now() - started;
    const { phases, retrievals } = timed.take();
    if (outcome.kind !== 'completed') {
      throw new Error('a screening asked to wait');
    }
    const kept = outcome.result.matches.map((match) => match.entryKey.split(':').at(-1));
    /** @type {TimedScreening & { errors: string[], digest: string }} */
    const timing = {
      round,
      subject: item.subject,
      ms,
      phases,
      candidates: retrievals.reduce((sum, one) => sum + one.candidates, 0),
      truncated: retrievals.some((one) => one.truncated),
      capReached: retrievals.some((one) => one.capReached),
      unreachable: retrievals.some((one) => one.unreachable),
      kept: kept.length,
      found: item.entryId === null ? null : kept.includes(item.entryId),
      errors: outcome.result.errors.map((error) => error.code),
      // Owner decision 8 after 6C: the full created matches, digested.
      digest: matchDigest(outcome.result.matches),
    };
    return timing;
  };
}

/**
 * C78.7: the screening p95 of a scale, by round (a round already written is kept). With
 * `rounds`, at most that many new rounds run in this call, so a long round is never cut by the
 * call's limit; the summary is written once every round is.
 * @param {Run & { scale: keyof typeof SCALES, rounds?: number }} options
 */
async function measure(options) {
  const scale = scaleOf(options.scale, options);
  const directory = join(options.out, options.scale);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const pool = poolOf(options.seed);
  const subjects = subjectsOf(options, pool);
  const groups = shippedGroups();
  const timed = timedReads();
  const restore = installScreeningKit({ groups, reads: timed.reads });
  const database = await startBenchmarkPostgres(scale.container);
  const screen = timedScreener(database.db, timed);
  const warmUp = options.smoke ? SMOKE.warmUp : WARM_UP;
  try {
    for (const item of subjects.slice(0, warmUp)) {
      await screen(item, 0);
    }
    let ran = 0;
    for (let round = 1; round <= ROUNDS; round += 1) {
      const path = join(directory, `round-${String(round)}.json`);
      const existing = await readFile(path, 'utf8').catch(() => null);
      if (existing !== null) {
        continue;
      }
      if (ran >= (options.rounds ?? ROUNDS)) {
        process.stdout.write('incomplete: run the measure step again\n');
        process.exitCode = 3;
        return;
      }
      ran += 1;
      const before = loadavg();
      const started = performance.now();
      const timings = [];
      for (const item of subjects) {
        timings.push(await screen(item, round));
      }
      await writeJson(path, {
        round,
        before,
        after: loadavg(),
        seconds: secondsSince(started),
        timings,
      });
      process.stdout.write(
        `${JSON.stringify({ scale: options.scale, round, seconds: secondsSince(started) })}\n`,
      );
    }
    /** @type {(TimedScreening & { errors: string[] })[]} */
    const all = [];
    /** @type {{ round: number, before: number[], after: number[], seconds: number }[]} */
    const rounds = [];
    for (let round = 1; round <= ROUNDS; round += 1) {
      const saved = JSON.parse(
        await readFile(join(directory, `round-${String(round)}.json`), 'utf8'),
      );
      all.push(...saved.timings);
      rounds.push({ round, before: saved.before, after: saved.after, seconds: saved.seconds });
    }
    const summary = {
      scale: options.scale,
      budgetMs: scale.budgetMs,
      subjects: subjects.length,
      warmUp,
      rounds,
      erroredRuns: all.filter((item) => item.errors.length > 0).length,
      errorCodes: [...new Set(all.flatMap((item) => item.errors))].sort(),
      ...performanceSummary(all),
      database: await databaseFacts(database.pool),
    };
    await writeJson(join(directory, 'measure.json'), summary);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    restore();
    await database.close();
  }
}

/**
 * C74.4: 200,000 recurring watchlist reports in one sandbox environment, pinned to the source.
 * @param {Run} options
 */
async function rescreenSeed(options) {
  const directory = join(options.out, 'rescreen');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await installBenchmarkKeyring(join(options.out, 'keyring'));
  const pool = poolOf(options.seed);
  const queries = unlistedQueries({
    seed: `${options.seed}/rescreen`,
    pool,
    count: options.smoke ? SMOKE.rescreenReports : RESCREEN_REPORTS,
  });
  const database = await startBenchmarkPostgres(scaleOf('100k', options).container);
  const started = performance.now();
  try {
    const { environment } = await createTestTenant(database.db, { kind: 'sandbox' });
    const template = await seedReportTemplate(database.db, environment.id, {
      config: { ...screeningConfig('watchlist', 'tolerant'), 'recurrence-interval-days': 30 },
    });
    const nextRunAt = new Date(Date.now() + 30 * 86_400_000);
    for (let index = 0; index < queries.length; index += INSERTS_IN_FLIGHT) {
      await Promise.all(
        queries.slice(index, index + INSERTS_IN_FLIGHT).map((query) =>
          seedReport(database.db, environment.id, {
            ...template,
            reportType: 'watchlist',
            status: 'ready',
            query,
            recurrenceIntervalDays: 30,
            nextRunAt,
          }),
        ),
      );
    }
    const record = {
      environmentId: environment.id,
      reports: queries.length,
      seconds: secondsSince(started),
    };
    await writeJson(join(directory, 'seed.json'), record);
    process.stdout.write(`${JSON.stringify(record)}\n`);
  } finally {
    await database.close();
  }
}

/**
 * C74.4: a sync adding `size` entries to the 100,000-name table, then the re-screen, timed. With
 * `switch` (C271.2, Workflow 11D), that Phase 11 switch is on for the re-screen alone, and the
 * record names it.
 * @param {Run & { size: number, switch?: string, toggle?: { set: (on: boolean) => () => void } }} options
 */
async function rescreen(options) {
  const at = RESCREEN_SIZES.indexOf(options.size);
  if (at < 0) {
    throw new Error(`the re-screen sizes are ${RESCREEN_SIZES.join(', ')}`);
  }
  const directory = join(options.out, 'rescreen');
  await installBenchmarkKeyring(join(options.out, 'keyring'));
  const pool = poolOf(options.seed);
  const groups = shippedGroups();
  const scale = scaleOf('100k', options);
  /** @type {WatchlistRecord[][]} */
  const added = RESCREEN_SIZES.slice(0, at + 1).map((size) =>
    firstOf(
      syntheticEntries({
        seed: `${options.seed}/rescreen-added-${String(size)}`,
        pool,
        names: size * 10,
        profile: scale.profile,
        idPrefix: `BA${String(size)}-`,
      }),
      size,
    ),
  );
  const path = join(directory, `list-${String(options.size)}.json`);
  const written = await writeNormalisedImport(path, {
    source: 'openverify-sandbox',
    publishedAt: new Date(PUBLISHED_BASE + (10 + at) * 60_000).toISOString(),
    records: (function* () {
      yield* heavyHeadedEntries({ seed: options.seed, pool, names: scale.names });
      for (const records of added) {
        yield* records;
      }
    })(),
  });
  const database = await startBenchmarkPostgres(scale.container);
  try {
    const syncStarted = performance.now();
    const sync = await importList({ ...database, groups, path });
    const syncSeconds = secondsSince(syncStarted);
    if (sync.outcome !== 'applied' || sync.syncId === null) {
      throw new Error(`the update did not apply: ${sync.outcome}`);
    }
    const back = options.toggle?.set(true);
    const before = loadavg();
    const started = performance.now();
    const result = await processReportRescreen(
      { syncId: sync.syncId },
      {
        db: database.db,
        clock: { now: () => new Date() },
        logger: SILENT,
        watchlists: BENCHMARK_SETTINGS,
        matcherData: () => ({ status: 'loaded', groups, keysVersion: keysVersion(groups.sha256) }),
        // Review C001: the worker passes the blind-index key, so the stale-evidence lookup runs
        // by `entry_index`, as deployed. The key is synthetic, drawn from the seed.
        blindIndexKey: new Uint8Array(
          createHash('sha256').update(`${options.seed}/rescreen/blind-index`).digest(),
        ),
      },
    );
    const rescreenMs = performance.now() - started;
    back?.();
    const record = {
      added: options.size,
      switch: options.switch ?? null,
      file: { entries: written.entries, bytes: written.bytes, sha256: written.sha256 },
      sync: { outcome: sync.outcome, added: sync.added, entryCount: sync.entryCount },
      syncSeconds,
      rescreenMs: Math.round(rescreenMs),
      budgetMs: RESCREEN_BUDGET_MS,
      result,
      loadAverage: { before, after: loadavg() },
    };
    await writeJson(join(directory, `${String(options.size)}.json`), record);
    process.stdout.write(`${JSON.stringify(record)}\n`);
  } finally {
    await database.close();
    await rm(path, { force: true });
  }
}

/**
 * Owner decision 3 after 6B, review finding C003: the re-screen's no-miss check (the method of
 * `docs/calibration/watchlist-phase6c.md`, decision rule 3), after `rescreen-<size>` and before the
 * next size. Each recurring report's subject is screened in full, as its own scheduled run would
 * screen it: its pinned configuration resolved as a run resolves it, the whole table, no trigger
 * sync, nothing persisted. Its line holds the report id and counts only (`rescreenSubject`).
 * @param {Run & { size: number, worker: number, workers: number }} options
 */
async function rescreenCheckStep(options) {
  if (!RESCREEN_SIZES.includes(options.size)) {
    throw new Error(`the re-screen sizes are ${RESCREEN_SIZES.join(', ')}`);
  }
  if (
    !Number.isInteger(options.workers) ||
    options.workers < 1 ||
    !Number.isInteger(options.worker) ||
    options.worker < 0 ||
    options.worker >= options.workers
  ) {
    throw new Error('--worker is 0 to --workers - 1');
  }
  const started = performance.now();
  const directory = join(options.out, `rescreen-check-${String(options.size)}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await installBenchmarkKeyring(join(options.out, 'keyring'));
  const seed = JSON.parse(await readFile(join(options.out, 'rescreen', 'seed.json'), 'utf8'));
  const read = async () => {
    const names = (await readdir(directory)).filter((name) => /^worker-\d+\.jsonl$/u.test(name));
    /** @type {import('./benchmark-posthoc.mjs').RescreenSubject[]} */
    const lines = [];
    for (const name of names.sort()) {
      lines.push(...rescreenSubjectLines(await readFile(join(directory, name), 'utf8')));
    }
    return lines;
  };
  const groups = shippedGroups();
  const cache = cachedReads();
  const restore = installScreeningKit({ groups, reads: cache.reads });
  const database = await startBenchmarkPostgres(scaleOf('100k', options).container);
  try {
    const sync = (
      await database.pool.query(
        `select id, added from watchlist_syncs
          where source_id = $1 and outcome = 'applied' order by id desc limit 1`,
        [BENCHMARK_SOURCE],
      )
    ).rows[0];
    if (sync === undefined || Number(sync.added) !== options.size) {
      throw new Error(
        `the last applied sync did not add ${String(options.size)} entries: run rescreen-check right after rescreen-${String(options.size)}`,
      );
    }
    const syncId = Number(sync.id);
    const changed = new Set(
      (
        await database.pool.query(
          `select entry_id from watchlist_entries
            where source_id = $1 and changed_sync_id = $2 and removed_at is null`,
          [BENCHMARK_SOURCE, syncId],
        )
      ).rows.map((row) => String(row.entry_id)),
    );
    const runs = (
      await database.pool.query(
        `select report_id from report_runs
          where environment_id = $1 and run_type = 'list_update' and trigger_sync_id = $2`,
        [seed.environmentId, syncId],
      )
    ).rows.map((row) => String(row.report_id));
    const done = new Set((await read()).map((item) => item.reportId));
    const writer = stepWriter({
      append: (text) => appendFile(join(directory, `worker-${String(options.worker)}.jsonl`), text),
      batch: BATCH,
      budgetMs: STEP_BUDGET_MS,
      started,
    });
    let subjects = 0;
    let screened = 0;
    let stopped = false;
    /** @type {string | undefined} */
    let afterId;
    for (;;) {
      const chunk = await listRecurringReportSubjects(database.db, seed.environmentId, {
        sourceId: BENCHMARK_SOURCE,
        reportTypes: ['watchlist'],
        afterId,
        limit: RESCREEN_CHUNK_LIMIT,
      });
      afterId = chunk.at(-1)?.reportId;
      for (const subject of chunk) {
        const index = subjects;
        subjects += 1;
        if (stopped || index % options.workers !== options.worker || done.has(subject.reportId)) {
          continue;
        }
        const outcome = await screenOnce({
          job: watchlistReportJob,
          db: database.db,
          query: subject.query,
          config: resolveReportTemplateConfig('watchlist', subject.config),
        });
        cache.clear();
        if (outcome.kind !== 'completed') {
          throw new Error('a screening asked to wait');
        }
        const line = rescreenSubject(
          subject.reportId,
          outcome.result.matches.map((match) =>
            match.entryKey.slice(match.entryKey.indexOf(':') + 1),
          ),
          changed,
          outcome.result.errors.map((error) => error.code),
        );
        screened += 1;
        stopped = await writer.add(JSON.stringify(line));
      }
      if (chunk.length < RESCREEN_CHUNK_LIMIT) {
        break;
      }
    }
    await writer.flush();
    const lines = await read();
    const seen = new Set(lines.map((item) => item.reportId)).size;
    const progress = {
      size: options.size,
      worker: options.worker,
      workers: options.workers,
      screened,
      done: seen,
      of: subjects,
      seconds: secondsSince(started),
    };
    if (seen < subjects) {
      process.stdout.write(
        `${JSON.stringify(progress)}\nincomplete: run the rescreen-check step again\n`,
      );
      process.exitCode = 3;
      return;
    }
    const summary = {
      ...progress,
      syncId,
      ...rescreenCheck({ changedEntries: changed.size, runs, subjects: lines }),
    };
    await writeJson(join(directory, 'summary.json'), summary);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    restore();
    await database.close();
  }
}

/**
 * Owner decision 7: the first measure round's unlisted subjects with a kept `tolerant` match, read
 * from the round files the measure step wrote.
 * @param {Run & { scale: keyof typeof SCALES }} options
 */
async function unlisted(options) {
  const directory = join(options.out, options.scale);
  /** @type {TimedScreening[]} */
  const timings = [];
  for (let round = 1; round <= ROUNDS; round += 1) {
    const saved = JSON.parse(
      await readFile(join(directory, `round-${String(round)}.json`), 'utf8'),
    );
    timings.push(...saved.timings);
  }
  const record = { scale: options.scale, preset: 'tolerant', ...unlistedAlerts(timings) };
  await writeJson(join(directory, 'unlisted.json'), record);
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

/**
 * Owner decision 7: the compacted-table round. `VACUUM (FULL, ANALYZE)` rewrites the list tables
 * without the successive syncs' dead space, then the subjects are screened once more, after the
 * warm-up, as one measure round.
 * @param {Run & { scale: keyof typeof SCALES }} options
 */
async function compact(options) {
  const scale = scaleOf(options.scale, options);
  const directory = join(options.out, options.scale);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const pool = poolOf(options.seed);
  const subjects = subjectsOf(options, pool);
  const groups = shippedGroups();
  const timed = timedReads();
  const restore = installScreeningKit({ groups, reads: timed.reads });
  const database = await startBenchmarkPostgres(scale.container);
  const screen = timedScreener(database.db, timed);
  try {
    const before = await databaseFacts(database.pool);
    const loadBefore = loadavg();
    const vacuumStarted = performance.now();
    await vacuumFull(database.pool);
    const vacuumSeconds = secondsSince(vacuumStarted);
    const after = await databaseFacts(database.pool);
    for (const item of subjects.slice(0, options.smoke ? SMOKE.warmUp : WARM_UP)) {
      await screen(item, 0);
    }
    const started = performance.now();
    const timings = [];
    for (const item of subjects) {
      timings.push(await screen(item, 1));
    }
    const record = {
      scale: options.scale,
      budgetMs: scale.budgetMs,
      subjects: subjects.length,
      vacuumSeconds,
      roundSeconds: secondsSince(started),
      before,
      after,
      loadAverage: { before: loadBefore, after: loadavg() },
      summary: performanceSummary(timings),
    };
    await writeJson(join(directory, 'compact-round.json'), { timings });
    await writeJson(join(directory, 'compact.json'), record);
    process.stdout.write(`${JSON.stringify(record)}\n`);
  } finally {
    restore();
    await database.close();
  }
}

/**
 * Owner decisions 1 and 5: variant cases of the development table's listed entries, and the
 * measure step's unlisted subjects, screened at each fixed preset; recall per source, precision
 * and the unlisted subjects' alerts (`benchmark-variants.mjs`). It resumes where it stopped.
 * @param {Run & { scale: keyof typeof SCALES }} options
 */
async function variants(options) {
  const started = performance.now();
  const scale = scaleOf(options.scale, options);
  const directory = join(options.out, options.scale);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const pool = poolOf(options.seed);
  const table = tableOf(options, pool);
  const cases = developmentVariants(table, {
    seed: `${options.seed}/${options.scale}/variants`,
    count: options.smoke ? SMOKE.variantCases : VARIANT_CASES,
  });
  const unlistedSubjects = unlistedQueries({
    seed: `${options.seed}/${options.scale}/unlisted`,
    pool,
    count: subjectCount(options),
  });
  const queries = [
    ...cases.map((item) => ({ ...item, source: /** @type {string | null} */ (item.source) })),
    ...unlistedSubjects.map((query, index) => ({
      id: `DU-${String(index + 1).padStart(5, '0')}`,
      source: null,
      entryId: null,
      query,
    })),
  ];
  const path = join(directory, 'variants.jsonl');
  const read = async () =>
    (await readFile(path, 'utf8').catch(() => ''))
      .split('\n')
      .filter((line) => line !== '')
      .map(
        (line) =>
          /** @type {import('./benchmark-variants.mjs').VariantObservation} */ (JSON.parse(line)),
      );
  const done = new Set((await read()).map((item) => item.id));
  const groups = shippedGroups();
  const cache = cachedReads();
  const restore = installScreeningKit({ groups, reads: cache.reads });
  const database = await startBenchmarkPostgres(scale.container);
  const writer = stepWriter({
    append: (text) => appendFile(path, text),
    batch: BATCH,
    budgetMs: STEP_BUDGET_MS,
    started,
  });
  try {
    for (const item of queries) {
      if (done.has(item.id)) {
        continue;
      }
      /** @type {import('./benchmark-variants.mjs').VariantObservation['presets']} */
      const presets = {};
      for (const preset of PRESETS) {
        const outcome = await screenOnce({
          job: watchlistReportJob,
          db: database.db,
          query: item.query,
          config: screeningConfig('watchlist', preset),
        });
        if (outcome.kind !== 'completed') {
          throw new Error('a screening asked to wait');
        }
        presets[preset] = {
          matched: outcome.result.matches.map((match) => match.entryKey.split(':').at(-1) ?? ''),
          truncated: (outcome.result.coverage?.limits ?? []).includes('truncated'),
          errors: outcome.result.errors.map((error) => error.code),
        };
      }
      cache.clear();
      done.add(item.id);
      const line = JSON.stringify({
        id: item.id,
        source: item.source,
        entryId: item.entryId,
        presets,
      });
      if (await writer.add(line)) {
        break;
      }
    }
    await writer.flush();
  } finally {
    restore();
    await database.close();
  }
  if (done.size < queries.length) {
    process.stdout.write(
      `${JSON.stringify({ done: done.size, of: queries.length })}\nincomplete: run the variants step again\n`,
    );
    process.exitCode = 3;
    return;
  }
  const record = {
    scale: options.scale,
    cases: cases.length,
    unlisted: unlistedSubjects.length,
    summary: variantSummary(await read(), PRESETS),
  };
  await writeJson(join(directory, 'variants.json'), record);
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

/** Owner decision 8 after 6C: the rounds of a share, off then on, per take. */
const SHARE_TAKES = 3;
/** The database read shortcuts of `@openverify/db` (`useWatchlistReadShortcuts`). */
const READ_SHORTCUTS = Object.freeze(['array-parameters']);

/**
 * How a share step turns a switch off and on, and empties the caches before a round. Imported
 * when the step runs, so the step needs the head's switches and the other steps run at a base
 * without them.
 * @param {string} name
 */
async function switchOf(name) {
  const shortcuts = await import('../src/match/shortcuts.js');
  const emptyCaches = () => {
    shortcuts.useScreeningShortcuts({ 'name-cache': false, 'token-cache': false })();
  };
  if (READ_SHORTCUTS.includes(name)) {
    const db = /** @type {Record<string, unknown>} */ (await import('../../db/src/index.js'));
    const use = db.useWatchlistReadShortcuts;
    if (typeof use !== 'function') {
      throw new Error('this tree has no database read shortcuts');
    }
    return {
      set: (/** @type {boolean} */ on) =>
        /** @type {(switches: Record<string, boolean>) => () => void} */ (use)({ [name]: on }),
      emptyCaches,
    };
  }
  // Workflow 11D (Stage 1a amendment 7): the Phase 11 registry's switches, when the tree has it.
  const db = /** @type {Record<string, unknown>} */ (await import('../../db/src/index.js'));
  const phase11 = Array.isArray(db.WATCHLIST_PHASE11_SWITCHES)
    ? /** @type {readonly string[]} */ (db.WATCHLIST_PHASE11_SWITCHES)
    : [];
  if (phase11.includes(name) && typeof db.useWatchlistSwitches === 'function') {
    const use = /** @type {(switches: Record<string, boolean>) => () => void} */ (
      db.useWatchlistSwitches
    );
    return { set: (/** @type {boolean} */ on) => use({ [name]: on }), emptyCaches };
  }
  const known = /** @type {readonly string[]} */ (shortcuts.SCREENING_SHORTCUTS);
  if (!known.includes(name)) {
    throw new Error(`--switch is one of ${[...known, ...READ_SHORTCUTS, ...phase11].join(', ')}`);
  }
  return {
    set: (/** @type {boolean} */ on) => shortcuts.useScreeningShortcuts({ [name]: on }),
    emptyCaches,
  };
}

/**
 * Owner decision 8 after Workflow 6C: one switchable change's share at a scale, in one process
 * (one lock hold). After a priming round with every switch on (not recorded), `--takes` pairs of
 * rounds run, the switch off then on. Before each round the analysed-name and token caches are
 * emptied and the warm-ups run again, so each round starts as a measure step's first round does.
 * Every round digests each subject's created matches, and each must equal the priming round's.
 * @param {Run & { scale: keyof typeof SCALES, switch: string, takes?: number }} options
 */
async function sharesStep(options) {
  const scale = scaleOf(options.scale, options);
  const directory = join(options.out, options.scale, 'shares');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const toggle = await switchOf(options.switch);
  const pool = poolOf(options.seed);
  const subjects = subjectsOf(options, pool);
  const groups = shippedGroups();
  const timed = timedReads();
  const restore = installScreeningKit({ groups, reads: timed.reads });
  const database = await startBenchmarkPostgres(scale.container);
  const screen = timedScreener(database.db, timed);
  const warmUp = options.smoke ? SMOKE.warmUp : WARM_UP;
  const takes = options.takes ?? SHARE_TAKES;
  /** @param {number} round */
  const roundOf = async (round) => {
    toggle.emptyCaches();
    for (const item of subjects.slice(0, warmUp)) {
      await screen(item, 0);
    }
    const before = loadavg();
    const started = performance.now();
    const timings = [];
    for (const item of subjects) {
      timings.push(await screen(item, round));
    }
    return { before, after: loadavg(), seconds: secondsSince(started), timings };
  };
  try {
    const priming = await roundOf(0);
    const reference = priming.timings.map((item) => item.digest);
    const rounds = [];
    let differing = 0;
    for (let round = 1; round <= takes * 2; round += 1) {
      const state = round % 2 === 1 ? /** @type {const} */ ('off') : /** @type {const} */ ('on');
      const back = toggle.set(state === 'on');
      try {
        const ran = await roundOf(round);
        differing += ran.timings.filter((item, index) => item.digest !== reference[index]).length;
        const summary = performanceSummary(ran.timings);
        rounds.push({
          round,
          state,
          before: ran.before,
          after: ran.after,
          seconds: ran.seconds,
          p50: summary.ms.p50,
          p95: summary.ms.p95,
          phaseP95: summary.phaseP95,
        });
      } finally {
        back();
      }
    }
    const record = {
      scale: options.scale,
      switch: options.switch,
      subjects: subjects.length,
      warmUp,
      priming: { before: priming.before, after: priming.after, seconds: priming.seconds },
      rounds,
      share: switchShare(rounds),
      differing,
      identical: differing === 0,
    };
    await writeJson(join(directory, `${options.switch}.json`), record);
    process.stdout.write(`${JSON.stringify(record)}\n`);
  } finally {
    restore();
    await database.close();
  }
}

/**
 * Owner decision 8 after Workflow 6C (review C004 at scale): after `rescreen-<size>` and before the
 * next size, every `list_update` run that re-screen inserted is executed as the worker would run
 * it (its report's pinned configuration, its trigger sync), with nothing persisted. Each must keep a
 * match on an entry the sync changed (a forward-screen hit its run keeps); when
 * `rescreen-check-<size>` has run, each run report whose full screening keeps such matches must
 * keep at least as many. `k` processes side by side each execute every `k`-th run; it resumes,
 * exits 3 while a run is not executed, and the call that finds every run executed writes
 * `rescreen-runs-<size>/summary.json`. Lines hold the report id, counts and codes only.
 * @param {Run & { size: number, worker: number, workers: number }} options
 */
async function rescreenRunsStep(options) {
  if (!RESCREEN_SIZES.includes(options.size)) {
    throw new Error(`the re-screen sizes are ${RESCREEN_SIZES.join(', ')}`);
  }
  if (
    !Number.isInteger(options.workers) ||
    options.workers < 1 ||
    !Number.isInteger(options.worker) ||
    options.worker < 0 ||
    options.worker >= options.workers
  ) {
    throw new Error('--worker is 0 to --workers - 1');
  }
  const started = performance.now();
  const directory = join(options.out, `rescreen-runs-${String(options.size)}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await installBenchmarkKeyring(join(options.out, 'keyring'));
  const seed = JSON.parse(await readFile(join(options.out, 'rescreen', 'seed.json'), 'utf8'));
  /** @param {string} folder */
  const read = async (folder) => {
    const names = await readdir(folder).catch(() => /** @type {string[]} */ ([]));
    /** @type {import('./benchmark-posthoc.mjs').RescreenSubject[]} */
    const lines = [];
    for (const name of names.filter((item) => /^worker-\d+\.jsonl$/u.test(item)).sort()) {
      lines.push(...rescreenSubjectLines(await readFile(join(folder, name), 'utf8')));
    }
    return lines;
  };
  const groups = shippedGroups();
  const cache = cachedReads();
  const restore = installScreeningKit({ groups, reads: cache.reads });
  const database = await startBenchmarkPostgres(scaleOf('100k', options).container);
  try {
    const sync = (
      await database.pool.query(
        `select id, added from watchlist_syncs
          where source_id = $1 and outcome = 'applied' order by id desc limit 1`,
        [BENCHMARK_SOURCE],
      )
    ).rows[0];
    if (sync === undefined || Number(sync.added) !== options.size) {
      throw new Error(
        `the last applied sync did not add ${String(options.size)} entries: run rescreen-runs right after rescreen-${String(options.size)}`,
      );
    }
    const syncId = Number(sync.id);
    const changed = new Set(
      (
        await database.pool.query(
          `select entry_id from watchlist_entries
            where source_id = $1 and changed_sync_id = $2 and removed_at is null`,
          [BENCHMARK_SOURCE, syncId],
        )
      ).rows.map((row) => String(row.entry_id)),
    );
    const runs = (
      await database.pool.query(
        `select report_id from report_runs
          where environment_id = $1 and run_type = 'list_update' and trigger_sync_id = $2
          order by report_id`,
        [seed.environmentId, syncId],
      )
    ).rows.map((row) => String(row.report_id));
    const mine = new Set(runs.filter((_, index) => index % options.workers === options.worker));
    const done = new Set((await read(directory)).map((item) => item.reportId));
    const writer = stepWriter({
      append: (text) => appendFile(join(directory, `worker-${String(options.worker)}.jsonl`), text),
      batch: BATCH,
      budgetMs: STEP_BUDGET_MS,
      started,
    });
    let executed = 0;
    let stopped = false;
    /** @type {number[]} */
    const times = [];
    /** @type {string | undefined} */
    let afterId;
    while (!stopped) {
      const chunk = await listRecurringReportSubjects(database.db, seed.environmentId, {
        sourceId: BENCHMARK_SOURCE,
        reportTypes: ['watchlist'],
        afterId,
        limit: RESCREEN_CHUNK_LIMIT,
      });
      afterId = chunk.at(-1)?.reportId;
      for (const subject of chunk) {
        if (stopped || !mine.has(subject.reportId) || done.has(subject.reportId)) {
          continue;
        }
        const runStarted = performance.now();
        const outcome = await screenOnce({
          job: watchlistReportJob,
          db: database.db,
          query: subject.query,
          config: resolveReportTemplateConfig('watchlist', subject.config),
          run: { runType: 'list_update', triggerSyncId: syncId },
        });
        times.push(performance.now() - runStarted);
        cache.clear();
        if (outcome.kind !== 'completed') {
          throw new Error('a run asked to wait');
        }
        const line = {
          ...rescreenSubject(
            subject.reportId,
            outcome.result.matches.map((match) =>
              match.entryKey.slice(match.entryKey.indexOf(':') + 1),
            ),
            changed,
            outcome.result.errors.map((error) => error.code),
          ),
          // The same subject at two trees of one seed, whatever its report id.
          subject: createHash('sha256').update(canonicalJson(subject.query), 'utf8').digest('hex'),
        };
        executed += 1;
        stopped = await writer.add(JSON.stringify(line));
      }
      if (chunk.length < RESCREEN_CHUNK_LIMIT) {
        break;
      }
    }
    await writer.flush();
    const lines = await read(directory);
    const seen = new Set(lines.map((item) => item.reportId).filter((id) => runs.includes(id)));
    const progress = {
      size: options.size,
      worker: options.worker,
      workers: options.workers,
      executed,
      done: seen.size,
      of: runs.length,
      runMs: times.length === 0 ? null : { p50: percentile(times, 0.5), max: Math.max(...times) },
      seconds: secondsSince(started),
    };
    if (seen.size < runs.length) {
      process.stdout.write(
        `${JSON.stringify(progress)}\nincomplete: run the rescreen-runs step again\n`,
      );
      process.exitCode = 3;
      return;
    }
    const full = await read(join(options.out, `rescreen-check-${String(options.size)}`));
    const summary = {
      ...progress,
      syncId,
      changedEntries: changed.size,
      fullScreenings: full.length,
      ...executedRunsCheck({ runs, lines, ...(full.length === 0 ? {} : { full }) }),
    };
    await writeJson(join(directory, 'summary.json'), summary);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    restore();
    await database.close();
  }
}

/**
 * Owner decision 8 after Workflow 6C: two performance runs of one seed (6D's base and head), each
 * scale's first measure round compared subject by subject (the kept matches' count and digest, the
 * listed subject found, the candidates, truncation, the cap, the reach and the errors). Written to
 * `<out>/performance-identity.json` (the quality CLI's is `quality-identity.json`).
 * @param {{ base: string, head: string, out: string }} options
 */
async function performanceIdentity(options) {
  const fields = [
    'kept',
    'found',
    'candidates',
    'truncated',
    'capReached',
    'unreachable',
    'errors',
    'digest',
  ];
  /** @param {string} directory @param {string} scale */
  const lines = async (directory, scale) => {
    const text = await readFile(join(directory, scale, 'round-1.json'), 'utf8').catch(() => null);
    if (text === null) {
      return [];
    }
    /** @type {{ timings: Record<string, unknown>[] }} */
    const round = JSON.parse(text);
    return round.timings.map((timing, index) => ({
      key: String(index),
      presets: { tolerant: timing },
    }));
  };
  /** @type {Record<string, import('./benchmark-scale.mjs').IdentityResult>} */
  const scales = {};
  for (const scale of Object.keys(SCALES)) {
    const [base, head] = await Promise.all([
      lines(options.base, scale),
      lines(options.head, scale),
    ]);
    if (base.length > 0 || head.length > 0) {
      scales[scale] = identityCheck(base, head, { fields });
    }
  }
  const record = {
    base: options.base,
    head: options.head,
    scales,
    same: Object.keys(scales).length > 0 && Object.values(scales).every((item) => item.same),
  };
  await mkdir(options.out, { recursive: true, mode: 0o700 });
  await writeJson(join(options.out, 'performance-identity.json'), record);
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

/**
 * Workflow 11D: what the write steps (`benchmark-write-steps.mjs`) borrow from this script.
 * @param {Run} run
 * @returns {import('./benchmark-write-steps.mjs').WriteKit}
 */
function writeKitOf(run) {
  return {
    scaleOf: (options) => scaleOf(options.scale, options),
    poolOf,
    shippedGroups,
    entriesOf: (options, pool, names) => entriesOf(options, pool, names),
    subjectsOf: (options, pool, table) => subjectsOf(options, pool, table),
    timedScreener,
    publishedBase: PUBLISHED_BASE,
    warmUp: run.smoke ? SMOKE.warmUp : WARM_UP,
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      seed: { type: 'string' },
      out: { type: 'string', default: '/tmp/openverify-eval-6/performance' },
      step: { type: 'string' },
      part: { type: 'string' },
      parts: { type: 'string' },
      rounds: { type: 'string' },
      smoke: { type: 'boolean', default: false },
      namespace: { type: 'string' },
      size: { type: 'string' },
      worker: { type: 'string', default: '0' },
      workers: { type: 'string', default: '1' },
      switch: { type: 'string' },
      takes: { type: 'string' },
      base: { type: 'string' },
      head: { type: 'string' },
      // Workflow 11D's write steps (benchmark-write-steps.mjs).
      as: { type: 'string' },
      take: { type: 'string' },
      tune: { type: 'string', multiple: true },
      heartbeat: { type: 'string' },
    },
  });
  const step = values.step ?? '';
  const naming = { smoke: values.smoke, namespace: values.namespace };
  if (step === 'identity') {
    if (values.base === undefined || values.head === undefined) {
      throw new Error(
        '--step identity takes --base and --head (two performance output directories)',
      );
    }
    await performanceIdentity({ base: values.base, head: values.head, out: values.out });
    return;
  }
  if (step.endsWith('-teardown')) {
    await stopBenchmarkPostgres(scaleOf(step === '2m-teardown' ? '2m' : '100k', naming).container);
    return;
  }
  if (values.seed === undefined || !/^[0-9a-f]{32}$/u.test(values.seed)) {
    throw new Error('--seed takes the 32 hexadecimal digits of openssl rand -hex 16');
  }
  /** @type {Run} */
  const options = { seed: values.seed, out: values.out, ...naming };
  await mkdir(options.out, { recursive: true, mode: 0o700 });
  const parts = values.parts === undefined ? {} : { parts: Number(values.parts) };
  const rescreenSize = /^rescreen-(\d+)$/u.exec(step)?.[1];
  const scaleStep = /^(100k|2m)-(measure|unlisted|variants|compact|shares)$/u.exec(step);
  const scaleName = /** @type {keyof typeof SCALES | undefined} */ (scaleStep?.[1]);
  const write = writeStepOf(step);
  if (step === 'machine') {
    await machine(options);
  } else if (step === '100k-import') {
    await importPart({ ...options, scale: '100k', part: 1, ...parts });
  } else if (step === '2m-import') {
    await importPart({ ...options, scale: '2m', part: Number(values.part), ...parts });
  } else if (scaleName !== undefined && scaleStep?.[2] === 'measure') {
    await measure({
      ...options,
      scale: scaleName,
      ...(values.rounds === undefined ? {} : { rounds: Number(values.rounds) }),
    });
  } else if (scaleName !== undefined && scaleStep?.[2] === 'unlisted') {
    await unlisted({ ...options, scale: scaleName });
  } else if (scaleName !== undefined && scaleStep?.[2] === 'variants') {
    await variants({ ...options, scale: scaleName });
  } else if (scaleName !== undefined && scaleStep?.[2] === 'compact') {
    await compact({ ...options, scale: scaleName });
  } else if (scaleName !== undefined && scaleStep?.[2] === 'shares') {
    if (values.switch === undefined) {
      throw new Error('--step <scale>-shares takes --switch <name>');
    }
    await sharesStep({
      ...options,
      scale: scaleName,
      switch: values.switch,
      ...(values.takes === undefined ? {} : { takes: Number(values.takes) }),
    });
  } else if (step === 'rescreen-runs') {
    await rescreenRunsStep({
      ...options,
      size: Number(values.size),
      worker: Number(values.worker),
      workers: Number(values.workers),
    });
  } else if (step === 'rescreen-seed') {
    await rescreenSeed(options);
  } else if (step === 'rescreen-check') {
    await rescreenCheckStep({
      ...options,
      size: Number(values.size),
      worker: Number(values.worker),
      workers: Number(values.workers),
    });
  } else if (rescreenSize !== undefined) {
    // C271.2 (Workflow 11D, matcher-c787-11d): a re-screen lever's share is measured on this
    // step, with its Phase 11 switch on for the one re-screen; the name is checked first.
    const toggle = values.switch === undefined ? undefined : await switchOf(values.switch);
    await rescreen({
      ...options,
      size: Number(rescreenSize),
      ...(values.switch === undefined || toggle === undefined
        ? {}
        : { switch: values.switch, toggle }),
    });
  } else if (write !== null) {
    const { runWriteStep } = await import('./benchmark-write-steps.mjs');
    const whole = (/** @type {string | undefined} */ value) =>
      value === undefined ? undefined : Number(value);
    await runWriteStep(
      write.name,
      { ...options, scale: write.scale, ...parts },
      writeKitOf(options),
      {
        as: values.as,
        size: whole(values.size),
        takes: whole(values.takes),
        take: whole(values.take),
        switch: values.switch,
        tunes: parseTunes(values.tune),
        heartbeat: values.heartbeat,
      },
    );
  } else {
    throw new Error('see the file header for the steps');
  }
}

await main();

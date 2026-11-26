// @ts-check
/**
 * C78.8 (evaluation-6, H21, V12): the quality benchmark of the watchlist matcher. The method is in
 * `docs/calibration/watchlist-phase6.md`; the helpers are tested beside this script.
 *
 *   pnpm --filter @openverify/watchlist benchmark:quality --seed <hex> --build <held-out build>
 *     [--out /tmp/openverify-eval-6/quality] [--step prepare|screen|report|teardown]
 *
 * - `prepare`: checks the pinned group source, generates the held-out set from the seed (fixtures-6's
 *   generator, by path), asserts its independence from the measured build (V12), writes the list
 *   and imports it through the sync into a migrated Postgres (Testcontainers).
 * - `screen`: screens every case (names only, and with the listed birth date), every company and
 *   every customer through the report jobs at each fixed preset, appending the kept entry ids to
 *   `observations.jsonl`. It stops after about eight minutes and resumes where it stopped (exit 3).
 * - `report`: recall per variant source, precision and alerts per 1,000 customers, with 95%
 *   intervals from 2,000 bootstrap replicates over listed identities (`results.json`).
 * - `teardown`: removes the container.
 *
 * Workflow 6C added (owner decisions 5 and 7; no step or flag of 6B was renamed):
 * - `typo-kinds` (needs `--build`, after `report`): the 6B typo cases by kind (one letter
 *   substituted, inserted or deleted, or two transposed), token length and preset;
 * - `scale-prepare --scale 100k|2m [--part n] [--parts N]`: the held-out population drawn from the
 *   performance table's own law, embedded in that table (the same generator and seed as the
 *   performance benchmark's, so the table is the performance table plus the population), imported
 *   through the sync with the shipped variant groups into a container of its own; at 2,000,000
 *   names in 8 parts (or `--parts N`); the last part writes the indistinguishable customers;
 * - `scale-screen --scale X` (resumes; exits 3 at its 8-minute budget), `scale-report --scale X`
 *   (recall, precision and false alerts per 1,000 per set and preset, with 95% intervals over the
 *   population's identities and the customers), `scale-teardown --scale X`;
 * - `compare --seed <hex> --base <dir> --head <dir> --out <dir>`: two runs of one seed (Workflow
 *   6C's base and head), each a quality output directory: every set's measures at base and head
 *   and `head - base` with its paired 95% interval, written to `<out>/compare.json`.
 *
 * Workflow 6D added (owner decision 8 after 6C): each observation line's preset carries `digest`,
 * the SHA-256 of the full created matches; `identity --base <dir> --head <dir> --out <dir>` keys
 * two runs of one seed by query and preset and writes `<out>/quality-identity.json` (its own name,
 * so the performance CLI's `performance-identity.json` can share the directory).
 *
 * Flags (Workflow 6C): `--smoke` (development only: small sizes, never a published number; the
 * containers' names end in `-smoke`), `--namespace <name>` (the containers' names carry it, so two
 * worktrees never share a database; teardown takes the same flags).
 *
 * Everything generated stays in the output directory, outside git; stdout carries counts, digests
 * and, from `report`, the aggregates. No name is printed.
 */
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { businessWatchlistReportJob } from '../../../apps/api/src/jobs/report-types/business-watchlist.js';
import { watchlistReportJob } from '../../../apps/api/src/jobs/report-types/watchlist.js';
import {
  SHIPPED_VARIANT_GROUPS_SHA256,
  loadVariantGroups,
  parseVariantGroups as parseMeasuredBuild,
} from '../src/keys/index.js';
import {
  generateHeldOutSet,
  generateScalePopulation,
  indistinguishableCustomers,
  parseVariantGroups as parseRawGroups,
} from '../src/testing/held-out/index.js';
import {
  assertHeldOutIndependence,
  readVariantGroupBuild,
  shareSurvivingGroup,
} from './benchmark-independence.mjs';
import { bootstrapQuality, qualityPoint } from './benchmark-metrics.mjs';
import { typoEdit, typoKindBreakdown } from './benchmark-posthoc.mjs';
import {
  BENCHMARK_SOURCE,
  cachedReads,
  databaseFacts,
  importList,
  installScreeningKit,
  screenOnce,
  screeningConfig,
  startBenchmarkPostgres,
  stopBenchmarkPostgres,
  vacuumAnalyse,
} from './benchmark-postgres.mjs';
import {
  compareSet,
  containerName,
  identityCheck,
  matchDigest,
  partTarget,
  setResults,
  splitMatches,
  stepWriter,
} from './benchmark-scale.mjs';
import {
  HEAVY_HEADED_100K,
  TABLE_PROFILES,
  heavyHeadedEntries,
  heavyHeadedPool,
  syntheticEntries,
} from '../src/testing/heavy-headed.js';
import { writeNormalisedImport } from './benchmark-tables.mjs';

/** @typedef {import('../src/testing/held-out/index.js').HeldOutSet} HeldOutSet */
/** @typedef {import('../src/testing/held-out/index.js').HeldOutCase} HeldOutCase */
/** @typedef {import('./benchmark-metrics.mjs').QualityObservations} QualityObservations */

const ROOT = join(import.meta.dirname, '..', '..', '..');
const CONTAINER = 'evaluation-6-quality';

/**
 * Owner decision 5: the held-out population of the scale sets, fixed before any evaluation seed.
 * Each listed person and company carries one variant case (7 person sources of 150, 4 company
 * sources of 100); the customers are never listed.
 */
export const SCALE_SIZES = Object.freeze({
  persons: 1050,
  companies: 400,
  customers: 1500,
  businessCustomers: 500,
});
/** Development only (never an evaluation): the scale sets' smoke sizes. */
const SCALE_SMOKE_SIZES = Object.freeze({
  persons: 28,
  companies: 8,
  customers: 40,
  businessCustomers: 10,
});
/**
 * The performance tables the population is embedded in: the performance benchmark's generator,
 * profiles and seeds (`<seed>/pool`, `<seed>/100k`, `<seed>/2m`), so each is that benchmark's table;
 * both come from the shared module (owner decision 6 after 6C), the 100,000-name one as the C78.7
 * gate draws it.
 */
const SCALE_TABLES = Object.freeze({
  '100k': Object.freeze({
    names: HEAVY_HEADED_100K.names,
    smokeNames: 5000,
    profile: HEAVY_HEADED_100K.profile,
    idPrefix: HEAVY_HEADED_100K.idPrefix,
    parts: 1,
  }),
  '2m': Object.freeze({
    names: 2_000_000,
    smokeNames: 16_000,
    profile: TABLE_PROFILES.pep,
    idPrefix: 'BP-',
    parts: 8,
  }),
});
/** The population's id prefix; the tables' own entries never carry it. */
const POPULATION_PREFIX = 'HZ-';
const PUBLISHED_BASE = Date.parse('2026-10-01T00:00:00.000Z');

/** @typedef {keyof typeof SCALE_TABLES} ScaleName */

/**
 * @typedef {object} Options The options of the 6B steps.
 * @property {string} seed
 * @property {string} build
 * @property {string} out
 * @property {boolean} smoke
 * @property {string | undefined} namespace
 */

/**
 * @typedef {object} ScaleOptions The options of the scale steps.
 * @property {string} seed
 * @property {string} out
 * @property {boolean} smoke
 * @property {string | undefined} namespace
 * @property {ScaleName} scale
 */

/**
 * The 6B quality container, named for the run.
 * @param {{ smoke: boolean, namespace: string | undefined }} options
 */
const qualityContainer = (options) => containerName(CONTAINER, options);

/**
 * A scale table's container, named for the run.
 * @param {ScaleName} scale
 * @param {{ smoke: boolean, namespace: string | undefined }} options
 */
const scaleContainer = (scale, options) => containerName(`evaluation-6c-quality-${scale}`, options);
/** C78.8: the set's sizes, fixed in the method before the first number. */
export const QUALITY_SIZES = Object.freeze({
  persons: 2000,
  companies: 600,
  customers: 10_000,
  groupCases: 500,
});
/** Development only (never an evaluation): a small set to check the plumbing on a scratch seed. */
const SMOKE_SIZES = Object.freeze({ persons: 40, companies: 12, customers: 60, groupCases: 10 });
/** @type {readonly ('exact' | 'strict' | 'tolerant')[]} */
export const PRESETS = Object.freeze(['exact', 'strict', 'tolerant']);
const REPLICATES = 2000;
const STEP_BUDGET_MS = 8 * 60_000;
const BATCH = 200;

const sha256 = (/** @type {string | Uint8Array} */ bytes) =>
  createHash('sha256').update(bytes).digest('hex');

/**
 * @typedef {object} Query
 * @property {string} key
 * @property {'persons/names' | 'persons/birthdates' | 'companies' | 'customers'} set
 * @property {Record<string, unknown>} query
 * @property {string | null} identity
 * @property {string | null} source
 */

/**
 * @typedef {object} Observation
 * @property {string} key
 * @property {Query['set']} set
 * @property {string | null} identity
 * @property {string | null} source
 * @property {Record<string, { matched: string[], limits: string[], errors: string[], digest?: string }>} presets
 *   `digest` (owner decision 8 after 6C): the SHA-256 of the full created matches
 *   (`matchDigest`); absent from lines written before it.
 */

/** The pinned group source, checked against `data/manifest.json`. */
async function rawGroups() {
  /** @type {{ data: { name: string, filename: string, sha256: string }[] }} */
  const manifest = JSON.parse(await readFile(join(ROOT, 'data', 'manifest.json'), 'utf8'));
  const entry = manifest.data.find((item) => item.name === 'rigour_person_names');
  if (entry === undefined) {
    throw new Error('data/manifest.json has no rigour_person_names entry');
  }
  const bytes = await readFile(join(ROOT, 'data', entry.filename));
  if (sha256(bytes) !== entry.sha256) {
    throw new Error('the group source is not the pinned file (run python3 scripts/fetch_data.py)');
  }
  return { pinned: entry.sha256, groups: parseRawGroups(bytes.toString('utf8')) };
}

/**
 * The held-out set (names-only and birth-date queries) and the measured build, checked (V12).
 * @param {{ seed: string, build: string, smoke: boolean }} options
 */
async function heldOut(options) {
  const { pinned, groups } = await rawGroups();
  const sizes = options.smoke ? SMOKE_SIZES : QUALITY_SIZES;
  const set = generateHeldOutSet({ seed: options.seed, ...sizes, groups });
  const dated = generateHeldOutSet({ seed: options.seed, ...sizes, groups, withBirthdates: true });
  const buildBytes = await readFile(options.build);
  const build = readVariantGroupBuild(buildBytes.toString('utf8'));
  const independence = assertHeldOutIndependence({
    seed: options.seed,
    build,
    pinnedSourceSha256: pinned,
    cases: set.cases,
    heldOutGroupIds: set.heldOutGroupIds,
  });
  return {
    set,
    dated,
    pinned,
    buildBytes,
    build,
    independence,
    measured: parseMeasuredBuild(buildBytes),
  };
}

/**
 * Every query of the evaluation, in a fixed order.
 * @param {HeldOutSet} set
 * @param {HeldOutSet} dated
 * @returns {Query[]}
 */
function queriesOf(set, dated) {
  /** @type {Query[]} */
  const queries = [];
  for (const [index, item] of set.cases.entries()) {
    const withDate = dated.cases[index];
    if (withDate === undefined || withDate.id !== item.id) {
      throw new Error('the two variants of the held-out set disagree');
    }
    const base = { identity: item.expectedEntryId, source: item.variantSource };
    if (item.subject === 'business') {
      queries.push({ key: `B:${item.id}`, set: 'companies', query: item.query, ...base });
    } else {
      queries.push({ key: `N:${item.id}`, set: 'persons/names', query: item.query, ...base });
      queries.push({
        key: `D:${item.id}`,
        set: 'persons/birthdates',
        query: withDate.query,
        ...base,
      });
    }
  }
  for (const customer of set.customers) {
    queries.push({
      key: `C:${customer.id}`,
      set: 'customers',
      query: customer.query,
      identity: null,
      source: null,
    });
  }
  return queries;
}

/** @param {string} out */
const observationsPath = (out) => join(out, 'observations.jsonl');

/**
 * @param {string} out
 * @returns {Promise<Observation[]>}
 */
async function readObservations(out) {
  try {
    const text = await readFile(observationsPath(out), 'utf8');
    return text
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => /** @type {Observation} */ (JSON.parse(line)));
  } catch {
    return [];
  }
}

/** @param {Options} options */
async function prepare(options) {
  const started = performance.now();
  const { set, pinned, buildBytes, build, independence, measured } = await heldOut(options);
  const listPath = join(options.out, 'list.json');
  await writeFile(
    listPath,
    JSON.stringify({
      source: BENCHMARK_SOURCE,
      published_at: set.list.published_at,
      entries: set.list.entries,
    }),
    { mode: 0o600 },
  );
  const database = await startBenchmarkPostgres(qualityContainer(options));
  try {
    const sync = await importList({ ...database, groups: measured, path: listPath });
    if (sync.outcome !== 'applied') {
      throw new Error(`the held-out list did not apply: ${sync.outcome}`);
    }
    /** @type {Record<string, number>} */
    const sources = {};
    for (const item of set.cases) {
      sources[`${item.subject}/${item.variantSource}`] =
        (sources[`${item.subject}/${item.variantSource}`] ?? 0) + 1;
    }
    const summary = {
      seed: options.seed,
      sizes: options.smoke ? SMOKE_SIZES : QUALITY_SIZES,
      smoke: options.smoke,
      groupSourceSha256: pinned,
      build: {
        sha256: sha256(buildBytes),
        heldOut: build.heldOut,
        groups: build.groupIds.size,
        sourceSha256: build.sourceSha256,
      },
      independence,
      list: { entries: set.list.entries.length, sha256: sha256(await readFile(listPath)) },
      cases: set.cases.length,
      casesBySource: sources,
      customers: set.customers.length,
      sync: {
        outcome: sync.outcome,
        entryCount: sync.entryCount,
        added: sync.added,
        syncId: sync.syncId,
      },
      seconds: Math.round((performance.now() - started) / 100) / 10,
    };
    await writeFile(join(options.out, 'prepare.json'), `${JSON.stringify(summary, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    await database.close();
  }
}

/**
 * Entry ids of the matches a run kept, its coverage limits and errors, and (owner decision 8 after
 * 6C) the digest of its full created matches.
 * @param {import('./benchmark-postgres.mjs').RunOutcome} outcome
 */
function keptOf(outcome) {
  if (outcome.kind !== 'completed') {
    throw new Error('a screening asked to wait');
  }
  const { result } = outcome;
  return {
    matched: result.matches.map((match) => match.entryKey.slice(match.entryKey.indexOf(':') + 1)),
    limits: [...(result.coverage?.limits ?? [])],
    errors: result.errors.map((error) => error.code),
    digest: matchDigest(result.matches),
  };
}

/** @param {Options} options */
async function screen(options) {
  const started = performance.now();
  const { set, dated, measured } = await heldOut(options);
  const queries = queriesOf(set, dated);
  const done = new Set((await readObservations(options.out)).map((item) => item.key));
  const database = await startBenchmarkPostgres(qualityContainer(options));
  const cache = cachedReads();
  const restore = installScreeningKit({ groups: measured, reads: cache.reads });
  const writer = stepWriter({
    append: (text) => appendFile(observationsPath(options.out), text),
    batch: BATCH,
    budgetMs: STEP_BUDGET_MS,
    started,
  });
  let screened = 0;
  try {
    for (const item of queries) {
      if (done.has(item.key)) {
        continue;
      }
      const job = item.set === 'companies' ? businessWatchlistReportJob : watchlistReportJob;
      const type = item.set === 'companies' ? 'business-watchlist' : 'watchlist';
      /** @type {Observation['presets']} */
      const presets = {};
      for (const preset of PRESETS) {
        presets[preset] = keptOf(
          await screenOnce({
            job,
            db: database.db,
            query: item.query,
            config: screeningConfig(type, preset),
          }),
        );
      }
      cache.clear();
      /** @type {Observation} */
      const observation = {
        key: item.key,
        set: item.set,
        identity: item.identity,
        source: item.source,
        presets,
      };
      screened += 1;
      if (await writer.add(JSON.stringify(observation))) {
        break;
      }
    }
    await writer.flush();
  } finally {
    restore();
    await database.close();
  }
  const total = done.size + screened;
  process.stdout.write(
    `${JSON.stringify({ screened, done: total, of: queries.length, seconds: Math.round((performance.now() - started) / 1000) })}\n`,
  );
  if (total < queries.length) {
    process.stdout.write('incomplete: run --step screen again\n');
    process.exitCode = 3;
  }
}

/**
 * The quality observations of one set and preset; `refine` relabels the own-transliteration
 * cases by the script the entry is listed in.
 * @param {{ observations: Observation[], set: Query['set'], preset: string, identities: string[],
 *   customers: Observation[], listedScript: Map<string, string>, refine: boolean }} input
 * @returns {QualityObservations}
 */
function observationsOf(input) {
  const label = (/** @type {Observation} */ item) =>
    input.refine && item.source === 'own_transliteration'
      ? `own_transliteration/${input.listedScript.get(item.identity ?? '') === 'cyrillic' ? 'cyrillic_listed' : 'latin_listed'}`
      : (item.source ?? '');
  return {
    identities: input.identities,
    cases: input.observations
      .filter((item) => item.set === input.set)
      .map((item) => ({
        id: item.key,
        identity: item.identity ?? '',
        source: label(item),
        matched: item.presets[input.preset]?.matched ?? [],
      })),
    customers: input.customers.map((item) => ({
      id: item.key,
      matched: item.presets[input.preset]?.matched ?? [],
    })),
  };
}

/**
 * Diagnostics of one set and preset: misses that coverage flagged, cut searches, errored runs.
 * @param {Observation[]} items
 * @param {string} preset
 */
function diagnosticsOf(items, preset) {
  let missesFlagged = 0;
  let misses = 0;
  let truncated = 0;
  let errored = 0;
  for (const item of items) {
    const run = item.presets[preset];
    if (run === undefined) {
      continue;
    }
    const hit = item.identity !== null && run.matched.includes(item.identity);
    if (item.identity !== null && !hit) {
      misses += 1;
      missesFlagged += run.limits.length > 0 ? 1 : 0;
    }
    truncated += run.limits.includes('truncated') ? 1 : 0;
    errored += run.errors.length > 0 ? 1 : 0;
  }
  return { misses, missesFlagged, truncated, errored };
}

/** @param {Options} options */
async function report(options) {
  const { set, measured } = await heldOut(options);
  const observations = await readObservations(options.out);
  const expected = queriesOf(set, set).length;
  if (observations.length !== expected) {
    throw new Error(`${String(observations.length)} of ${String(expected)} queries screened`);
  }
  const identities = set.list.entries.map((entry) => entry.entry_id);
  const listedScript = new Map(
    set.list.entries.map((entry) => [entry.entry_id, entry.names[0]?.script ?? 'latin']),
  );
  const customers = observations.filter((item) => item.set === 'customers');
  /** @type {Record<string, unknown>} */
  const sets = {};
  for (const name of /** @type {const} */ (['persons/names', 'persons/birthdates', 'companies'])) {
    /** @type {Record<string, unknown>} */
    const presets = {};
    for (const preset of PRESETS) {
      const base = {
        observations,
        set: name,
        preset,
        identities,
        customers: name === 'companies' ? [] : customers,
        listedScript,
      };
      const plain = observationsOf({ ...base, refine: false });
      const refined = observationsOf({ ...base, refine: true });
      // One bootstrap stream for every set and preset: the same draws, so all are paired.
      const seed = options.seed;
      presets[preset] = {
        point: qualityPoint(plain),
        intervals: bootstrapQuality(plain, { replicates: REPLICATES, seed }),
        refined: {
          point: qualityPoint(refined).recall,
          intervals: bootstrapQuality(refined, { replicates: REPLICATES, seed }).recall,
        },
        diagnostics: diagnosticsOf(
          observations.filter((item) => item.set === name),
          preset,
        ),
        customerDiagnostics: name === 'companies' ? null : diagnosticsOf(customers, preset),
      };
    }
    sets[name] = presets;
  }
  /** @type {Record<string, { cases: number, oneToken: number, bothTokens: number }>} */
  const bridged = {};
  const entries = new Map(set.list.entries.map((entry) => [entry.entry_id, entry]));
  for (const item of set.cases.filter((one) => one.variantSource.startsWith('held_out_group'))) {
    const listed = entries.get(item.expectedEntryId)?.names[0]?.parts ?? [];
    const part = (/** @type {string} */ role) =>
      listed.find((one) => one.role === role)?.value ?? '';
    const given = shareSurvivingGroup(part('given'), String(item.query['name-first']), measured);
    const family = shareSurvivingGroup(part('family'), String(item.query['name-last']), measured);
    const counts = (bridged[item.variantSource] ??= { cases: 0, oneToken: 0, bothTokens: 0 });
    counts.cases += 1;
    counts.oneToken += given || family ? 1 : 0;
    counts.bothTokens += given && family ? 1 : 0;
  }
  const results = {
    seed: options.seed,
    smoke: options.smoke,
    replicates: REPLICATES,
    sets,
    bridged,
  };
  await writeFile(join(options.out, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ written: join(options.out, 'results.json') })}\n`);
}

/** @param {string} path @param {unknown} value */
const writeJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);

/**
 * Owner decision 7: the 6B typo cases by kind, token length and preset. The kind is read back
 * from the listed token and the typed one (persons: the family name; companies: the first word).
 * @param {Options} options
 */
async function typoKinds(options) {
  const { set } = await heldOut(options);
  const observations = new Map(
    (await readObservations(options.out)).map((item) => /** @type {const} */ ([item.key, item])),
  );
  const entries = new Map(set.list.entries.map((entry) => [entry.entry_id, entry]));
  /** @type {import('./benchmark-posthoc.mjs').TypoObservation[]} */
  const items = [];
  for (const item of set.cases.filter((one) => one.variantSource === 'typo')) {
    const listedName = entries.get(item.expectedEntryId)?.names[0];
    const listed =
      item.subject === 'business'
        ? (listedName?.full.split(' ')[0] ?? '')
        : (listedName?.parts.find((part) => part.role === 'family')?.value ?? '');
    const typed =
      item.subject === 'business'
        ? (String(item.query.term ?? '').split(' ')[0] ?? '')
        : String(item.query['name-last'] ?? '');
    const kind = typoEdit(listed, typed)?.kind ?? null;
    const keys =
      item.subject === 'business'
        ? /** @type {const} */ ([['companies', `B:${item.id}`]])
        : /** @type {const} */ ([
            ['persons/names', `N:${item.id}`],
            ['persons/birthdates', `D:${item.id}`],
          ]);
    for (const [subject, key] of keys) {
      const observation = observations.get(key);
      if (observation === undefined) {
        throw new Error('run --step screen to the end first');
      }
      items.push({
        subject,
        kind,
        length: listed.length,
        found: Object.fromEntries(
          PRESETS.map((preset) => [
            preset,
            observation.presets[preset]?.matched.includes(item.expectedEntryId) === true,
          ]),
        ),
      });
    }
  }
  const record = {
    seed: options.seed,
    smoke: options.smoke,
    presets: PRESETS,
    rows: typoKindBreakdown(items, PRESETS),
  };
  await writeJson(join(options.out, 'typo-kinds.json'), record);
  process.stdout.write(`${JSON.stringify({ written: join(options.out, 'typo-kinds.json') })}\n`);
}

/**
 * A scale table as this run uses it.
 * @param {ScaleOptions} options
 */
function scaleTableOf(options) {
  const table = SCALE_TABLES[options.scale];
  return {
    ...table,
    names: options.smoke ? table.smokeNames : table.names,
    container: scaleContainer(options.scale, options),
  };
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
 * The performance tables' law and the held-out population drawn from it (owner decision 5).
 * @param {ScaleOptions} options
 */
async function populationOf(options) {
  const { groups } = await rawGroups();
  // Owner decision 6 after 6C: the performance tables' pool, from the shared module.
  const pool = heavyHeadedPool(options.seed, groups);
  const population = generateScalePopulation({
    seed: options.seed,
    ...(options.smoke ? SCALE_SMOKE_SIZES : SCALE_SIZES),
    law: pool,
    idPrefix: POPULATION_PREFIX,
  });
  return { pool, population };
}

/**
 * The population's listed entries, then the table's own entries up to `names`.
 * @param {ScaleOptions} options
 * @param {Awaited<ReturnType<typeof populationOf>>} drawn
 * @param {number} names
 */
function* embeddedTable(options, drawn, names) {
  const table = scaleTableOf(options);
  yield* drawn.population.entries;
  yield* options.scale === '100k'
    ? heavyHeadedEntries({ seed: options.seed, pool: drawn.pool, names })
    : syntheticEntries({
        seed: `${options.seed}/${options.scale}`,
        pool: drawn.pool,
        names,
        profile: table.profile,
        idPrefix: table.idPrefix,
      });
}

/**
 * Owner decision 5: one sync of part `part` of the population embedded in a performance table.
 * @param {ScaleOptions & { part: number, parts?: number }} options
 */
async function scalePrepare(options) {
  const table = scaleTableOf(options);
  const parts = options.parts ?? table.parts;
  const target = partTarget(table.names, options.part, parts);
  const directory = join(options.out, `scale-${options.scale}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const started = performance.now();
  const drawn = await populationOf(options);
  const path = join(directory, `list-${String(options.part)}.json`);
  const written = await writeNormalisedImport(path, {
    source: BENCHMARK_SOURCE,
    publishedAt: new Date(PUBLISHED_BASE + options.part * 60_000).toISOString(),
    records: embeddedTable(options, drawn, target),
  });
  const generatedSeconds = Math.round((performance.now() - started) / 100) / 10;
  const database = await startBenchmarkPostgres(table.container);
  try {
    const syncStarted = performance.now();
    const sync = await importList({ ...database, groups: shippedGroups(), path });
    const syncSeconds = Math.round((performance.now() - syncStarted) / 100) / 10;
    if (sync.outcome !== 'applied' && sync.outcome !== 'unchanged') {
      throw new Error(`the table did not apply: ${sync.outcome}`);
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
        removed: sync.removed,
      },
      generatedSeconds,
      syncSeconds,
      loadAverage: loadavg(),
    };
    await writeJson(join(directory, `import-${String(options.part)}.json`), record);
    if (options.part === parts) {
      await vacuumAnalyse(database.pool);
      const found = indistinguishableCustomers(
        drawn.population.customers,
        embeddedTable(options, drawn, table.names),
      );
      await writeJson(join(directory, 'indistinguishable.json'), { customers: [...found] });
      const { population } = drawn;
      await writeJson(join(directory, 'prepare.json'), {
        seed: options.seed,
        smoke: options.smoke,
        scale: options.scale,
        names: table.names,
        parts,
        sizes: options.smoke ? SCALE_SMOKE_SIZES : SCALE_SIZES,
        population: {
          entries: population.entries.length,
          cases: population.cases.length,
          customers: population.customers.length,
          identities: population.entries.map((entry) => entry.entry_id),
        },
        indistinguishable: found.size,
        database: await databaseFacts(database.pool),
      });
    }
    process.stdout.write(`${JSON.stringify(record)}\n`);
  } finally {
    await database.close();
    await rm(path, { force: true });
  }
}

/**
 * Owner decision 5: screens the population's cases and the customers against the table at each
 * fixed preset; each run's kept entries split into the population and the table's own.
 * @param {ScaleOptions} options
 */
async function scaleScreen(options) {
  const started = performance.now();
  const table = scaleTableOf(options);
  const directory = join(options.out, `scale-${options.scale}`);
  await readFile(join(directory, 'prepare.json'), 'utf8').catch(() => {
    throw new Error('run --step scale-prepare to its last part first');
  });
  const { population } = await populationOf(options);
  const queries = [
    ...population.cases.map((item) => ({
      key: item.id,
      set: item.subject === 'person' ? 'persons' : 'companies',
      identity: item.expectedEntryId,
      source: /** @type {string | null} */ (item.variantSource),
      business: item.subject === 'business',
      query: item.query,
    })),
    ...population.customers.map((customer) => ({
      key: customer.id,
      set: customer.subject === 'person' ? 'customers' : 'business-customers',
      identity: /** @type {string | null} */ (null),
      source: /** @type {string | null} */ (null),
      business: customer.subject === 'business',
      query: customer.query,
    })),
  ];
  const done = new Set((await readObservations(directory)).map((item) => item.key));
  const database = await startBenchmarkPostgres(table.container);
  const cache = cachedReads();
  const restore = installScreeningKit({ groups: shippedGroups(), reads: cache.reads });
  const writer = stepWriter({
    append: (text) => appendFile(observationsPath(directory), text),
    batch: BATCH,
    budgetMs: STEP_BUDGET_MS,
    started,
  });
  let screened = 0;
  try {
    for (const item of queries) {
      if (done.has(item.key)) {
        continue;
      }
      const job = item.business ? businessWatchlistReportJob : watchlistReportJob;
      const type = item.business ? 'business-watchlist' : 'watchlist';
      /** @type {Record<string, { matched: string[], fixed: number, limits: string[], errors: string[], digest: string }>} */
      const presets = {};
      for (const preset of PRESETS) {
        const kept = keptOf(
          await screenOnce({
            job,
            db: database.db,
            query: item.query,
            config: screeningConfig(type, preset),
          }),
        );
        presets[preset] = {
          ...splitMatches(kept.matched, POPULATION_PREFIX),
          limits: kept.limits,
          errors: kept.errors,
          digest: kept.digest,
        };
      }
      cache.clear();
      screened += 1;
      const line = JSON.stringify({
        key: item.key,
        set: item.set,
        identity: item.identity,
        source: item.source,
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
  const total = done.size + screened;
  process.stdout.write(
    `${JSON.stringify({ scale: options.scale, screened, done: total, of: queries.length, seconds: Math.round((performance.now() - started) / 1000) })}\n`,
  );
  if (total < queries.length) {
    process.stdout.write('incomplete: run --step scale-screen again\n');
    process.exitCode = 3;
  }
}

/** The scale sets and the observation sets they read. */
const SCALE_SETS = Object.freeze(
  /** @type {const} */ ([
    ['persons', { cases: 'persons', customers: 'customers' }],
    ['companies', { cases: 'companies', customers: 'business-customers' }],
  ]),
);

/**
 * What a scale's observations need beside them: the population's identities and the
 * indistinguishable customers.
 * @param {string} directory
 */
async function scaleContext(directory) {
  const prepared = JSON.parse(await readFile(join(directory, 'prepare.json'), 'utf8'));
  const indistinguishable = JSON.parse(
    await readFile(join(directory, 'indistinguishable.json'), 'utf8'),
  );
  return {
    prepared,
    /** @type {string[]} */
    identities: prepared.population.identities,
    excluded: new Set(
      /** @type {[string, string][]} */ (indistinguishable.customers).map(([id]) => id),
    ),
  };
}

/**
 * Owner decision 5: recall, precision and false alerts per 1,000 of a scale, per set and preset.
 * @param {ScaleOptions} options
 */
async function scaleReport(options) {
  const directory = join(options.out, `scale-${options.scale}`);
  const { prepared, identities, excluded } = await scaleContext(directory);
  const observations = await readObservations(directory);
  const expected = prepared.population.cases + prepared.population.customers;
  if (observations.length !== expected) {
    throw new Error(`${String(observations.length)} of ${String(expected)} queries screened`);
  }
  const sets = Object.fromEntries(
    SCALE_SETS.map(([name, spec]) => [
      name,
      setResults(observations, {
        ...spec,
        presets: PRESETS,
        identities,
        excluded,
        replicates: REPLICATES,
        seed: options.seed,
        label: `evaluation-6c/bootstrap/${options.seed}/scale-${options.scale}/${name}`,
      }),
    ]),
  );
  const results = {
    seed: options.seed,
    smoke: options.smoke,
    scale: options.scale,
    names: prepared.names,
    replicates: REPLICATES,
    sizes: prepared.sizes,
    indistinguishable: excluded.size,
    sets,
  };
  await writeJson(join(directory, 'results.json'), results);
  process.stdout.write(`${JSON.stringify({ written: join(directory, 'results.json') })}\n`);
}

/**
 * Head's observations in base's order, refused unless both screened the same queries.
 * @param {Observation[]} base
 * @param {Observation[]} head
 */
function aligned(base, head) {
  const byKey = new Map(head.map((item) => [item.key, item]));
  if (byKey.size !== base.length || base.some((item) => !byKey.has(item.key))) {
    throw new Error('the base and head runs did not screen the same queries');
  }
  return base.map((item) => /** @type {Observation} */ (byKey.get(item.key)));
}

/** @param {unknown} left @param {unknown} right */
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

/**
 * Workflow 6C: base and head on one seed, every set they both measured, on the same draws.
 * @param {{ seed: string, base: string, head: string, out: string }} options
 */
async function compare(options) {
  /** @type {{ key: string, title: string, presets: unknown }[]} */
  const sets = [];
  const [base, head] = await Promise.all([
    readObservations(options.base),
    readObservations(options.head),
  ]);
  if (base.length > 0 && head.length > 0) {
    const list = async (/** @type {string} */ dir) =>
      /** @type {{ entries: { entry_id: string }[] }} */ (
        JSON.parse(await readFile(join(dir, 'list.json'), 'utf8'))
      ).entries.map((entry) => entry.entry_id);
    const identities = await list(options.base);
    if (!same(identities, await list(options.head))) {
      throw new Error('the base and head runs did not hold the same held-out list');
    }
    const headInOrder = aligned(base, head);
    for (const [key, title, spec] of /** @type {const} */ ([
      [
        '6b/persons/names',
        '6B set, persons, names only',
        { cases: 'persons/names', customers: 'customers' },
      ],
      [
        '6b/persons/birthdates',
        '6B set, persons, with the listed birth date',
        { cases: 'persons/birthdates', customers: 'customers' },
      ],
      ['6b/companies', '6B set, companies', { cases: 'companies', customers: null }],
    ])) {
      sets.push({
        key,
        title,
        presets: compareSet(base, headInOrder, {
          ...spec,
          presets: PRESETS,
          identities,
          replicates: REPLICATES,
          seed: options.seed,
        }),
      });
    }
  }
  for (const [scale, label] of /** @type {const} */ ([
    ['100k', '100,000'],
    ['2m', '2,000,000'],
  ])) {
    const baseDir = join(options.base, `scale-${scale}`);
    const headDir = join(options.head, `scale-${scale}`);
    const [baseObservations, headObservations] = await Promise.all([
      readObservations(baseDir),
      readObservations(headDir),
    ]);
    if (baseObservations.length === 0 || headObservations.length === 0) {
      continue;
    }
    const baseContext = await scaleContext(baseDir);
    const headContext = await scaleContext(headDir);
    if (
      !same(baseContext.identities, headContext.identities) ||
      !same([...baseContext.excluded], [...headContext.excluded])
    ) {
      throw new Error(`the base and head runs did not hold the same population at ${scale}`);
    }
    const headInOrder = aligned(baseObservations, headObservations);
    for (const [name, spec] of SCALE_SETS) {
      sets.push({
        key: `scale-${scale}/${name}`,
        title: `held-out population, ${label} names, ${name}`,
        presets: compareSet(baseObservations, headInOrder, {
          ...spec,
          presets: PRESETS,
          identities: baseContext.identities,
          excluded: baseContext.excluded,
          replicates: REPLICATES,
          seed: options.seed,
          label: `evaluation-6c/bootstrap/${options.seed}/scale-${scale}/${name}`,
        }),
      });
    }
  }
  if (sets.length === 0) {
    throw new Error('the base and head directories hold no observations to compare');
  }
  await mkdir(options.out, { recursive: true, mode: 0o700 });
  await writeJson(join(options.out, 'compare.json'), {
    seed: options.seed,
    base: options.base,
    head: options.head,
    replicates: REPLICATES,
    sets,
  });
  process.stdout.write(
    `${JSON.stringify({ written: join(options.out, 'compare.json'), sets: sets.length })}\n`,
  );
}

/**
 * Owner decision 8 after Workflow 6C: base and head of one seed, keyed by query and preset (the
 * kept ids, `fixed`, `limits`, `errors` and the digest of the full created matches), for the 6B
 * set and each scale set both runs screened. Written to `<out>/quality-identity.json`.
 * @param {{ base: string, head: string, out: string }} options
 */
async function identity(options) {
  /** @type {Record<string, import('./benchmark-scale.mjs').IdentityResult>} */
  const sets = {};
  for (const [name, directory] of /** @type {const} */ ([
    ['6b', ''],
    ['scale-100k', 'scale-100k'],
    ['scale-2m', 'scale-2m'],
  ])) {
    const [base, head] = await Promise.all([
      readObservations(join(options.base, directory)),
      readObservations(join(options.head, directory)),
    ]);
    if (base.length > 0 || head.length > 0) {
      sets[name] = identityCheck(base, head);
    }
  }
  const record = {
    base: options.base,
    head: options.head,
    sets,
    same: Object.keys(sets).length > 0 && Object.values(sets).every((set) => set.same),
  };
  await mkdir(options.out, { recursive: true, mode: 0o700 });
  await writeJson(join(options.out, 'quality-identity.json'), record);
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      seed: { type: 'string' },
      build: { type: 'string' },
      out: { type: 'string', default: '/tmp/openverify-eval-6/quality' },
      step: { type: 'string', default: 'prepare' },
      smoke: { type: 'boolean', default: false },
      namespace: { type: 'string' },
      scale: { type: 'string' },
      part: { type: 'string' },
      parts: { type: 'string' },
      base: { type: 'string' },
      head: { type: 'string' },
    },
  });
  const naming = { smoke: values.smoke, namespace: values.namespace };
  const scale = values.scale;
  const scaleStep = values.step.startsWith('scale-');
  if (scaleStep && scale !== '100k' && scale !== '2m') {
    throw new Error('--scale is 100k or 2m');
  }
  if (values.step === 'teardown') {
    await stopBenchmarkPostgres(qualityContainer(naming));
    return;
  }
  if (values.step === 'scale-teardown') {
    await stopBenchmarkPostgres(scaleContainer(/** @type {ScaleName} */ (scale), naming));
    return;
  }
  if (values.step === 'identity') {
    if (values.base === undefined || values.head === undefined) {
      throw new Error('--step identity takes --base and --head (two quality output directories)');
    }
    await identity({ base: values.base, head: values.head, out: values.out });
    return;
  }
  if (values.seed === undefined || !/^[0-9a-f]{32}$/u.test(values.seed)) {
    throw new Error('--seed takes the 32 hexadecimal digits of openssl rand -hex 16');
  }
  if (values.step === 'compare') {
    if (values.base === undefined || values.head === undefined) {
      throw new Error('--step compare takes --base and --head (two quality output directories)');
    }
    await compare({ seed: values.seed, base: values.base, head: values.head, out: values.out });
    return;
  }
  if (scaleStep) {
    /** @type {ScaleOptions} */
    const options = {
      seed: values.seed,
      out: values.out,
      ...naming,
      scale: /** @type {ScaleName} */ (scale),
    };
    await mkdir(options.out, { recursive: true, mode: 0o700 });
    if (values.step === 'scale-prepare') {
      await scalePrepare({
        ...options,
        part: values.part === undefined ? 1 : Number(values.part),
        ...(values.parts === undefined ? {} : { parts: Number(values.parts) }),
      });
    } else if (values.step === 'scale-screen') {
      await scaleScreen(options);
    } else if (values.step === 'scale-report') {
      await scaleReport(options);
    } else {
      throw new Error(
        'the scale steps are scale-prepare, scale-screen, scale-report and scale-teardown',
      );
    }
    return;
  }
  if (values.build === undefined) {
    throw new Error('--build names the held-out variant-group build');
  }
  /** @type {Options} */
  const options = {
    seed: values.seed,
    build: values.build,
    out: values.out,
    ...naming,
  };
  await mkdir(options.out, { recursive: true, mode: 0o700 });
  switch (values.step) {
    case 'prepare':
      await prepare(options);
      break;
    case 'screen':
      await screen(options);
      break;
    case 'report':
      await report(options);
      break;
    case 'typo-kinds':
      await typoKinds(options);
      break;
    default:
      throw new Error(
        '--step is prepare, screen, report, typo-kinds, teardown, compare or a scale step',
      );
  }
}

await main();

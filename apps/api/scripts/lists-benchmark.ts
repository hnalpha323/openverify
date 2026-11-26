/**
 * Workflow 7B's list calibrations (the method's items (h) and the cold face list; Workflow 11D
 * load-harness, rebuilt from the C99.2 benchmark text in `docs/tdd/phase7-api-lists.tdd.md`): a
 * development benchmark like graph:benchmark, never compiled or shipped
 * (`UNLISTED_DEVELOPMENT_SCRIPTS` in `src/commands-build.test.ts`), on a Testcontainers Postgres of
 * its own (`openverify.benchmark=lists`, reused between calls), one step per call:
 *
 *   pnpm --filter @openverify/api exec tsx --conditions=@openverify/source scripts/lists-benchmark.ts \
 *     --seed [--items 1000000] [--table-seed <text>]      # resumable: each call stops after 7 minutes
 *     --measure [--probes 300] [--cap <n>]                # --cap overrides fuzzy-name-candidate-cap, for this take only
 *     --cold-list [--faces 80000]                         # a full face list, sealed; the open timed on an empty cache
 *     --teardown                                          # removes the container
 *
 * The fuzzy list is heavy-headed: names from `@openverify/watchlist/testing`'s generators on a Zipf
 * law (50,000 family names, 5,000 given names), every item with its unique exact key and its
 * last-name candidate keys, as C99.2 measured it. Each call prints one JSON object with the 1-minute
 * load average at its start and end. The scratch keys (the blind-index key and the KEK of this
 * container) live in its own state table; nothing is printed but counts and times.
 */
import { randomBytes } from 'node:crypto';
import { loadavg } from 'node:os';
import { pathToFileURL } from 'node:url';
import { newId } from '@openverify/contracts';
import {
  createDatabase,
  createKeyring,
  createList,
  encodeFaceTemplate,
  getList,
  identifierKey,
  listListFaceTemplates,
  listListItemHealth,
  runMigrations,
  SEALED,
  sealJson,
  sealValue,
  setDefaultKeyring,
  decodeFaceTemplate,
  type Db,
} from '@openverify/db';
import {
  createIntegrationPool,
  createTestInquiry,
  createTestTenant,
  startIntegrationPostgres,
} from '@openverify/db/testing';
import { listLastNameKeyInputs, listNameKeyInputs } from '@openverify/watchlist';
import {
  fictionalFamilyName,
  fictionalGivenName,
  seededRandom,
  zipfSampler,
} from '@openverify/watchlist/testing';
import { sql } from 'drizzle-orm';
import { createBiometricCache } from '../src/services/lists/biometric/cache.js';
import { matchLists } from '../src/services/lists/match.js';
import { loadMatcherData } from '../src/watchlists/matcher-data.js';

export const LISTS_BENCHMARK_STEPS = ['--seed', '--measure', '--cold-list', '--teardown'] as const;
export type ListsBenchmarkStep = (typeof LISTS_BENCHMARK_STEPS)[number];

export interface ListsBenchmarkArgs {
  step: ListsBenchmarkStep;
  items: number;
  probes: number;
  /** `--cap`: the fuzzy candidate cap of this take; absent, the shipped constant. */
  cap?: number | undefined;
  faces: number;
  tableSeed: string;
}

export const LISTS_BENCHMARK_DEFAULTS = Object.freeze({
  items: 1_000_000,
  probes: 300,
  faces: 80_000,
  tableSeed: 'lists-phase11',
});

const USAGE =
  'usage: lists-benchmark.ts --seed [--items n] [--table-seed s] | --measure [--probes n] [--cap n] | --cold-list [--faces n] | --teardown';

export class ListsBenchmarkUsageError extends Error {
  override name = 'ListsBenchmarkUsageError';
}

function whole(flag: string, value: string | undefined, min: number, max: number): number {
  const parsed = Number(value);
  if (value === undefined || !Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ListsBenchmarkUsageError(
      `${flag} is a whole number from ${String(min)} to ${String(max)}. ${USAGE}`,
    );
  }
  return parsed;
}

export function parseListsBenchmarkArgs(argv: readonly string[]): ListsBenchmarkArgs {
  const steps = argv.filter((arg) => (LISTS_BENCHMARK_STEPS as readonly string[]).includes(arg));
  if (steps.length !== 1) {
    throw new ListsBenchmarkUsageError(`one step a call. ${USAGE}`);
  }
  const args: ListsBenchmarkArgs = {
    step: steps[0] as ListsBenchmarkStep,
    items: LISTS_BENCHMARK_DEFAULTS.items,
    probes: LISTS_BENCHMARK_DEFAULTS.probes,
    faces: LISTS_BENCHMARK_DEFAULTS.faces,
    tableSeed: LISTS_BENCHMARK_DEFAULTS.tableSeed,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if ((LISTS_BENCHMARK_STEPS as readonly string[]).includes(arg)) {
      continue;
    }
    const value = argv[(i += 1)];
    switch (arg) {
      case '--items':
        args.items = whole(arg, value, 100, 5_000_000);
        break;
      case '--probes':
        args.probes = whole(arg, value, 1, 10_000);
        break;
      case '--cap':
        args.cap = whole(arg, value, 1, 1_000_000);
        break;
      case '--faces':
        args.faces = whole(arg, value, 1, 1_000_000);
        break;
      case '--table-seed':
        if (value === undefined || !/^[\w-]{1,64}$/u.test(value)) {
          throw new ListsBenchmarkUsageError(`--table-seed is 1 to 64 letters or digits. ${USAGE}`);
        }
        args.tableSeed = value;
        break;
      default:
        throw new ListsBenchmarkUsageError(`Unknown argument ${arg}. ${USAGE}`);
    }
  }
  return args;
}

/** The nearest-rank quantile of `values` (0 when empty). */
export function quantile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] ?? 0;
}

/** A batch column as one parameter: `|` never occurs in an id, a key or a sealed value. */
const rows = async <Row>(db: Db, query: ReturnType<typeof sql>): Promise<Row[]> => {
  const result: unknown = await db.execute(query);
  return (result as { rows: Row[] }).rows;
};

/** The benchmark's state: its environment, its lists and the scratch keys of this database. */
export interface ListsBenchmarkState {
  environmentId: string;
  nameListId: string;
  faceListId: string | null;
  key: Uint8Array;
}

/** The state, created on the first call (a tenant, the fuzzy name list, the scratch keys). */
export async function benchmarkState(db: Db): Promise<ListsBenchmarkState> {
  await db.execute(sql`create table if not exists lists_benchmark_state (environment_id text,
    name_list_id text, face_list_id text, key text, kek text)`);
  let [state] = await rows<{
    environment_id: string;
    name_list_id: string;
    face_list_id: string | null;
    key: string;
    kek: string;
  }>(db, sql`select * from lists_benchmark_state limit 1`);
  if (state === undefined) {
    const kek = randomBytes(32);
    setDefaultKeyring(createKeyring(kek));
    const environmentId = (await createTestTenant(db)).environment.id;
    const list = await createList(db, environmentId, {
      id: newId('lst'),
      type: 'name',
      name: 'Lists benchmark',
      allowFuzzyNameFirst: true,
    });
    await db.execute(sql`insert into lists_benchmark_state values (${environmentId}, ${list.id},
      null, ${randomBytes(32).toString('hex')}, ${kek.toString('hex')})`);
    [state] = await rows(db, sql`select * from lists_benchmark_state limit 1`);
  }
  if (state === undefined) {
    throw new Error('the lists benchmark state was not written');
  }
  setDefaultKeyring(createKeyring(Buffer.from(state.kek, 'hex')));
  return {
    environmentId: state.environment_id,
    nameListId: state.name_list_id,
    faceListId: state.face_list_id,
    key: new Uint8Array(Buffer.from(state.key, 'hex')),
  };
}

/** The heavy-headed name law of C99.2: 50,000 family and 5,000 given names on a Zipf law. */
export function nameLaw(
  seed: string,
  stream: 'items' | 'probes',
): () => { 'name-first': string; 'name-last': string } {
  // One pool of names for the list and its probes; each draws from its own stream over it.
  const pools = seededRandom(`${seed}/pools`);
  const families = Array.from({ length: 50_000 }, () => fictionalFamilyName(pools));
  const givens = Array.from({ length: 5000 }, () => fictionalGivenName(pools));
  const random = seededRandom(`${seed}/${stream}`);
  const family = zipfSampler(families.length);
  const given = zipfSampler(givens.length);
  return () => ({
    'name-first': givens[given(random)]?.latin ?? 'Alpha',
    'name-last': families[family(random)]?.latin ?? 'Beta',
  });
}

const BATCH = 20_000;
/** A seed call stops starting batches after this long, so it fits one ten-minute call. */
const SEED_BUDGET_MS = 420_000;

/** Seeds the fuzzy list up to `items`, resuming where an earlier call stopped. */
export async function seedFuzzyList(
  db: Db,
  state: ListsBenchmarkState,
  options: { items: number; tableSeed: string; budgetMs?: number },
): Promise<{ items: number; written: number; complete: boolean }> {
  const started = performance.now();
  const [count] = await rows<{ n: number }>(
    db,
    sql`select count(*)::int as n from list_items where list_id = ${state.nameListId}`,
  );
  const have = count?.n ?? 0;
  const next = nameLaw(options.tableSeed, 'items');
  for (let skip = 0; skip < have; skip += 1) next();
  let written = 0;
  for (let start = have; start < options.items; start += BATCH) {
    if (performance.now() - started > (options.budgetMs ?? SEED_BUDGET_MS)) {
      return { items: have + written, written, complete: false };
    }
    const end = Math.min(options.items, start + BATCH);
    const ids: string[] = [];
    const values: string[] = [];
    const keys: string[] = [];
    const lastIds: string[] = [];
    const lastKeys: string[] = [];
    for (let n = start; n < end; n += 1) {
      const id = `lin_${String(n).padStart(26, 'A')}`;
      const name = next();
      const [first] = listNameKeyInputs(name);
      if (first === undefined) {
        continue;
      }
      ids.push(id);
      values.push(sealJson(SEALED.listItemValue, id, name));
      // The bench salts each exact key with the row, so the exact key never answers (C99.2).
      keys.push(
        identifierKey(state.key, {
          environmentId: state.environmentId,
          kind: first.keyKind,
          input: `${first.input}|${String(n)}`,
        }),
      );
      for (const input of listLastNameKeyInputs(name)) {
        lastIds.push(id);
        lastKeys.push(
          identifierKey(state.key, {
            environmentId: state.environmentId,
            kind: input.keyKind,
            input: input.input,
          }),
        );
      }
    }
    await db.execute(sql`insert into list_items (id, environment_id, list_id, value, match_key, normaliser_version)
      select unnest(string_to_array(${ids.join('|')}, '|')), ${state.environmentId}, ${state.nameListId}, unnest(string_to_array(${values.join('|')}, '|')),
        unnest(string_to_array(${keys.join('|')}, '|')), 'lists-1'`);
    await db.execute(sql`insert into list_item_keys (environment_id, item_id, key_kind, match_key)
      select ${state.environmentId}, unnest(string_to_array(${lastIds.join('|')}, '|')), 'identifier-name-last', unnest(string_to_array(${lastKeys.join('|')}, '|'))
      on conflict do nothing`);
    written += ids.length;
  }
  await db.execute(sql`update lists set item_count = (select count(*) from list_items where list_id = ${state.nameListId}),
    version = version + 1 where id = ${state.nameListId}`);
  await db.execute(sql`analyze list_items`);
  await db.execute(sql`analyze list_item_keys`);
  return { items: have + written, written, complete: true };
}

export interface ListsMeasure {
  items: number;
  probes: number;
  cap: number | null;
  healthMs: { p50: number; p95: number };
  probeMs: { p50: number; p95: number; max: number };
  limitExceeded: number;
  fuzzyMatches: number;
  lastNamesOverCap: number;
}

/** C99.2's measurement: the list's health ten times, then `probes` probes from the same law. */
export async function measureFuzzyList(
  db: Db,
  state: ListsBenchmarkState,
  options: { probes: number; cap?: number | undefined; tableSeed: string },
): Promise<ListsMeasure> {
  const list = await getList(db, state.environmentId, state.nameListId);
  const matcherData = loadMatcherData();
  if (list === null || matcherData.status !== 'loaded') {
    throw new Error(
      'the list or the variant groups are missing (run --seed and build:variant-groups)',
    );
  }
  const health: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    const at = performance.now();
    await listListItemHealth(db, state.environmentId, [list.id], {
      normaliserVersion: 'lists-1',
      keyId: null,
    });
    health.push(performance.now() - at);
  }
  const next = nameLaw(options.tableSeed, 'probes');
  const times: number[] = [];
  let limitExceeded = 0;
  let fuzzyMatches = 0;
  for (let i = 0; i < options.probes; i += 1) {
    const name = next();
    const at = performance.now();
    const outcome = await matchLists(
      db,
      state.environmentId,
      [{ source: 'request', kind: 'name', values: [name] }],
      {
        key: state.key,
        lists: [list],
        matcherData,
        ...(options.cap === undefined ? {} : { fuzzyCandidateCap: options.cap }),
      },
    );
    times.push(performance.now() - at);
    if (outcome.unscreened.some(({ reason }) => reason === 'limit_exceeded')) limitExceeded += 1;
    fuzzyMatches += outcome.matches.length;
  }
  const cap = options.cap ?? 2000;
  const [over] = await rows<{ n: number }>(
    db,
    sql`select count(*)::int as n from (select match_key from list_item_keys where environment_id = ${state.environmentId}
      group by match_key having count(*) > ${cap}) t`,
  );
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    items: list.itemCount,
    probes: options.probes,
    cap: options.cap ?? null,
    healthMs: { p50: round(quantile(health, 0.5)), p95: round(quantile(health, 0.95)) },
    probeMs: {
      p50: round(quantile(times, 0.5)),
      p95: round(quantile(times, 0.95)),
      max: round(Math.max(...times, 0)),
    },
    limitExceeded,
    fuzzyMatches,
    lastNamesOverCap: over?.n ?? 0,
  };
}

/** C99.7's cache bound and a face template's width (SFace's 128 dimensions). */
const CACHE_BYTES = 64 * 1024 * 1024;
const FACE_DIMENSIONS = 128;

/** The cold face list: `faces` sealed templates in one face list (written once), then its open
 * timed on an empty worker cache: the read, every template unsealed and decoded, the cache's set. */
export async function coldFaceList(
  db: Db,
  state: ListsBenchmarkState,
  options: { faces: number; tableSeed: string },
): Promise<{ faces: number; openMs: number; cpuMs: number; cacheBytes: number; held: boolean }> {
  let listId = state.faceListId;
  if (listId === null) {
    const list = await createList(db, state.environmentId, {
      id: newId('lst'),
      type: 'face',
      name: 'Lists benchmark faces',
      itemRetentionDays: 30,
    });
    listId = list.id;
    // Every face item names the inquiry it came from: one synthetic inquiry stands for all.
    const { inquiry } = await createTestInquiry(db, state.environmentId);
    const random = seededRandom(`${options.tableSeed}/faces`);
    for (let start = 0; start < options.faces; start += 5000) {
      const end = Math.min(options.faces, start + 5000);
      const ids: string[] = [];
      const templates: string[] = [];
      for (let n = start; n < end; n += 1) {
        const id = `lifc_${String(n).padStart(26, 'A')}`;
        ids.push(id);
        const vector = Array.from({ length: FACE_DIMENSIONS }, () => random.next() * 2 - 1);
        templates.push(sealValue(SEALED.listItemFaceTemplate, id, encodeFaceTemplate(vector)));
      }
      await db.execute(sql`insert into list_items (id, environment_id, list_id, normaliser_version, status)
        select unnest(string_to_array(${ids.join('|')}, '|')), ${state.environmentId}, ${listId}, 'lists-1', 'active'`);
      await db.execute(sql`insert into list_item_faces (environment_id, item_id, template, model, source_inquiry_id)
        select ${state.environmentId}, unnest(string_to_array(${ids.join('|')}, '|')), unnest(string_to_array(${templates.join('|')}, '|')), 'sface-synthetic',
          ${inquiry.id}`);
    }
    await db.execute(sql`update lists_benchmark_state set face_list_id = ${listId}`);
  }
  const cache = createBiometricCache({
    maxBytes: CACHE_BYTES,
    idleMs: 600_000,
    clock: { now: () => new Date() },
  });
  const wall = performance.now();
  const cpu = process.cpuUsage();
  const rowsOpened = await listListFaceTemplates(db, state.environmentId, listId);
  const gallery = rowsOpened.map(({ itemId, model, template }) => ({
    itemId,
    model,
    vector: Float32Array.from(decodeFaceTemplate(template)),
  }));
  const held = cache.set(listId, 1, gallery);
  const used = process.cpuUsage(cpu);
  return {
    faces: gallery.length,
    openMs: Math.round((performance.now() - wall) * 10) / 10,
    cpuMs: Math.round((used.user + used.system) / 100) / 10,
    cacheBytes: cache.stats().bytes,
    held,
  };
}

const LABEL = 'openverify.benchmark';

function container() {
  return startIntegrationPostgres({
    configure: (built) => built.withLabels({ [LABEL]: 'lists' }).withReuse(),
  });
}

const load = () => loadavg()[0] ?? 0;

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  out: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): Promise<void> {
  const args = parseListsBenchmarkArgs(argv);
  const started = container();
  const postgres = await started;
  if (args.step === '--teardown') {
    await postgres.stop({ remove: true });
    out(JSON.stringify({ step: args.step, removed: true }));
    return;
  }
  const pool = createIntegrationPool(postgres.getConnectionUri(), { max: 4 });
  const loadStart = load();
  try {
    const db = createDatabase(pool);
    await runMigrations(db);
    const state = await benchmarkState(db);
    const result =
      args.step === '--seed'
        ? await seedFuzzyList(db, state, args)
        : args.step === '--measure'
          ? await measureFuzzyList(db, state, args)
          : await coldFaceList(db, state, args);
    out(JSON.stringify({ step: args.step, ...result, loadStart, loadEnd: load() }));
  } finally {
    setDefaultKeyring(undefined);
    await pool.end();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

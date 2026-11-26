/**
 * Owner decision 6 after Workflow 6C: the one definition of C78.7's heavy-headed list tables, and
 * of the 100,000-name table above all, which the C78.7 gate
 * (`apps/api/src/watchlists/watchlists.integration.test.ts`) and the performance benchmark
 * (`scripts/benchmark-performance.mjs`, through `scripts/benchmark-tables.mjs`) both draw. Generated
 * at run time from a seed and never committed; nothing here prints a name.
 *
 * - **The pool** holds the single-word forms of rigour's variant groups (`person_names.txt`, read by
 *   {@link parseRigourPersonNames}, never by the held-out generator) that have a Latin form, with
 *   their other-script forms, and fictional names with their own Cyrillic and Arabic renderings.
 * - **The law** is Zipf's (exponent 1 by default) over the pool, its ranks shuffled by the seed, once
 *   for given names and once for family names: a few names are very common and most are rare. Real
 *   name frequencies are heavy-headed; the exponent is an assumption the calibration states, not a
 *   measurement of any real list.
 * - **The entries** combine names at random, so no entry is a real person. Two profiles:
 *   sanctions-like (about 1.65 names an entry, mostly Latin) and PEP-like (about 5, in several
 *   scripts). Aliases are a weak single token, the name in another script, or a Latin variant.
 * - **The subjects** are listed entries spread over the table (the primary name's parts and the
 *   birth date) and unlisted names drawn from the same law with random birth dates.
 *
 * The draws, their order and every member's order are the benchmark's as `calibration-6c` measured
 * with them, so its golden digests (`scripts/benchmark-golden.test.mjs`, pinned at `94ab63f9`) hold
 * for this module too. A change to any output here changes every table built from it.
 */
import { writingSystemsOf, type WritingSystem } from '@openverify/checks';
import type { WatchlistRecord } from '../record/index.js';
import { fictionalFamilyName, fictionalGivenName } from './names.js';
import { seededRandom, type SeededRandom } from './random.js';
import { SYNTHETIC_COUNTRIES } from './records.js';

type WatchlistName = WatchlistRecord['names'][number];
type Role = 'given' | 'middle' | 'family';

/** One group of rigour's `person_names.txt` (`form, form, … => id`): its id and its forms. */
export interface RigourPersonNameGroup {
  /** The text after the last ` => `: a Wikidata QID, or rigour's `X…` for a manual group. */
  readonly id: string;
  readonly forms: readonly string[];
}

/** The `data/manifest.json` entry of rigour's `person_names.txt`. */
export const RIGOUR_PERSON_NAMES_ENTRY = 'rigour_person_names';

/**
 * Parses rigour's `person_names.txt`: one group per line, its comma-separated forms before the
 * last ` => ` and its id after it, each trimmed. A line without ` => `, without an id or without a
 * form is skipped, as is a blank line.
 */
export function parseRigourPersonNames(text: string): RigourPersonNameGroup[] {
  const groups: RigourPersonNameGroup[] = [];
  for (const line of text.split('\n')) {
    const arrow = line.lastIndexOf(' => ');
    if (arrow < 0) {
      continue;
    }
    const id = line.slice(arrow + ' => '.length).trim();
    const forms = line
      .slice(0, arrow)
      .split(',')
      .map((form) => form.trim())
      .filter((form) => form !== '');
    if (id !== '' && forms.length > 0) {
      groups.push({ id, forms });
    }
  }
  return groups;
}

/** How a table profile writes its entries. */
export interface TableProfile {
  /** Alias counts and their shares. */
  readonly aliases: readonly (readonly [number, number])[];
  /** The share of primary names with a middle name. */
  readonly middleShare: number;
  /** The share of aliases that are weak single tokens. */
  readonly weakShare: number;
  /** The share of the other aliases written in another script. */
  readonly scriptShare: number;
  /** The share of entries with a birth date. */
  readonly birthDateShare: number;
}

/** About 1.65 names an entry, mostly Latin, as sanctions lists. */
const SANCTIONS_PROFILE = Object.freeze<TableProfile>({
  aliases: [
    [0, 0.55],
    [1, 0.3],
    [2, 0.1],
    [3, 0.05],
  ],
  middleShare: 0.3,
  weakShare: 0.1,
  scriptShare: 0.4,
  birthDateShare: 0.85,
});

/** About 5 names an entry in several scripts, as a PEP mirror's labels and aliases. */
const PEP_PROFILE = Object.freeze<TableProfile>({
  aliases: [
    [2, 0.15],
    [3, 0.25],
    [4, 0.3],
    [5, 0.2],
    [6, 0.1],
  ],
  middleShare: 0.2,
  weakShare: 0.15,
  scriptShare: 0.6,
  birthDateShare: 0.6,
});

/** The two profiles of C78.7's tables. */
export const TABLE_PROFILES: Readonly<{ sanctions: TableProfile; pep: TableProfile }> =
  Object.freeze({ sanctions: SANCTIONS_PROFILE, pep: PEP_PROFILE });

/** One name of the pool: its Latin forms (the first the usual spelling) and its other scripts. */
export interface PoolItem {
  readonly latin: readonly string[];
  /** Other-script forms by writing system, in the order the group gives them. */
  readonly scripts: Readonly<Record<string, readonly string[]>>;
}

/** The names a table draws from, by the Zipf law. */
export interface NamePool {
  readonly items: readonly PoolItem[];
  /** A given name by the law. */
  given(random: SeededRandom): PoolItem;
  /** A family name by the law (its own rank order). */
  family(random: SeededRandom): PoolItem;
}

/** Scripts written family name first and without a space. */
const UNSPACED: ReadonlySet<string> = new Set(['han', 'hiragana', 'katakana']);

/** The Latin variants of an alias; `swap` (family name first) is also the fallback. */
const LATIN_VARIANTS = ['swap', 'spelling', 'middle', 'initial', 'given'] as const;

/**
 * A sampler of ranks 0 to `size - 1` with weights `1 / (rank + 1) ** exponent` (Zipf's law).
 * @throws {RangeError} for an empty range or a size that is not an integer.
 */
export function zipfSampler(size: number, exponent = 1): (random: SeededRandom) => number {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError('the range is empty');
  }
  const cumulative = new Float64Array(size);
  let total = 0;
  for (let rank = 0; rank < size; rank += 1) {
    total += 1 / (rank + 1) ** exponent;
    cumulative[rank] = total;
  }
  return (random) => {
    const target = random.next() * total;
    let low = 0;
    let high = size - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((cumulative[middle] ?? total) <= target) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low;
  };
}

/** A group's single-word forms by writing system, or `null` when it has no Latin form. */
function groupItem(group: { readonly forms: readonly string[] }): PoolItem | null {
  const latin: string[] = [];
  const scripts: Record<string, string[]> = {};
  for (const form of group.forms) {
    const systems: WritingSystem[] = [...writingSystemsOf(form)];
    const [system] = systems;
    if (/\s/u.test(form) || systems.length !== 1 || system === undefined || system === 'other') {
      continue;
    }
    if (system === 'latin') {
      latin.push(form);
    } else {
      (scripts[system] ??= []).push(form);
    }
  }
  return latin.length === 0 ? null : { latin, scripts };
}

/**
 * The name pool: the groups' items with a Latin form, then `fictional` fictional names; two
 * independent rank orders (given and family) shuffled by the seed.
 * @throws {RangeError} when the pool is empty.
 */
export function namePool(options: {
  readonly seed: string;
  readonly groups?: readonly { readonly forms: readonly string[] }[];
  readonly fictional?: number;
  readonly exponent?: number;
}): NamePool {
  const random = seededRandom(`evaluation-6/tables/pool/${options.seed}`);
  const items: PoolItem[] = [];
  for (const group of options.groups ?? []) {
    const item = groupItem(group);
    if (item !== null) {
      items.push(item);
    }
  }
  const names = random.fork('fictional');
  for (let index = 0; index < (options.fictional ?? 0); index += 1) {
    const token = index % 2 === 0 ? fictionalGivenName(names) : fictionalFamilyName(names);
    items.push({
      latin: [token.latin],
      scripts: { cyrillic: [token.cyrillic], arabic: [token.arabic] },
    });
  }
  const positions = items.map((_, index) => index);
  const givenOrder = random.fork('given').shuffle(positions);
  const familyOrder = random.fork('family').shuffle(positions);
  const draw = zipfSampler(items.length, options.exponent ?? 1);
  const at = (order: readonly number[], stream: SeededRandom): PoolItem => {
    const item = items[order[draw(stream)] ?? 0];
    if (item === undefined) {
      throw new RangeError('the pool has no such rank');
    }
    return item;
  };
  return {
    items,
    given: (stream) => at(givenOrder, stream),
    family: (stream) => at(familyOrder, stream),
  };
}

function nameOf(
  script: string,
  parts: readonly (readonly [Role, string])[],
  options: { readonly primary?: boolean; readonly quality?: 'strong' | 'weak' } = {},
): WatchlistName {
  const unspaced = UNSPACED.has(script);
  const ordered = unspaced
    ? [...parts].sort(([left], [right]) => Number(left !== 'family') - Number(right !== 'family'))
    : parts;
  return {
    full: ordered.map(([, value]) => value).join(unspaced ? '' : ' '),
    parts: ordered.map(([role, value]) => ({ role, value })),
    script: script as WatchlistName['script'],
    quality: options.quality ?? 'strong',
    primary: options.primary ?? false,
  };
}

/** The number of aliases a profile gives an entry. */
function aliasCount(random: SeededRandom, profile: TableProfile): number {
  const draw = random.next();
  let cumulative = 0;
  for (const [count, share] of profile.aliases) {
    cumulative += share;
    if (draw < cumulative) {
      return count;
    }
  }
  return profile.aliases.at(-1)?.[0] ?? 0;
}

interface EntryNames {
  readonly given: PoolItem;
  readonly middle: PoolItem | null;
  readonly family: PoolItem;
}

/** One alias of an entry: a weak single token, the name in another script, or a Latin variant. */
function aliasOf(
  random: SeededRandom,
  profile: TableProfile,
  pool: NamePool,
  { given, middle, family }: EntryNames,
): WatchlistName {
  const first = given.latin[0] ?? '';
  const last = family.latin[0] ?? '';
  if (random.chance(profile.weakShare)) {
    const role = random.chance(0.5) ? 'family' : 'given';
    const form = random.pick(role === 'family' ? family.latin : given.latin);
    return nameOf('latin', [[role, form]], { quality: 'weak' });
  }
  if (random.chance(profile.scriptShare)) {
    const tokens = middle === null ? [given, family] : [given, middle, family];
    const shared = Object.keys(given.scripts).filter((script) =>
      tokens.every((token) => (token.scripts[script]?.length ?? 0) > 0),
    );
    if (shared.length > 0) {
      const script = random.pick(shared);
      const form = (token: PoolItem) => random.pick(token.scripts[script] ?? ['']);
      return nameOf(script, [
        ['given', form(given)],
        ...(middle === null ? [] : [['middle', form(middle)] as const]),
        ['family', form(family)],
      ]);
    }
  }
  switch (random.pick(LATIN_VARIANTS)) {
    case 'spelling':
      if (given.latin.length > 1 || family.latin.length > 1) {
        return nameOf('latin', [
          ['given', random.pick(given.latin)],
          ['family', random.pick(family.latin)],
        ]);
      }
      break;
    case 'middle':
      return nameOf('latin', [
        ['given', first],
        ...(middle === null ? [['middle', pool.given(random).latin[0] ?? ''] as const] : []),
        ['family', last],
      ]);
    case 'initial':
      return nameOf('latin', [
        ['given', `${first.charAt(0)}.`],
        ['family', last],
      ]);
    case 'given':
      return nameOf('latin', [
        ['given', pool.given(random).latin[0] ?? ''],
        ['family', last],
      ]);
    default:
      break;
  }
  return nameOf('latin', [
    ['family', last],
    ['given', first],
  ]);
}

const pad2 = (value: number) => String(value).padStart(2, '0');

const birthdate = (random: SeededRandom) =>
  `${String(random.between(1940, 2005))}-${pad2(random.between(1, 12))}-${pad2(random.between(1, 28))}`;

/** One individual of a profile. */
function entryOf(
  random: SeededRandom,
  pool: NamePool,
  profile: TableProfile,
  entryId: string,
): WatchlistRecord {
  const given = pool.given(random);
  const family = pool.family(random);
  const middle = random.chance(profile.middleShare) ? pool.given(random) : null;
  const primary = nameOf(
    'latin',
    [
      ['given', given.latin[0] ?? ''],
      ...(middle === null ? [] : [['middle', middle.latin[0] ?? ''] as const]),
      ['family', family.latin[0] ?? ''],
    ],
    { primary: true },
  );
  const names = [primary];
  const seen = new Set([primary.full]);
  const wanted = aliasCount(random, profile);
  for (let attempt = 0; names.length <= wanted && attempt < wanted * 4 + 4; attempt += 1) {
    const alias = aliasOf(random, profile, pool, { given, middle, family });
    if (!seen.has(alias.full)) {
      seen.add(alias.full);
      names.push(alias);
    }
  }
  const gender = random.chance(0.5) ? random.pick(['female', 'male'] as const) : null;
  return {
    entry_id: entryId,
    kind: 'individual',
    names,
    birth_dates: random.chance(profile.birthDateShare)
      ? [{ value: birthdate(random), precision: 'day' }]
      : [],
    birth_places: [],
    countries: [{ code: random.pick(SYNTHETIC_COUNTRIES), role: 'nationality' }],
    ...(gender === null ? {} : { gender }),
    identifiers: [],
    addresses: [],
    crypto_addresses: [],
    programs: ['BENCHMARK'],
    listed_at: '2025-01-01',
    positions: [],
    relations: [],
  };
}

/** Individuals of a profile until the table holds at least `names` names (`BM-` ids by default). */
export function* syntheticEntries(options: {
  readonly seed: string;
  readonly pool: NamePool;
  readonly names: number;
  readonly profile: TableProfile;
  readonly idPrefix?: string;
}): Generator<WatchlistRecord> {
  const random = seededRandom(`evaluation-6/tables/entries/${options.seed}`);
  let names = 0;
  for (let index = 1; names < options.names; index += 1) {
    const record = entryOf(
      random,
      options.pool,
      options.profile,
      `${options.idPrefix ?? 'BM-'}${String(index).padStart(7, '0')}`,
    );
    names += record.names.length;
    yield record;
  }
}

/** The `watchlist` query of a listed entry: its primary name's parts and its birth date. */
export function listedQuery(record: WatchlistRecord): Record<string, string> {
  const primary = record.names.find((name) => name.primary) ?? record.names[0];
  const part = (role: Role) => primary?.parts.find((item) => item.role === role)?.value;
  const [first, middle, last] = [part('given'), part('middle'), part('family')];
  const date = record.birth_dates[0]?.value;
  return {
    ...(first === undefined || last === undefined
      ? { term: primary?.full ?? record.entry_id }
      : {
          'name-first': first,
          ...(middle === undefined ? {} : { 'name-middle': middle }),
          'name-last': last,
        }),
    ...(date === undefined ? {} : { birthdate: date }),
  };
}

/** Unlisted `watchlist` queries drawn from the pool's law, with birth dates. */
export function unlistedQueries(options: {
  readonly seed: string;
  readonly pool: NamePool;
  readonly count: number;
}): Record<string, string>[] {
  const random = seededRandom(`evaluation-6/tables/unlisted/${options.seed}`);
  return Array.from({ length: options.count }, () => ({
    'name-first': random.pick(options.pool.given(random).latin),
    'name-last': random.pick(options.pool.family(random).latin),
    birthdate: birthdate(random),
  }));
}

/** A subject of a table: a listed entry's query, or an unlisted name's. */
export interface TableSubject {
  readonly subject: 'listed' | 'unlisted';
  readonly query: Readonly<Record<string, string>>;
  /** The listed entry's id; `null` for an unlisted name. */
  readonly entryId: string | null;
}

/**
 * `count` listed entries spread over `records` (every `floor(records / count)`-th, from the first),
 * each followed by one of `count` unlisted names drawn from `unlistedSeed`.
 */
export function tableSubjects(options: {
  readonly records: readonly WatchlistRecord[];
  readonly pool: NamePool;
  readonly count: number;
  readonly unlistedSeed: string;
}): TableSubject[] {
  const { records, count } = options;
  const step = Math.floor(records.length / count);
  const listed = Array.from({ length: count }, (_, index) => records[index * step]).filter(
    (record): record is WatchlistRecord => record !== undefined,
  );
  const unlisted = unlistedQueries({ seed: options.unlistedSeed, pool: options.pool, count });
  return listed.flatMap((record, index): TableSubject[] => [
    { subject: 'listed', query: listedQuery(record), entryId: record.entry_id },
    { subject: 'unlisted', query: unlisted[index] ?? {}, entryId: null },
  ]);
}

/**
 * C78.7's 100,000-name table: the sanctions profile, its entries `BS-` from the seed's
 * `<seed>/100k` stream, over a pool of the raw groups plus 40,000 fictional names by Zipf's law
 * with exponent 1, screened by 150 listed and 150 unlisted subjects (the benchmark's
 * `100k-import` and `100k-measure`, and the gate).
 */
export const HEAVY_HEADED_100K = Object.freeze({
  scale: '100k',
  names: 100_000,
  fictional: 40_000,
  exponent: 1,
  profile: TABLE_PROFILES.sanctions,
  idPrefix: 'BS-',
  listed: 150,
  unlisted: 150,
});

/** The pool of the heavy-headed tables of `seed` (`<seed>/pool`), over the raw `groups`. */
export function heavyHeadedPool(
  seed: string,
  groups: readonly { readonly forms: readonly string[] }[],
): NamePool {
  return namePool({
    seed: `${seed}/pool`,
    groups,
    fictional: HEAVY_HEADED_100K.fictional,
    exponent: HEAVY_HEADED_100K.exponent,
  });
}

/** The entries of the 100,000-name table of `seed`; `names` makes a smaller one (a smoke run). */
export function heavyHeadedEntries(options: {
  readonly seed: string;
  readonly pool: NamePool;
  readonly names?: number;
}): Generator<WatchlistRecord> {
  return syntheticEntries({
    seed: `${options.seed}/${HEAVY_HEADED_100K.scale}`,
    pool: options.pool,
    names: options.names ?? HEAVY_HEADED_100K.names,
    profile: HEAVY_HEADED_100K.profile,
    idPrefix: HEAVY_HEADED_100K.idPrefix,
  });
}

/**
 * The subjects of the 100,000-name table of `seed`: 150 listed (or `count`) and as many unlisted,
 * interleaved.
 */
export function heavyHeadedSubjects(options: {
  readonly seed: string;
  readonly pool: NamePool;
  readonly records: readonly WatchlistRecord[];
  readonly count?: number;
}): TableSubject[] {
  return tableSubjects({
    records: options.records,
    pool: options.pool,
    count: options.count ?? HEAVY_HEADED_100K.listed,
    unlistedSeed: `${options.seed}/${HEAVY_HEADED_100K.scale}/unlisted`,
  });
}

/** The 100,000-name table of a seed: its pool, its entries and its subjects. */
export interface HeavyHeadedTable {
  readonly pool: NamePool;
  readonly records: readonly WatchlistRecord[];
  readonly subjects: readonly TableSubject[];
}

/** The whole 100,000-name table of `seed`, its pool drawn over the raw `groups`. */
export function heavyHeadedTable(options: {
  readonly seed: string;
  readonly groups: readonly { readonly forms: readonly string[] }[];
}): HeavyHeadedTable {
  const pool = heavyHeadedPool(options.seed, options.groups);
  const records = [...heavyHeadedEntries({ seed: options.seed, pool })];
  return { pool, records, subjects: heavyHeadedSubjects({ seed: options.seed, pool, records }) };
}

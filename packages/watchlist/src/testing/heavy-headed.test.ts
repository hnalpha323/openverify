/**
 * Owner decision 6 after Workflow 6C: `heavy-headed.ts` is the one definition of C78.7's
 * 100,000-name table, the table the gate and the benchmark both draw. It must reproduce the
 * benchmark's own generator (`scripts/benchmark-tables.mjs`, as `benchmark-performance.mjs` calls
 * it) exactly:
 * - the golden table digests of `scripts/benchmark-golden.test.mjs`, pinned at Workflow 6C's base
 *   (`94ab63f9`), from the same inputs;
 * - the whole 100,000-name table of a seed (its pool, its entries and its 150 listed and 150
 *   unlisted subjects) against the benchmark's own generation, over the raw rigour groups where
 *   `data/` holds the file (`python3 scripts/fetch_data.py`), else over synthetic groups written in
 *   the same format; the benchmark reads its groups with the held-out folder's parser, this module
 *   with its own.
 *
 * Every name here is fictional, or a form of a group the data file holds; nothing is printed.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as benchmark from '../../scripts/benchmark-tables.mjs';
import { watchlistRecordSchema, type WatchlistRecord } from '../record/index.js';
import { parseVariantGroups } from './held-out/groups.js';
import {
  HEAVY_HEADED_100K,
  heavyHeadedEntries,
  heavyHeadedPool,
  heavyHeadedSubjects,
  heavyHeadedTable,
  listedQuery,
  namePool,
  parseRigourPersonNames,
  syntheticEntries,
  TABLE_PROFILES,
  tableSubjects,
  unlistedQueries,
  zipfSampler,
} from './heavy-headed.js';
import { fictionalFamilyName, fictionalGivenName, fictionalHanName } from './names.js';
import { seededRandom } from './random.js';

const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');

/** Synthetic groups in rigour's `person_names.txt` format, with every case its parser meets. */
function syntheticRigourText(): string {
  const random = seededRandom('heavy-headed/rigour');
  const lines: string[] = [];
  for (let index = 0; index < 240; index += 1) {
    const token = index % 2 === 0 ? fictionalGivenName(random) : fictionalFamilyName(random);
    const latin = token.latin.toLowerCase();
    const forms = [latin, `${latin}a`, token.cyrillic.toLowerCase(), token.arabic];
    if (index % 3 === 0) {
      forms.push(fictionalHanName(random).givenHan);
    }
    lines.push(`${forms.join(', ')} => Q-synthetic-${String(index)}`);
  }
  lines.push(
    '',
    'a line without a group id',
    'velmorin, welmorin =>   ',
    ' ,  , => Q-synthetic-empty',
    'tesk ollan, teskollan,  => X-synthetic-1',
    'дрентов, дрентова => Q-synthetic-cyrillic-only',
    'zaldrinя, zaldrin => Q-synthetic-mixed',
    'quorvan => left => Q-synthetic-arrow',
  );
  return `${lines.join('\n')}\n`;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(HERE, '../../../../data');

/** The raw groups the benchmark reads: `data/`'s rigour file where it is present. */
function rawGroups(): { readonly source: string; readonly text: string } {
  const manifest = JSON.parse(readFileSync(join(DATA, 'manifest.json'), 'utf8')) as {
    data: { name: string; filename: string }[];
  };
  const filename = manifest.data.find((entry) => entry.name === 'rigour_person_names')?.filename;
  const path = filename === undefined ? null : join(DATA, filename);
  return path !== null && existsSync(path)
    ? { source: `data/${String(filename)}`, text: readFileSync(path, 'utf8') }
    : { source: 'synthetic groups (data/ has no rigour file)', text: syntheticRigourText() };
}

describe('parseRigourPersonNames', () => {
  it('reads each `form, form, … => id` line, skipping a line without an id or forms', () => {
    const groups = parseRigourPersonNames(syntheticRigourText());

    expect(groups).toHaveLength(244);
    expect(groups.at(0)?.id).toBe('Q-synthetic-0');
    expect(groups.at(0)?.forms).toHaveLength(5);
    expect(groups.slice(-4)).toEqual([
      { id: 'X-synthetic-1', forms: ['tesk ollan', 'teskollan'] },
      { id: 'Q-synthetic-cyrillic-only', forms: ['дрентов', 'дрентова'] },
      { id: 'Q-synthetic-mixed', forms: ['zaldrinя', 'zaldrin'] },
      { id: 'Q-synthetic-arrow', forms: ['quorvan => left'] },
    ]);
  });

  it('gives the groups the benchmark reads with the held-out folder’s parser', () => {
    const { text } = rawGroups();

    expect(digest(parseRigourPersonNames(text))).toBe(digest(parseVariantGroups(text)));
    expect(parseRigourPersonNames('ovra, ovrah => Q1\r\n')).toEqual([
      { id: 'Q1', forms: ['ovra', 'ovrah'] },
    ]);
  });
});

/** Fictional groups in the held-out generator's shape, as `benchmark-golden.test.mjs` writes them. */
function goldenGroups() {
  const random = seededRandom('benchmark-golden/groups');
  return Array.from({ length: 400 }, (_, index) => {
    const token = index % 2 === 0 ? fictionalGivenName(random) : fictionalFamilyName(random);
    return {
      id: `Q-golden-${String(index)}`,
      forms: [token.latin, `${token.latin}a`, token.cyrillic, token.arabic],
    };
  });
}

/** `benchmark-golden.test.mjs`' table digests at Workflow 6C's base (`94ab63f9`). */
const BENCHMARK_GOLDEN = {
  pool: 'f9c3b4ec2763c6279d2de6907b21c9e0509cb78ff0232cee29206e05af5fae19',
  draws: 'e813b4a08f3f078cb92f4923b55fb7bcc742a06e8b7b853a7f15e3f7c59fa9c8',
  zipf: 'e5463a749ffe16b47b97e33860f608fb37fb94733c20ee2426d21296cc4f9e79',
  sanctions: '68e61b90c8c801b501a77aaf0d6a7a9840b93f2b2a9eef712f1f0f0e6a0379b1',
  pep: '0a0e15febc15718bb4c82176be8ff0def449185316628a528aaaa261b1178ac8',
  listed: '61ec7372b95d806ca687751f50b6586117a9cca76fb7c073e51f58d7c9978292',
  unlisted: 'e2d4a2c519f6f6f3898f942619317919146ed2e0ccd5b22eefd59acdd5e36fac',
};

describe('the benchmark’s golden tables (benchmark-golden.test.mjs, pinned at 94ab63f9)', () => {
  it('gives the same pool, draws, entries of both profiles and queries from the same inputs', () => {
    const pool = namePool({ seed: 'benchmark-golden', groups: goldenGroups(), fictional: 300 });
    const random = seededRandom('benchmark-golden/draws');
    const draws = Array.from({ length: 200 }, () => [
      pool.given(random).latin[0],
      pool.family(random).latin[0],
    ]);
    const zipf = zipfSampler(500, 1);
    const zipfRandom = seededRandom('benchmark-golden/zipf');
    const sanctions = [
      ...syntheticEntries({
        seed: 'benchmark-golden/s',
        pool,
        names: 3000,
        profile: TABLE_PROFILES.sanctions,
        idPrefix: 'BS-',
      }),
    ];
    const pep = [
      ...syntheticEntries({
        seed: 'benchmark-golden/p',
        pool,
        names: 6000,
        profile: TABLE_PROFILES.pep,
        idPrefix: 'BP-',
      }),
    ];

    expect({
      pool: digest(pool.items),
      draws: digest(draws),
      zipf: digest(Array.from({ length: 1000 }, () => zipf(zipfRandom))),
      sanctions: digest(sanctions),
      pep: digest(pep),
      listed: digest([...sanctions, ...pep].map(listedQuery)),
      unlisted: digest(unlistedQueries({ seed: 'benchmark-golden/u', pool, count: 100 })),
    }).toEqual(BENCHMARK_GOLDEN);
  });

  it('has the benchmark’s profiles', () => {
    expect(TABLE_PROFILES).toEqual(benchmark.TABLE_PROFILES);
  });
});

describe('C78.7’s 100,000-name table (owner decision 6 after Workflow 6C)', () => {
  it('is the sanctions profile at 100,000 names over a Zipf law of exponent 1, with 40,000 fictional names, 150 listed and 150 unlisted subjects', () => {
    expect(HEAVY_HEADED_100K).toEqual({
      scale: '100k',
      names: 100_000,
      fictional: 40_000,
      exponent: 1,
      profile: TABLE_PROFILES.sanctions,
      idPrefix: 'BS-',
      listed: 150,
      unlisted: 150,
    });
    expect(Object.isFrozen(HEAVY_HEADED_100K)).toBe(true);
  });

  it(`equals the benchmark's own generation of a seed's table: ${rawGroups().source}`, () => {
    const seed = 'heavy-headed-test';
    const { text } = rawGroups();

    const table = heavyHeadedTable({ seed, groups: parseRigourPersonNames(text) });

    // benchmark-performance.mjs: `poolOf`, the `100k-import` entries and `subjectsOf`.
    const pool = benchmark.namePool({
      seed: `${seed}/pool`,
      groups: parseVariantGroups(text),
      fictional: 40_000,
    });
    const records = [
      ...benchmark.syntheticEntries({
        seed: `${seed}/100k`,
        pool,
        names: 100_000,
        profile: benchmark.TABLE_PROFILES.sanctions,
        idPrefix: 'BS-',
      }),
    ];
    const step = Math.floor(records.length / 150);
    const listed = Array.from({ length: 150 }, (_, index) => records[index * step]).filter(
      (record): record is WatchlistRecord => record !== undefined,
    );
    const unlisted = benchmark.unlistedQueries({ seed: `${seed}/100k/unlisted`, pool, count: 150 });
    const subjects = listed.flatMap((record, index) => [
      { subject: 'listed', query: benchmark.listedQuery(record), entryId: record.entry_id },
      { subject: 'unlisted', query: unlisted[index] ?? {}, entryId: null },
    ]);

    expect(digest(table.pool.items)).toBe(digest(pool.items));
    expect(table.records.length).toBe(records.length);
    expect(digest(table.records)).toBe(digest(records));
    expect(digest(table.subjects)).toBe(digest(subjects));
    expect(table.subjects).toHaveLength(300);
    expect(table.records.reduce((sum, record) => sum + record.names.length, 0)).toBeGreaterThan(
      99_999,
    );
  }, 300_000);
});

describe('the parts of a table', () => {
  let parsed: ReturnType<typeof parseRigourPersonNames> | undefined;
  const groups = () => (parsed ??= parseRigourPersonNames(syntheticRigourText()));

  it('draws ranks with weights 1 / (rank + 1) ** exponent, and refuses an empty range', () => {
    const draw = zipfSampler(5, 1);
    const random = seededRandom('zipf');
    const counts = [0, 0, 0, 0, 0];
    for (let index = 0; index < 60_000; index += 1) {
      const rank = draw(random);
      counts[rank] = (counts[rank] ?? 0) + 1;
    }
    const [first = 0, second = 0, , , fifth = 0] = counts;

    expect(first / second).toBeGreaterThan(1.85);
    expect(first / second).toBeLessThan(2.15);
    expect(first / fifth).toBeGreaterThan(4.6);
    expect(first / fifth).toBeLessThan(5.4);
    expect(() => zipfSampler(0)).toThrow(RangeError);
    expect(() => zipfSampler(2.5)).toThrow(RangeError);
  });

  it('pools each group with a single-word Latin form, with its other scripts, and the fictional names', () => {
    const pool = namePool({ seed: 'parts', groups: groups(), fictional: 10 });
    const latin = pool.items.map((item) => item.latin);

    expect(pool.items).toHaveLength(240 + 1 + 1 + 10);
    expect(latin).toContainEqual(['teskollan']);
    expect(latin).toContainEqual(['zaldrin']);
    expect(latin.flat()).not.toContain('tesk ollan');
    expect(latin.flat()).not.toContain('zaldrinя');
    expect(pool.items.some((item) => (item.scripts.han?.length ?? 0) > 0)).toBe(true);
    expect(pool.items.filter((item) => item.scripts.arabic !== undefined).length).toBeGreaterThan(
      240,
    );
    const random = seededRandom('parts/draws');
    expect(pool.items).toContain(pool.given(random));
    expect(pool.items).toContain(pool.family(random));
  });

  it('writes valid individuals of each profile until the names are reached, the same for a seed', () => {
    const pool = namePool({ seed: 'parts', groups: groups(), fictional: 40 });
    const entries = (profile: 'sanctions' | 'pep', idPrefix?: string) => [
      ...syntheticEntries({
        seed: `parts/${profile}`,
        pool,
        names: 2_000,
        profile: TABLE_PROFILES[profile],
        ...(idPrefix === undefined ? {} : { idPrefix }),
      }),
    ];
    const sanctions = entries('sanctions');
    const peps = entries('pep', 'BP-');

    for (const record of [...sanctions, ...peps]) {
      expect(watchlistRecordSchema.safeParse(record).success).toBe(true);
      expect(record.names.filter((name) => name.primary)).toHaveLength(1);
    }
    expect(sanctions.reduce((sum, record) => sum + record.names.length, 0)).toBeGreaterThan(1_999);
    expect(sanctions[0]?.entry_id).toMatch(/^BM-\d{7}$/u);
    expect(peps[0]?.entry_id).toMatch(/^BP-\d{7}$/u);
    expect(entries('sanctions')).toEqual(sanctions);
    // Han is written family name first and without a space.
    const han = peps.flatMap((record) => record.names).find((name) => name.script === 'han');
    expect(han).toBeDefined();
    expect(han?.full.includes(' ')).toBe(false);
    expect(han?.parts[0]?.role).toBe('family');
  });

  it('asks for a listed entry by its primary name’s parts and birth date, or by its term', () => {
    type Role = WatchlistRecord['names'][number]['parts'][number]['role'];
    const name = (parts: [Role, string][]) => ({
      full: parts.map(([, value]) => value).join(' '),
      parts: parts.map(([role, value]) => ({ role, value })),
      script: 'latin' as const,
      quality: 'strong' as const,
      primary: true,
    });
    const record = (names: WatchlistRecord['names'], birth = true): WatchlistRecord => ({
      entry_id: 'BS-0000001',
      kind: 'individual',
      names,
      birth_dates: birth ? [{ value: '1971-03-04', precision: 'day' }] : [],
      birth_places: [],
      countries: [],
      identifiers: [],
      addresses: [],
      crypto_addresses: [],
      programs: [],
      positions: [],
      relations: [],
    });

    expect(
      listedQuery(
        record([
          name([
            ['given', 'Belmira'],
            ['middle', 'Ostvane'],
            ['family', 'Quorvan'],
          ]),
        ]),
      ),
    ).toEqual({
      'name-first': 'Belmira',
      'name-middle': 'Ostvane',
      'name-last': 'Quorvan',
      birthdate: '1971-03-04',
    });
    expect(listedQuery(record([name([['family', 'Quorvan']])], false))).toEqual({
      term: 'Quorvan',
    });
  });

  it('spreads the listed subjects over the table, each followed by an unlisted name of the law', () => {
    const pool = namePool({ seed: 'parts', groups: groups(), fictional: 40 });
    const records = [
      ...syntheticEntries({
        seed: 'parts/subjects',
        pool,
        names: 600,
        profile: TABLE_PROFILES.sanctions,
      }),
    ];
    const subjects = tableSubjects({ records, pool, count: 20, unlistedSeed: 'parts/unlisted' });
    const unlisted = unlistedQueries({ seed: 'parts/unlisted', pool, count: 20 });

    expect(subjects).toHaveLength(40);
    expect(subjects.filter((_, index) => index % 2 === 1).map((item) => item.query)).toEqual(
      unlisted,
    );
    const step = Math.floor(records.length / 20);
    expect(
      subjects.filter((item) => item.subject === 'listed').map((item) => item.entryId),
    ).toEqual(Array.from({ length: 20 }, (_, index) => records[index * step]?.entry_id));
    expect(unlisted.every((query) => Object.keys(query).length === 3)).toBe(true);
    expect(tableSubjects({ records: [], pool, count: 5, unlistedSeed: 'x' })).toEqual([]);
  });

  it('composes the 100,000-name table of a seed from its parts, with smaller sizes for a smoke run', () => {
    const pool = heavyHeadedPool('compose', groups());
    const again = namePool({
      seed: 'compose/pool',
      groups: groups(),
      fictional: 40_000,
      exponent: 1,
    });
    expect(digest(pool.items)).toBe(digest(again.items));

    const records = [...heavyHeadedEntries({ seed: 'compose', pool, names: 3_000 })];
    expect(records).toEqual([
      ...syntheticEntries({
        seed: 'compose/100k',
        pool,
        names: 3_000,
        profile: TABLE_PROFILES.sanctions,
        idPrefix: 'BS-',
      }),
    ]);
    expect(heavyHeadedSubjects({ seed: 'compose', pool, records, count: 10 })).toEqual(
      tableSubjects({ records, pool, count: 10, unlistedSeed: 'compose/100k/unlisted' }),
    );
    expect(heavyHeadedSubjects({ seed: 'compose', pool, records })).toHaveLength(300);
  });
});

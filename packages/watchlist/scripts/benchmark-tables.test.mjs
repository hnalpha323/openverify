// @ts-check
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { watchlistImportSchema, watchlistRecordSchema } from '../src/record/index.js';
import * as shared from '../src/testing/heavy-headed.js';
import { seededRandom } from '../src/testing/random.js';
import {
  TABLE_PROFILES,
  listedQuery,
  namePool,
  syntheticEntries,
  unlistedQueries,
  writeNormalisedImport,
  zipfSampler,
} from './benchmark-tables.mjs';

/** @typedef {import('../src/record/index.js').WatchlistRecord} WatchlistRecord */

/** Fictional group forms (not real people), in the shape of the held-out generator's groups. */
const GROUPS = [
  { id: 'X1', forms: ['Quorvane', 'Quorvan', 'Кворван', 'كورفان'] },
  { id: 'X2', forms: ['Belmira', 'Белмира'] },
  { id: 'X3', forms: ['Tesk Ollan', 'Teskollan'] },
  { id: 'X4', forms: ['Дрентов', 'Дрентова'] },
  { id: 'X5', forms: ['Zaldrin', 'Zaldrinя'] },
];

/** @param {Iterable<WatchlistRecord>} records */
const take = (records) => [...records];

describe('zipfSampler', () => {
  it('draws ranks with weights 1 / (rank + 1), the first the most often', () => {
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
  });

  it('is flat with exponent 0, and refuses an empty range', () => {
    const draw = zipfSampler(4, 0);
    const random = seededRandom('flat');
    const counts = [0, 0, 0, 0];
    for (let index = 0; index < 40_000; index += 1) {
      const rank = draw(random);
      counts[rank] = (counts[rank] ?? 0) + 1;
    }

    counts.forEach((count) => {
      expect(count / 40_000).toBeGreaterThan(0.23);
      expect(count / 40_000).toBeLessThan(0.27);
    });
    expect(() => zipfSampler(0)).toThrow(RangeError);
  });
});

describe('namePool', () => {
  it('keeps the groups with a single-word Latin form, with their other-script forms, and adds fictional names', () => {
    const pool = namePool({ seed: 'pool', groups: GROUPS, fictional: 6 });
    const fromGroups = pool.items.filter((item) => item.latin[0]?.startsWith('Q') === true);

    expect(pool.items).toHaveLength(4 + 6);
    expect(fromGroups).toEqual([
      { latin: ['Quorvane', 'Quorvan'], scripts: { cyrillic: ['Кворван'], arabic: ['كورفان'] } },
    ]);
    expect(pool.items.find((item) => item.latin.includes('Teskollan'))).toEqual({
      latin: ['Teskollan'],
      scripts: {},
    });
    expect(pool.items.some((item) => item.latin.includes('Zaldrinя'))).toBe(false);
    const fictional = pool.items.filter((item) => item.scripts.cyrillic?.length === 1);
    expect(fictional.length).toBeGreaterThanOrEqual(6);
  });

  it('draws given and family names from the pool, the same for the same seed', () => {
    const pool = namePool({ seed: 'pool', groups: GROUPS, fictional: 50 });
    const again = namePool({ seed: 'pool', groups: GROUPS, fictional: 50 });
    const first = seededRandom('draws');
    const second = seededRandom('draws');
    const drawn = Array.from({ length: 30 }, () => pool.given(first).latin[0]);

    expect(drawn).toEqual(Array.from({ length: 30 }, () => again.given(second).latin[0]));
    drawn.forEach((name) => {
      expect(pool.items.some((item) => item.latin[0] === name)).toBe(true);
    });
    expect(pool.items).toContain(pool.family(first));
  });
});

describe('syntheticEntries', () => {
  /** @type {import('./benchmark-tables.mjs').NamePool | undefined} */
  let built;
  const pool = () => (built ??= namePool({ seed: 'entries', groups: GROUPS, fictional: 400 }));

  it('writes valid individuals until the table holds the names asked for, the same for a seed', () => {
    const records = take(
      syntheticEntries({ seed: 't1', pool: pool(), names: 500, profile: TABLE_PROFILES.sanctions }),
    );
    const names = records.reduce((sum, record) => sum + record.names.length, 0);

    records.forEach((record) => {
      expect(watchlistRecordSchema.safeParse(record).success).toBe(true);
      expect(record.kind).toBe('individual');
      expect(record.names.filter((name) => name.primary)).toHaveLength(1);
      expect(new Set(record.names.map((name) => name.full)).size).toBe(record.names.length);
    });
    expect(names).toBeGreaterThanOrEqual(500);
    expect(names).toBeLessThan(500 + 8);
    expect(new Set(records.map((record) => record.entry_id)).size).toBe(records.length);
    expect(records[0]?.entry_id).toMatch(/^BM-\d{7}$/);
    expect(
      take(
        syntheticEntries({
          seed: 't1',
          pool: pool(),
          names: 500,
          profile: TABLE_PROFILES.sanctions,
        }),
      ),
    ).toEqual(records);
  });

  it('gives about 1.65 names an entry for sanctions and about 5 in several scripts for PEPs', () => {
    const sanctions = take(
      syntheticEntries({ seed: 's', pool: pool(), names: 4000, profile: TABLE_PROFILES.sanctions }),
    );
    const peps = take(
      syntheticEntries({
        seed: 'p',
        pool: pool(),
        names: 8000,
        profile: TABLE_PROFILES.pep,
        idPrefix: 'BP-',
      }),
    );
    const perEntry = (/** @type {WatchlistRecord[]} */ records) =>
      records.reduce((sum, record) => sum + record.names.length, 0) / records.length;
    const scripts = new Set(peps.flatMap((record) => record.names.map((name) => name.script)));

    expect(perEntry(sanctions)).toBeGreaterThan(1.45);
    expect(perEntry(sanctions)).toBeLessThan(1.85);
    expect(perEntry(peps)).toBeGreaterThan(4.3);
    expect(perEntry(peps)).toBeLessThan(5.5);
    expect(scripts.has('cyrillic')).toBe(true);
    expect(scripts.has('arabic')).toBe(true);
    expect(peps.some((record) => record.names.some((name) => name.quality === 'weak'))).toBe(true);
    expect(peps.every((record) => record.names[0]?.primary === true)).toBe(true);
    expect(peps[0]?.entry_id).toMatch(/^BP-/);
  });
});

describe('queries', () => {
  /** @type {import('./benchmark-tables.mjs').NamePool | undefined} */
  let built;
  const pool = () => (built ??= namePool({ seed: 'queries', groups: GROUPS, fictional: 200 }));

  it("asks for a listed entry by its primary name's parts and its birth date", () => {
    /** @type {WatchlistRecord} */
    const record = {
      entry_id: 'BM-0000001',
      kind: 'individual',
      names: [
        {
          full: 'Belmira Ostvane Quorvan',
          parts: [
            { role: 'given', value: 'Belmira' },
            { role: 'middle', value: 'Ostvane' },
            { role: 'family', value: 'Quorvan' },
          ],
          script: 'latin',
          quality: 'strong',
          primary: true,
        },
      ],
      birth_dates: [{ value: '1971-03-04', precision: 'day' }],
      birth_places: [],
      countries: [],
      identifiers: [],
      addresses: [],
      crypto_addresses: [],
      programs: [],
      positions: [],
      relations: [],
    };

    expect(listedQuery(record)).toEqual({
      'name-first': 'Belmira',
      'name-middle': 'Ostvane',
      'name-last': 'Quorvan',
      birthdate: '1971-03-04',
    });
    expect(listedQuery({ ...record, birth_dates: [] })).toEqual({
      'name-first': 'Belmira',
      'name-middle': 'Ostvane',
      'name-last': 'Quorvan',
    });
  });

  it('draws unlisted queries from the same law, with birth dates, the same for a seed', () => {
    const queries = unlistedQueries({ seed: 'u', pool: pool(), count: 40 });

    expect(queries).toHaveLength(40);
    expect(unlistedQueries({ seed: 'u', pool: pool(), count: 40 })).toEqual(queries);
    queries.forEach((query) => {
      expect(Object.keys(query).sort()).toEqual(['birthdate', 'name-first', 'name-last']);
      expect(query.birthdate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});

describe('writeNormalisedImport', () => {
  /** @type {string} */
  let directory;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'openverify-benchmark-tables-'));
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('streams a valid import file and says what it wrote', async () => {
    const pool = namePool({ seed: 'file', groups: GROUPS, fictional: 100 });
    const records = take(
      syntheticEntries({ seed: 'f', pool, names: 300, profile: TABLE_PROFILES.pep }),
    );
    const path = join(directory, 'table.json');

    const written = await writeNormalisedImport(path, {
      source: 'openverify-sandbox',
      publishedAt: '2026-10-28T00:00:00.000Z',
      records,
    });
    const bytes = await readFile(path);
    const parsed = watchlistImportSchema.parse(JSON.parse(bytes.toString('utf8')));

    expect(parsed.entries).toEqual(records);
    expect(parsed.source).toBe('openverify-sandbox');
    expect(written).toEqual({
      entries: records.length,
      names: records.reduce((sum, record) => sum + record.names.length, 0),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  });
});

describe('one definition of the tables (owner decision 6 after Workflow 6C)', () => {
  it('takes the profiles, the law, the pool, the entries and the queries from src/testing/heavy-headed.ts', () => {
    expect(TABLE_PROFILES).toBe(shared.TABLE_PROFILES);
    expect(namePool).toBe(shared.namePool);
    expect(syntheticEntries).toBe(shared.syntheticEntries);
    expect(listedQuery).toBe(shared.listedQuery);
    expect(unlistedQueries).toBe(shared.unlistedQueries);
    expect(zipfSampler).toBe(shared.zipfSampler);
  });

  it('the performance and quality benchmarks build their tables from the shared module, and the performance benchmark never reads the held-out generator', async () => {
    const script = (/** @type {string} */ name) =>
      readFile(new URL(`./${name}`, import.meta.url), 'utf8');
    const [performance, quality] = await Promise.all([
      script('benchmark-performance.mjs'),
      script('benchmark-quality.mjs'),
    ]);

    expect(performance).toContain("from '../src/testing/heavy-headed.js'");
    expect(performance).not.toContain('/held-out/');
    expect(performance).not.toMatch(/\bnamePool\(/u);
    expect(quality).toContain("from '../src/testing/heavy-headed.js'");
    expect(quality).not.toMatch(/\bnamePool\(/u);
  });
});

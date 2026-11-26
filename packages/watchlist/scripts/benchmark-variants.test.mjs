// @ts-check
import { describe, expect, it } from 'vitest';
import { wilsonInterval } from './benchmark-metrics.mjs';
import { TABLE_PROFILES, namePool, syntheticEntries } from './benchmark-tables.mjs';
import { DEVELOPMENT_SOURCES, developmentVariants, variantSummary } from './benchmark-variants.mjs';

/** @typedef {import('../src/record/index.js').WatchlistRecord} WatchlistRecord */
/** @typedef {import('./benchmark-variants.mjs').VariantObservation} VariantObservation */

/** Fictional group forms (not real people). */
const GROUPS = [
  { id: 'X1', forms: ['Quorvane', 'Quorvan', 'Кворван'] },
  { id: 'X2', forms: ['Belmira', 'Белмира'] },
];

/** @type {WatchlistRecord[] | undefined} */
let built;
/** A development table, built on first use so each test fails on its own while stubbed. */
const table = () =>
  (built ??= [
    ...syntheticEntries({
      seed: 'variants-test',
      pool: namePool({ seed: 'variants-test', groups: GROUPS, fictional: 300 }),
      names: 3000,
      profile: TABLE_PROFILES.sanctions,
      idPrefix: 'BS-',
    }),
  ]);

/** @param {WatchlistRecord | undefined} record @param {string} role */
const partOf = (record, role) =>
  record?.names.find((name) => name.primary)?.parts.find((part) => part.role === role)?.value;

describe('developmentVariants', () => {
  it('varies listed entries spread over the table, sources in turn, the same for a seed', () => {
    const cases = developmentVariants(table(), { seed: 'dev', count: 70 });
    const entries = new Set(cases.map((item) => item.entryId));

    expect(cases).toHaveLength(70);
    expect(entries.size).toBe(70);
    expect(cases.map((item) => item.source)).toEqual(
      Array.from({ length: 70 }, (_, index) => DEVELOPMENT_SOURCES[index % 7]),
    );
    expect(new Set(cases.map((item) => item.id)).size).toBe(70);
    expect(developmentVariants(table(), { seed: 'dev', count: 70 })).toEqual(cases);
    expect(developmentVariants(table(), { seed: 'other', count: 70 })).not.toEqual(cases);
    const positions = cases.map((item) => table().findIndex((r) => r.entry_id === item.entryId));
    expect(Math.max(...positions)).toBeGreaterThan(table().length * 0.8);
  });

  it('writes each source as its rule says, with the entry’s birth date', () => {
    const records = new Map(table().map((record) => [record.entry_id, record]));
    for (const item of developmentVariants(table(), { seed: 'dev', count: 140 })) {
      const record = records.get(item.entryId);
      const [given = '', middle, family = ''] = ['given', 'middle', 'family'].map((role) =>
        partOf(record, role),
      );
      const { query } = item;
      expect(query.birthdate).toBe(record?.birth_dates[0]?.value);
      const typed = query['name-last'] ?? '';
      switch (item.source) {
        case 'exact':
          expect([query['name-first'], query['name-middle'], typed]).toEqual([
            given,
            middle,
            family,
          ]);
          break;
        case 'order_swap':
          expect([query['name-first'], typed]).toEqual([family, given]);
          break;
        case 'dropped_middle':
          expect(middle).toBeDefined();
          expect(query['name-middle']).toBeUndefined();
          break;
        case 'added_middle':
          expect(middle).toBeUndefined();
          expect(query['name-middle']).toBeTruthy();
          break;
        case 'initials':
          expect(query['name-first']).toBe(`${given.charAt(0)}.`);
          break;
        case 'typo':
          expect(typed).not.toBe(family);
          expect(Math.abs(typed.length - family.length)).toBeLessThanOrEqual(1);
          expect(typed.charAt(0)).toBe(family.charAt(0));
          break;
        case 'transposition':
          expect(typed).not.toBe(family);
          expect([...typed].sort()).toEqual([...family].sort());
          expect(typed.charAt(0)).toBe(family.charAt(0));
          break;
        default:
          throw new Error(`a case of ${String(item.source)}`);
      }
      if (item.source !== 'order_swap' && item.source !== 'initials') {
        expect(query['name-first']).toBe(given);
      }
    }
  });

  it('refuses a count the table cannot give', () => {
    expect(() => developmentVariants(table().slice(0, 5), { seed: 'dev', count: 10 })).toThrow(
      RangeError,
    );
  });
});

describe('variantSummary', () => {
  /** @type {VariantObservation[]} */
  const observations = [
    {
      id: 'd1',
      source: 'typo',
      entryId: 'E1',
      presets: {
        strict: { matched: [], truncated: false, errors: [] },
        tolerant: { matched: ['E1', 'E9'], truncated: false, errors: [] },
      },
    },
    {
      id: 'd2',
      source: 'typo',
      entryId: 'E2',
      presets: {
        strict: { matched: ['E2'], truncated: true, errors: [] },
        tolerant: { matched: ['E2'], truncated: true, errors: [] },
      },
    },
    {
      id: 'u1',
      source: null,
      entryId: null,
      presets: {
        strict: { matched: [], truncated: false, errors: ['result_truncated'] },
        tolerant: { matched: ['E5', 'E6'], truncated: false, errors: [] },
      },
    },
    {
      id: 'u2',
      source: null,
      entryId: null,
      presets: {
        strict: { matched: [], truncated: false, errors: [] },
        tolerant: { matched: [], truncated: true, errors: [] },
      },
    },
  ];

  it('counts recall per source, precision and the unlisted subjects’ alerts per preset', () => {
    const summary = variantSummary(observations, ['strict', 'tolerant']);

    expect(summary.tolerant?.recall.typo).toEqual({
      count: 2,
      of: 2,
      share: 1,
      wilson: wilsonInterval(2, 2),
    });
    expect(summary.strict?.overall).toEqual({
      count: 1,
      of: 2,
      share: 0.5,
      wilson: wilsonInterval(1, 2),
    });
    expect(summary.tolerant?.precision).toEqual({ expected: 2, other: 1, value: 2 / 3 });
    expect(summary.tolerant?.unlisted).toEqual({
      count: 1,
      of: 2,
      share: 0.5,
      wilson: wilsonInterval(1, 2),
      matches: 2,
    });
    expect(summary.strict?.unlisted).toMatchObject({ count: 0, of: 2, share: 0 });
    expect(summary.tolerant?.truncated).toEqual({ cases: 1, unlisted: 1 });
    expect(summary.strict?.errored).toBe(1);
  });
});

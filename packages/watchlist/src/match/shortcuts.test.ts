/**
 * Owner decision 1 after 6B: each screening shortcut keeps every created match identical, on a
 * seeded set of pairs, and does less work. The list is fixtures-6's synthetic list (fictional
 * names); the subjects are its names and variants of them made here from a seed.
 */
import { describe, expect, it } from 'vitest';
import { BUSINESS_COUNTRY_FIELDS, PERSON_COUNTRY_FIELDS } from '@openverify/core';
import { variantGroupsFrom } from '../keys/index.js';
import { analyseRecordName, setAnalysedNameCacheSize } from '../names/index.js';
import {
  resetScorerWork,
  resolveNameMatching,
  scorerWork,
  type NameMatchingConfig,
} from '../score/index.js';
import { seededRandom, syntheticWatchlist } from '../testing/index.js';
import { screenCandidates, type ScreeningOptions } from './screen.js';
import { SCREENING_SHORTCUTS, useScreeningShortcuts } from './shortcuts.js';
import { businessSubject, personSubject, type BusinessQuery, type PersonQuery } from './subject.js';

const records = syntheticWatchlist({
  seed: 'shortcuts',
  individuals: 60,
  entities: 0,
  vessels: 0,
  aircraft: 0,
  hanNames: false,
});
const candidates = records.map((record) => ({ sourceId: 'synthetic-list', record }));
const partsOf = (index: number) => {
  const primary = records[index]?.names.find((name) => name.primary);
  const part = (role: string) => primary?.parts.find((item) => item.role === role)?.value ?? '';
  return { first: part('given'), last: part('family'), full: primary?.full ?? '' };
};
// Variant groups over the list's own given names, so group pairs are scored too.
const groups = variantGroupsFrom(
  records.slice(0, 20).map((_, index) => {
    const first = partsOf(index).first.toLowerCase();
    return [`Q${String(index + 1)}`, [first, `${first}a`]];
  }),
  'c'.repeat(64),
);

/** Seeded subjects: each listed name as written, swapped, with a typo, an initial or a respelling, and strangers. */
function subjects(): PersonQuery[] {
  const random = seededRandom('shortcuts/subjects');
  const queries: PersonQuery[] = [];
  records.forEach((record, index) => {
    const { first, last, full } = partsOf(index);
    const date = record.birth_dates[0]?.value;
    const letters = Array.from(last.toLowerCase());
    const at = Math.max(1, Math.min(letters.length - 2, random.int(letters.length)));
    const typo = [...letters];
    typo[at] = random.pick(['a', 'e', 'o', 'r', 's', 'n']);
    const swapped = [...letters];
    [swapped[at], swapped[at + 1]] = [swapped[at + 1] ?? '', swapped[at] ?? ''];
    const other = partsOf((index + 7) % records.length);
    queries.push(
      { term: full },
      {
        'name-first': first,
        'name-last': last,
        ...(date === undefined ? {} : { birthdate: date }),
      },
      { term: `${last} ${first}` },
      { 'name-first': first, 'name-last': typo.join('') },
      { 'name-first': first, 'name-last': swapped.join('') },
      { term: `${first.charAt(0)}. ${last}` },
      { 'name-first': `${first}a`, 'name-last': last },
      { 'name-first': first, 'name-last': other.last, birthdate: '1971-01-01' },
      // A disagreeing birth year and country: shown (0.75 at tolerant) but below its minimum.
      {
        term: full,
        birthdate:
          date === undefined
            ? '1900-01-01'
            : `${String(Number(date.slice(0, 4)) + 10)}${date.slice(4)}`,
        'address-country-code': 'AQ',
      },
    );
  });
  return queries;
}

const PRESETS: readonly NameMatchingConfig[] = [
  { preset: 'exact' },
  { preset: 'strict' },
  { preset: 'tolerant' },
  {
    preset: 'custom',
    'min-score': 0.7,
    'allow-nicknames': true,
    'allow-variants': true,
    'typo-budget': 'high',
  },
];

const optionsFor = (config: NameMatchingConfig): ScreeningOptions => ({
  nameMatching: resolveNameMatching(config),
  birthdateMatching: 'year_plus_minus_one',
  birthdateFilter: 'penalty',
  countryFields: PERSON_COUNTRY_FIELDS,
  countryFilter: 'penalty',
  screenWeakAliases: true,
  groups,
});

const NONE = Object.fromEntries(SCREENING_SHORTCUTS.map((shortcut) => [shortcut, false]));

/** The created matches and the scorer's work of every subject at a preset. */
function screenAll(config: NameMatchingConfig, keptOnly: boolean) {
  resetScorerWork();
  const kept = subjects().map((query) =>
    screenCandidates(personSubject(query), candidates, { ...optionsFor(config), keptOnly }).filter(
      (match) => match.aboveMinimum,
    ),
  );
  return { kept, work: scorerWork() };
}

/**
 * The matches every subject creates at a preset with no shortcut on, screened once per preset and
 * shared by that preset's tests, so no test does more than one pass beyond it.
 */
const baselines = new Map<string, ReturnType<typeof screenAll>['kept']>();
function baselineOf(config: NameMatchingConfig) {
  let kept = baselines.get(config.preset);
  if (kept === undefined) {
    const restore = useScreeningShortcuts(NONE);
    kept = screenAll(config, false).kept;
    restore();
    baselines.set(config.preset, kept);
  }
  return kept;
}

const SWITCHINGS = PRESETS.flatMap((config) => [
  ...SCREENING_SHORTCUTS.map(
    (shortcut) => [config.preset, `${shortcut} alone`, config, shortcut] as const,
  ),
  [config.preset, 'all together', config, null] as const,
]);

describe('the screening shortcuts (owner decision 1 after 6B)', () => {
  it.each(PRESETS.map((config) => [config.preset, config] as const))(
    'create matches at %s with no shortcut on',
    (_, config) => {
      expect(baselineOf(config).flat().length).toBeGreaterThan(0);
    },
  );

  it.each(SWITCHINGS)(
    'keep every created match identical at %s, %s',
    (_, label, config, shortcut) => {
      const without = baselineOf(config);
      const restore = useScreeningShortcuts(shortcut === null ? {} : { ...NONE, [shortcut]: true });
      try {
        expect(screenAll(config, true).kept, label).toEqual(without);
      } finally {
        restore();
      }
    },
  );

  it('with keptOnly, return only the matches that are created', () => {
    const options = optionsFor({ preset: 'tolerant' });
    const screened = (keptOnly: boolean) =>
      subjects().flatMap((query) =>
        screenCandidates(personSubject(query), candidates, { ...options, keptOnly }),
      );
    expect(screened(false).filter((match) => !match.aboveMinimum).length).toBeGreaterThan(0);
    expect(screened(true).filter((match) => !match.aboveMinimum)).toEqual([]);
  });

  it('do less work: fewer units, pair scores and alignments for the same matches', () => {
    const tolerant: NameMatchingConfig = { preset: 'tolerant' };
    const restore = useScreeningShortcuts(NONE);
    const slow = screenAll(tolerant, true).work;
    restore();
    const fast = screenAll(tolerant, true).work;
    expect(fast.units).toBeLessThan(slow.units);
    expect(fast.pairScores).toBeLessThan(slow.pairScores);
    expect(fast.alignments).toBeLessThan(slow.alignments);
  });

  it.each([
    ['unit-lengths', 'count the code points of each unit form once', 'codePointCounts'],
    ['join-cache', "build each name's joined units once", 'joinedUnits'],
    ['indexed-matrix', "keep a name pair's token pair scores in one array, no map", 'matrixMaps'],
    ['ratio-check', 'align fewer name pairs whose best ratio cannot reach the floor', 'alignments'],
  ] as const)('with %s, %s, for the same matches', (shortcut, _, counter) => {
    // Owner decision 3 after 6C: the shortcut does less of the work it names, everything else on.
    const tolerant: NameMatchingConfig = { preset: 'tolerant' };
    const screened = (on: boolean) => {
      const restore = useScreeningShortcuts({ [shortcut]: on });
      try {
        return screenAll(tolerant, true);
      } finally {
        restore();
      }
    };
    // A first pass warms every cache, so neither measured pass finds the other's units.
    screened(true);
    const off = screened(false);
    const on = screened(true);
    expect(on.kept).toEqual(off.kept);
    expect(on.work[counter]).toBeLessThan(off.work[counter]);
  });

  it('score a list name that many entries share once per screening, and stop at an exact best pair', () => {
    // Namesakes: the same written name on 40 entries, each also listed in another order (an exact
    // alias whose bound is 1) and with another entry's names.
    const namesakes = Array.from({ length: 40 }, (_, index) => {
      const record = records[0];
      const primary = record?.names.find((name) => name.primary);
      if (record === undefined || primary === undefined) {
        throw new Error('the synthetic list is empty');
      }
      return {
        sourceId: 'synthetic-list',
        record: {
          ...record,
          entry_id: `NAMESAKE-${String(index)}`,
          names: [
            primary,
            {
              ...primary,
              full: primary.full.split(' ').reverse().join(' '),
              parts: [],
              primary: false,
            },
            ...(records[(index % 50) + 1]?.names.slice(0, 2) ?? []),
          ],
        },
      };
    });
    const query = { term: partsOf(0).full };
    const options = { ...optionsFor({ preset: 'tolerant' }), keptOnly: true };
    const work = (switches: Partial<Record<(typeof SCREENING_SHORTCUTS)[number], boolean>>) => {
      const restore = useScreeningShortcuts(switches);
      resetScorerWork();
      const kept = screenCandidates(personSubject(query), namesakes, options);
      const done = scorerWork();
      restore();
      return { kept, done };
    };
    const without = work({ 'pair-memo': false, 'exact-stop': false });
    const memo = work({ 'pair-memo': true, 'exact-stop': false });
    const stop = work({ 'pair-memo': false, 'exact-stop': true });
    expect(memo.kept).toEqual(without.kept);
    expect(stop.kept).toEqual(without.kept);
    expect(memo.done.alignments).toBeLessThan(without.done.alignments);
    expect(stop.done.alignments).toBeLessThan(without.done.alignments);
  });

  it('with token-pairs, score a subject unit against a list token once per screening, whatever names hold it, for the same matches', () => {
    // Owner decision 3 after 6C: names that share their tokens, as a heavy-headed list's do: each
    // of 40 entries pairs one of five given names with its own family name, and some carry a
    // second name in the other order.
    const parts = records.map((_, index) => partsOf(index));
    const sharing = Array.from({ length: 40 }, (_, index) => {
      const record = records[index];
      const primary = record?.names.find((name) => name.primary);
      const given = parts[index % 5]?.first ?? '';
      const family = parts[index]?.last ?? '';
      if (record === undefined || primary === undefined) {
        throw new Error('the synthetic list is empty');
      }
      return {
        sourceId: 'synthetic-list',
        record: {
          ...record,
          entry_id: `SHARING-${String(index)}`,
          names: [
            {
              ...primary,
              full: `${given} ${family}`,
              parts: [
                { role: 'given' as const, value: given },
                { role: 'family' as const, value: family },
              ],
            },
            ...(index % 2 === 0
              ? [{ ...primary, full: `${family}, ${given}`, parts: [], primary: false }]
              : []),
          ],
        },
      };
    });
    const queries = [0, 1, 2, 7].map((index) => ({
      'name-first': parts[index % 5]?.first ?? '',
      'name-last': parts[index]?.last ?? '',
    }));
    const options = { ...optionsFor({ preset: 'tolerant' }), keptOnly: true };
    const work = (on: boolean) => {
      const restore = useScreeningShortcuts({ 'token-pairs': on });
      try {
        resetScorerWork();
        const kept = queries.map((query) =>
          screenCandidates(personSubject(query), sharing, options),
        );
        return { kept, done: scorerWork() };
      } finally {
        restore();
      }
    };
    work(true);
    const off = work(false);
    const on = work(true);
    expect(on.kept).toEqual(off.kept);
    expect(on.kept.flat().length).toBeGreaterThan(0);
    expect(on.done.pairScores).toBeLessThan(off.done.pairScores);
  });

  it('analyse a list name once while it is cached, and again when the cache is off', () => {
    const [name] = records[0]?.names ?? [];
    if (name === undefined) {
      throw new Error('the synthetic list has no name');
    }
    expect(analyseRecordName(name, 'individual')).toBe(analyseRecordName(name, 'individual'));
    const restore = useScreeningShortcuts({ 'name-cache': false });
    expect(analyseRecordName(name, 'individual')).not.toBe(analyseRecordName(name, 'individual'));
    expect(analyseRecordName(name, 'individual')).toEqual(analyseRecordName(name, 'individual'));
    restore();
    const previous = setAnalysedNameCacheSize(1);
    expect(previous).toBeGreaterThan(1);
    setAnalysedNameCacheSize(previous);
  });
});

describe('the screening shortcuts on company subjects (D002)', () => {
  const entities = syntheticWatchlist({
    seed: 'shortcuts/entities',
    individuals: 0,
    entities: 40,
    vessels: 0,
    aircraft: 0,
    hanNames: false,
  });
  const entityCandidates = entities.map((record) => ({ sourceId: 'synthetic-list', record }));
  const nameOf = (record: (typeof entities)[number]) =>
    record.names.find((name) => name.primary)?.full ?? '';

  /** Seeded subjects: each listed company as written, with a typo, a suffix, and a stranger. */
  function companies(): BusinessQuery[] {
    const random = seededRandom('shortcuts/companies');
    return entities.flatMap((record) => {
      const full = nameOf(record);
      const letters = Array.from(full);
      const at = Math.max(1, Math.min(letters.length - 2, random.int(letters.length)));
      letters[at] = random.pick(['a', 'e', 'o', 'r', 's', 'n']);
      return [
        { term: full },
        { term: letters.join('') },
        { term: `${full} Limited` },
        { term: `${full} Holdings`, 'address-country-code': 'AQ' },
      ];
    });
  }

  const optionsOf = (config: NameMatchingConfig): ScreeningOptions => ({
    nameMatching: resolveNameMatching(config),
    birthdateMatching: 'year_plus_minus_one',
    birthdateFilter: 'penalty',
    countryFields: BUSINESS_COUNTRY_FIELDS,
    countryFilter: 'penalty',
    screenWeakAliases: true,
    groups,
  });

  const screened = (config: NameMatchingConfig, keptOnly: boolean) =>
    companies().map((query) =>
      screenCandidates(businessSubject(query), entityCandidates, {
        ...optionsOf(config),
        keptOnly,
      }).filter((match) => match.aboveMinimum),
    );

  const without = (config: NameMatchingConfig) => {
    const restore = useScreeningShortcuts(NONE);
    try {
      return screened(config, false);
    } finally {
      restore();
    }
  };

  it.each(PRESETS.map((config) => [config.preset, config] as const))(
    'create matches at %s with no shortcut on',
    (_, config) => {
      expect(without(config).flat().length).toBeGreaterThan(0);
    },
  );

  it.each(SWITCHINGS)(
    'keep every created match identical at %s, %s',
    (_, label, config, shortcut) => {
      const baseline = without(config);
      const restore = useScreeningShortcuts(shortcut === null ? {} : { ...NONE, [shortcut]: true });
      try {
        expect(screened(config, true), label).toEqual(baseline);
      } finally {
        restore();
      }
    },
  );
});

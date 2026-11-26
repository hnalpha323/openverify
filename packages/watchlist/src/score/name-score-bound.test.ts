/**
 * C78.7: the name score's upper bound never falls below the score, on every pair of a set of
 * fictional names that exercises each rule, under every preset, and is low for unrelated names.
 */
import { describe, expect, it } from 'vitest';
import { variantGroupsFrom } from '../keys/index.js';
import { analyseBusinessName, analysePersonName } from '../names/index.js';
import {
  createTokenPairMemo,
  nameScoreUpperBound,
  resetScorerWork,
  resolveNameMatching,
  scoreNamePair,
  scoreNamePairAbove,
  scorerWork,
  setScorerShortcuts,
} from './index.js';

const groups = variantGroupsFrom(
  [
    ['Q1', ['mohammed', 'muhammad', 'магомед']],
    ['Q2', ['abdulrahman', 'abd al rahman']],
  ],
  'a'.repeat(64),
);
const PERSON_NAMES = [
  'Orlan Vexby',
  'VEXBY, Orlan',
  'Orlan Vexbi',
  'O. Vexby',
  'Vexby Orlan Jr',
  'Orlan Vexby Sr',
  'Ahmed al Rashid',
  'Ahmed Rashid',
  'Abdul Rahman Hartwell',
  'Abdulrahman Hartwell',
  'Mohammed Hartwell',
  'Muhammad Hartwell',
  'Магомед Хартвелл',
  'Иван Петров',
  'Ivan Petrov',
  '王小明',
  'Wang Xiaoming',
  'Bill Hartwell',
  'William Hartwell',
  'Maria Elena Hartwell Lopez',
  'Maria Hartwell',
  'Velina Xyzqa',
  'Hartwell',
];
const PERSONS = PERSON_NAMES.map((name) => analysePersonName(name));
const BUSINESS_NAMES = [
  'Acme Trading LLC',
  'Acme Trading Ltd',
  'Acme Trading JSC',
  'The Acme Holdings',
  'I.B.M. Corp',
  'IBM Corporation',
];
const BUSINESSES = BUSINESS_NAMES.map((name) => analyseBusinessName(name));
const PRESETS = [
  resolveNameMatching({ preset: 'strict' }),
  resolveNameMatching({ preset: 'tolerant' }),
  resolveNameMatching({
    preset: 'custom',
    'min-score': 0.7,
    'allow-nicknames': true,
    'allow-variants': true,
    'typo-budget': 'high',
  }),
];

describe('nameScoreUpperBound', () => {
  it('is never below the score', () => {
    let pairs = 0;
    for (const names of [PERSONS, BUSINESSES]) {
      for (const subject of names) {
        for (const list of names) {
          for (const matching of PRESETS) {
            const { score } = scoreNamePair(subject, list, matching, groups);
            const bound = nameScoreUpperBound(subject, list, matching, groups);
            expect(bound + 1e-12, `${subject.text} / ${list.text}`).toBeGreaterThanOrEqual(score);
            pairs += 1;
          }
        }
      }
    }
    expect(pairs).toBe((23 * 23 + 6 * 6) * 3);
  });

  it('is the same, as is the score, with the scorer shortcuts of owner decision 3 after 6C off', () => {
    const everyPair = () =>
      [PERSONS, BUSINESSES].flatMap((names) =>
        names.flatMap((subject) =>
          names.flatMap((list) =>
            PRESETS.map((matching) => [
              nameScoreUpperBound(subject, list, matching, groups),
              scoreNamePair(subject, list, matching, groups),
            ]),
          ),
        ),
      );
    const on = everyPair();
    for (const [unitLengths, joinCache] of [
      [false, true],
      [true, false],
      [false, false],
    ] as const) {
      setScorerShortcuts({ unitCache: true, sharedMatrix: true, unitLengths, joinCache });
      try {
        expect(
          everyPair(),
          `unit-lengths ${String(unitLengths)}, join-cache ${String(joinCache)}`,
        ).toEqual(on);
      } finally {
        setScorerShortcuts({
          unitCache: true,
          sharedMatrix: true,
          unitLengths: true,
          joinCache: true,
        });
      }
    }
  });

  it.each([
    ['the indexed matrix', { indexedMatrix: false }],
    ['the ratio check', { ratioCheck: false }],
    ['the token pairs', { tokenPairs: false }],
  ] as const)('gives every pair the same bound decision and score with %s off', (_, off) => {
    const everyPair = () =>
      [PERSONS, BUSINESSES].flatMap((names) =>
        names.flatMap((subject) =>
          names.flatMap((list) =>
            PRESETS.flatMap((matching) =>
              [0, 0.5, 0.7, 0.85, 0.9].flatMap((floor) =>
                [false, true].map((strict) => ({
                  floor,
                  score: scoreNamePairAbove(subject, list, matching, groups, floor, { strict }),
                })),
              ),
            ),
          ),
        ),
      );
    const on = everyPair();
    setScorerShortcuts({ unitCache: true, sharedMatrix: true, ...off });
    let without: typeof on;
    try {
      without = everyPair();
    } finally {
      setScorerShortcuts({
        unitCache: true,
        sharedMatrix: true,
        indexedMatrix: true,
        ratioCheck: true,
        tokenPairs: true,
      });
    }
    // A pair is returned with the same score either way; the ratio check may refuse, as the bound
    // does, a pair whose score is below the floor, which could not be returned.
    expect(on.filter(({ score }) => score !== null)).toEqual(
      without.filter(({ score }, index) => score !== null && on[index]?.score !== null),
    );
    on.forEach(({ floor, score }, index) => {
      const other = without[index]?.score;
      if (score === null) {
        expect(other === null || (other !== undefined && other.score < floor)).toBe(true);
      }
    });
    expect(on.length).toBe(without.length);
    if ('ratioCheck' in off) {
      expect(on.filter(({ score }) => score === null).length).toBeGreaterThan(
        without.filter(({ score }) => score === null).length,
      );
    }
  });

  it('is low for names that share one token, and exact under exact', () => {
    const strict = resolveNameMatching({ preset: 'strict' });
    expect(
      nameScoreUpperBound(
        analysePersonName('Velina Xyzqa'),
        analysePersonName('VELINA, Abcde'),
        strict,
        groups,
      ),
    ).toBeLessThan(0.7);
    const exact = resolveNameMatching({ preset: 'exact' });
    expect(
      nameScoreUpperBound(
        analysePersonName('Vexby Orlan'),
        analysePersonName('Orlan Vexby'),
        exact,
        groups,
      ),
    ).toBe(1);
    expect(
      nameScoreUpperBound(
        analysePersonName('Orlan Vexbi'),
        analysePersonName('Orlan Vexby'),
        exact,
        groups,
      ),
    ).toBe(0);
  });
});

/**
 * C271.2 (Workflow 11D, `matcher-c787-11d`; the lever `rescreen-bound-memo`): the re-screen's
 * name-bound check passes one token pair memo to every bound it computes, so a token pair met by
 * many subjects' names (names analysed apart share their tokens) is scored once per re-screen. A
 * pair's score reads only the two tokens, the variant groups and the matching (with whether the
 * subject has one name word), so every bound is the one computed without it.
 */
describe('nameScoreUpperBound with a token pair memo (C271.2)', () => {
  const EVERY_PRESET = [resolveNameMatching({ preset: 'exact' }), ...PRESETS];
  /** Every (subject, list) bound at every preset, persons with persons and companies with companies. */
  const bounds = (
    persons: readonly ReturnType<typeof analysePersonName>[],
    businesses: readonly ReturnType<typeof analyseBusinessName>[],
    memo?: ReturnType<typeof createTokenPairMemo>,
  ) =>
    [
      [persons, PERSONS],
      [businesses, BUSINESSES],
    ].flatMap(([subjects, lists]) =>
      (subjects ?? []).flatMap((subject) =>
        (lists ?? []).flatMap((list) =>
          EVERY_PRESET.map((matching) =>
            nameScoreUpperBound(subject, list, matching, groups, memo),
          ),
        ),
      ),
    );
  /** The names analysed again: new names (and units) whose tokens are the ones kept. */
  const fresh = () => ({
    persons: PERSON_NAMES.map((name) => analysePersonName(name)),
    businesses: BUSINESS_NAMES.map((name) => analyseBusinessName(name)),
  });

  it('gives every pair the same bound at every preset, persons and companies, and scores a token pair, and bounds a name pair, once across subjects', () => {
    const first = fresh();
    const reference = bounds(first.persons, first.businesses);
    expect(reference).toHaveLength((23 * 23 + 6 * 6) * 4);

    const memo = createTokenPairMemo();
    const again = fresh();
    expect(bounds(again.persons, again.businesses, memo)).toEqual(reference);
    expect(memo.size).toBeGreaterThan(0);

    // Subjects analysed apart (another report's subject of the same name) meet the kept pairs.
    const later = fresh();
    resetScorerWork();
    expect(bounds(later.persons, later.businesses, memo)).toEqual(reference);
    expect(scorerWork().pairScores).toBe(0);
    // Nor is a name pair bounded again: a subject of the same name meets the kept bound.
    expect(scorerWork().bounds).toBe(0);
    // Without the memo the same new subjects score their token pairs again.
    const without = fresh();
    resetScorerWork();
    expect(bounds(without.persons, without.businesses)).toEqual(reference);
    expect(scorerWork().pairScores).toBeGreaterThan(0);
    expect(scorerWork().bounds).toBe((23 * 23 + 6 * 6) * 3);
  });

  it('holds at most its limit of token pairs, starting again when full, with the same bounds', () => {
    const reference = bounds(PERSONS, BUSINESSES);
    const memo = createTokenPairMemo(5);
    const { persons, businesses } = fresh();
    expect(bounds(persons, businesses, memo)).toEqual(reference);
    expect(memo.limit).toBe(5);
    expect(memo.size).toBeGreaterThan(0);
    expect(memo.size).toBeLessThanOrEqual(5);
  });

  it.each([
    ['the token pairs', { tokenPairs: false }],
    ['the indexed matrix', { indexedMatrix: false }],
    ['the shared matrix', { sharedMatrix: false }],
  ] as const)('gives the same bounds with %s off', (_, off) => {
    const reference = bounds(PERSONS, BUSINESSES);
    setScorerShortcuts({ unitCache: true, sharedMatrix: true, ...off });
    try {
      const { persons, businesses } = fresh();
      expect(bounds(persons, businesses, createTokenPairMemo())).toEqual(reference);
    } finally {
      setScorerShortcuts({
        unitCache: true,
        sharedMatrix: true,
        indexedMatrix: true,
        tokenPairs: true,
      });
    }
  });
});

describe('the bound memo keys a subject name by its tokens in order (C271.2)', () => {
  it('never gives one name the bound of another that differs only in a token, its role or its order', () => {
    const matching = resolveNameMatching({ preset: 'tolerant' });
    const list = analysePersonName('Orlan Vexby');
    const subjects = [
      analysePersonName('Orlan Vexby'),
      analysePersonName('VEXBY, Orlan'),
      analysePersonName({ first: 'Orlan', last: 'Vexby' }),
      analysePersonName({ first: 'Vexby', last: 'Orlan' }),
      analysePersonName('Vexby Orlan'),
      analysePersonName('Orlan Vexbi'),
      analysePersonName('Orlan'),
      analysePersonName('Orlan Vexby Jr'),
    ];
    const memo = createTokenPairMemo();
    for (const subject of subjects) {
      expect(nameScoreUpperBound(subject, list, matching, groups, memo), subject.text).toBe(
        nameScoreUpperBound(subject, list, matching, groups),
      );
    }
    // Again, in the other order, each against the kept bounds.
    for (const subject of [...subjects].reverse()) {
      expect(nameScoreUpperBound(subject, list, matching, groups, memo), subject.text).toBe(
        nameScoreUpperBound(subject, list, matching, groups),
      );
    }
  });
});

/**
 * C78.4: the name score, rule by rule, on fictional names. Expected scores are worked out from the
 * C78.4 constants: pair score times weight, over matched weights plus unmatched weights.
 */
import { areNicknames, jaroWinkler } from '@openverify/checks';
import { describe, expect, it } from 'vitest';
import { variantGroupsFrom } from '../keys/index.js';
import {
  analyseBusinessName,
  analysePersonName,
  type AnalysedName,
  type PersonNameFields,
} from '../names/index.js';
import { resolveNameMatching, scoreNamePair } from './index.js';

const groups = variantGroupsFrom([['Q1', ['mohammed', 'muhammad', 'магомед']]], 'a'.repeat(64));
const exact = resolveNameMatching({ preset: 'exact' });
const strict = resolveNameMatching({ preset: 'strict' });
const tolerant = resolveNameMatching({ preset: 'tolerant' });
const person = (name: string | PersonNameFields): AnalysedName => analysePersonName(name);
const score = (
  subject: string | PersonNameFields,
  list: string | PersonNameFields,
  matching = strict,
) => scoreNamePair(person(subject), person(list), matching, groups);

describe('equal tokens and order', () => {
  it('scores the same name, in any order, at 1 and calls it exact', () => {
    expect(score('John Smith', 'SMITH, John')).toEqual({
      score: 1,
      exact: true,
      methods: ['equal'],
      lossy: false,
    });
    expect(score('Smith John', 'John Smith').score).toBe(1);
  });

  it('multiplies a known given and family role swap by 0.95', () => {
    const swapped = score({ first: 'Smith', last: 'John' }, 'SMITH, John');
    expect(swapped.score).toBeCloseTo(0.95, 10);
    expect(swapped.methods).toEqual(['equal', 'role-swap']);
  });

  it('weighs a family name 1.3 and the unmatched tokens 0.8 and 0.2', () => {
    // anna-anna 1 at weight 1; Hartwell (subject family) 0.8 x 1.3; Hartwick (list family) 0.2 x 1.3.
    expect(score({ first: 'Anna', last: 'Hartwell' }, 'HARTWICK, Anna').score).toBeCloseTo(
      1 / (1 + 1.04 + 0.26),
      10,
    );
    expect(score('Anna Hartwell', 'Anna Hartwick').score).toBeCloseTo(1 / (1 + 0.8 + 0.2), 10);
  });
});

describe('the presets as rule sets (C79.1)', () => {
  it('exact needs equal names and scores nothing else', () => {
    expect(score('Smith John', 'John Smith', exact)).toMatchObject({ score: 1, exact: true });
    expect(score('Jon Smith', 'John Smith', exact)).toMatchObject({ score: 0, exact: false });
  });

  it('allows typos only under tolerant, within the medium budget', () => {
    const typo = jaroWinkler('smyth', 'smith');
    expect(typo).toBeGreaterThanOrEqual(0.88);
    expect(score('Jonathan Smyth', 'Jonathan Smith', tolerant)).toMatchObject({
      methods: ['equal', 'typo'],
    });
    expect(score('Jonathan Smyth', 'Jonathan Smith', tolerant).score).toBeCloseTo(
      (1 + typo) / 2,
      10,
    );
    expect(score('Jonathan Smyth', 'Jonathan Smith', strict).score).toBeCloseTo(0.5, 10);
    const low = resolveNameMatching({ preset: 'custom', 'min-score': 0.7, 'typo-budget': 'low' });
    expect(score('Jonathan Smyth', 'Jonathan Smith', low).score).toBeCloseTo(0.5, 10);
  });

  it('counts an adjacent transposition as one typo, within the same budget (owner decision 4 after 6B)', () => {
    const swapped = jaroWinkler('quillfeahter', 'quillfeather');
    expect(swapped).toBeGreaterThanOrEqual(0.88);
    expect(score('Avery Quillfeahter', 'Avery Quillfeather', tolerant)).toMatchObject({
      methods: ['equal', 'typo'],
    });
    expect(score('Avery Quillfeahter', 'Avery Quillfeather', tolerant).score).toBeCloseTo(
      (1 + swapped) / 2,
      10,
    );
    // A transposition and a substitution are two edits: beyond the budget.
    expect(score('Avery Quilfleahter', 'Avery Quillfeather', tolerant).score).toBeCloseTo(0.5, 10);
    // A token shorter than the budget's length allows no typo at all.
    expect(score('Avery Loi', 'Avery Lio', tolerant).score).toBeCloseTo(0.5, 10);
    expect(score('Avery Quillfeahter', 'Avery Quillfeather', strict).score).toBeCloseTo(0.5, 10);
  });

  it('allows nicknames only under tolerant', () => {
    expect(areNicknames('bill', 'william')).toBe(true);
    expect(score('Bill Hartwell', 'William Hartwell', tolerant).score).toBeCloseTo(0.9, 10);
    expect(score('Bill Hartwell', 'William Hartwell', strict).score).toBeCloseTo(0.5, 10);
  });

  it('allows a same-script variant group only under tolerant', () => {
    expect(score('Mohammed Hartwell', 'Muhammad Hartwell', tolerant).score).toBeCloseTo(0.95, 10);
    expect(score('Mohammed Hartwell', 'Muhammad Hartwell', strict).score).toBeCloseTo(0.5, 10);
  });
});

describe('the strict rules', () => {
  it('scores an initial 0.9 at weight 0.5', () => {
    const initial = score('J. Hartwell', 'John Hartwell');
    expect(initial.score).toBeCloseTo((0.9 * 0.5 + 1) / (0.5 + 1), 10);
    expect(initial.methods).toEqual(['equal', 'initial']);
  });

  it('compares two adjacent tokens of either side as one (joined)', () => {
    expect(score('Abdul Rahman Hartwell', 'Abdulrahman Hartwell')).toMatchObject({
      score: 1,
      methods: ['equal', 'joined'],
    });
    expect(score('Abdulrahman Hartwell', 'Abdul Rahman Hartwell').score).toBe(1);
  });

  it('weighs the unmatched tokens of the longer name 0.2 when the shorter is matched (subset)', () => {
    const subset = score('Maria Elena Hartwell Lopez', 'Maria Hartwell');
    expect(subset.score).toBeCloseTo(2 / (2 + 0.2 + 0.2), 10);
    expect(subset.methods).toContain('subset');
    expect(score('Maria Hartwell', 'Maria Elena Hartwell Lopez').score).toBeCloseTo(2 / 2.4, 10);
    // The shorter name needs two tokens.
    expect(score('Maria Elena Lopez', 'Maria').score).toBeCloseTo(1 / (1 + 0.8 + 0.8), 10);
  });

  it('weighs particles 0.5', () => {
    expect(score('Ahmed al Rashid', 'Ahmed Rashid').score).toBeCloseTo(2 / (2 + 0.2 * 0.5), 10);
  });

  it('compares Cyrillic through ICAO 9303 §6.B, and other scripts through variant groups', () => {
    expect(score('Иван Петров', 'Ivan Petrov')).toEqual({
      score: 1,
      exact: true,
      methods: ['icao-transliteration'],
      lossy: false,
    });
    expect(score('Магомед', 'Mohammed')).toMatchObject({
      score: 0.9,
      methods: ['variant-group'],
    });
  });

  it('caps a pair resting on a lossy form at 0.8', () => {
    expect(score('王小明', 'Wang Xiaoming', tolerant)).toEqual({
      score: 0.8,
      exact: false,
      methods: ['joined', 'lossy-transliteration'],
      lossy: true,
    });
  });
});

describe('single-token subjects, suffixes and legal forms', () => {
  it('needs an exact or group match for a single-token subject', () => {
    expect(score('Hartwel', 'Hartwell', tolerant).score).toBe(0);
    expect(score('Hartwell', 'John Hartwell').score).toBeCloseTo(1 / 1.2, 10);
  });

  it('weighs a suffix on one side only nothing, and different suffixes as unmatched', () => {
    expect(score('John Smith Jr', 'John Smith').score).toBe(1);
    expect(score('John Smith Jr', 'John Smith Sr').score).toBeCloseTo(2 / 3, 10);
  });

  it('pairs legal forms by their key, at weight 0.5 as generic words', () => {
    const business = (a: string, b: string) =>
      scoreNamePair(analyseBusinessName(a), analyseBusinessName(b), strict, groups);
    expect(business('Acme Trading LLC', 'Acme Trading Ltd')).toMatchObject({
      score: 1,
      exact: true,
      methods: ['equal', 'legal-form'],
    });
    expect(business('Acme Trading LLC', 'Acme Trading JSC').score).toBeCloseTo(1.5 / 2, 10);
  });
});

describe('bounded work', () => {
  it('scores two names of 32 tokens each', () => {
    const long = Array.from({ length: 32 }, (_, index) => `token${String(index)}`).join(' ');
    expect(score(long, long, tolerant).score).toBe(1);
  });
});

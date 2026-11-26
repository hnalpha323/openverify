import {
  MATCH_LEVELS,
  REPORT_MATCH_QUALIFIERS,
  REPORT_MATCH_STATUSES,
  REPORT_MATCH_TYPES,
  REPORT_REVIEW_STATUSES,
  REPORT_RISK_LEVELS,
} from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  MATCH_LEVEL_LABELS,
  REPORT_MATCH_QUALIFIER_WORDS,
  REPORT_MATCH_STATUS_LABELS,
  REPORT_MATCH_TYPE_WORDS,
  REPORT_REVIEW_STATUS_LABELS,
  REPORT_RISK_LEVEL_LABELS,
  matchMethodWords,
  qualifierText,
} from './report-match-words';

const WORDS = /^[A-Z][^_]*$/;

describe('match evidence in words (C78.4, C78.5, C86)', () => {
  it.each(REPORT_MATCH_TYPES)('says the match type %s in words', (type) => {
    expect(REPORT_MATCH_TYPE_WORDS[type]).toMatch(WORDS);
  });

  it.each(REPORT_MATCH_QUALIFIERS)('says the qualifier %s in words', (qualifier) => {
    expect(REPORT_MATCH_QUALIFIER_WORDS[qualifier]).toMatch(WORDS);
  });

  it.each(MATCH_LEVELS)('labels the name level %s', (level) => {
    expect(MATCH_LEVEL_LABELS[level]).toMatch(WORDS);
  });

  it('words exactly the contract values, each in its order', () => {
    expect(Object.keys(REPORT_MATCH_TYPE_WORDS)).toEqual([...REPORT_MATCH_TYPES]);
    expect(Object.keys(REPORT_MATCH_QUALIFIER_WORDS)).toEqual([...REPORT_MATCH_QUALIFIERS]);
    expect(Object.keys(MATCH_LEVEL_LABELS)).toEqual([...MATCH_LEVELS]);
  });

  it('says each qualifier with the score change it applied (C78.4)', () => {
    expect(qualifierText('country_mismatch')).toBe('Countries differ (−0.10)');
    expect(qualifierText('dob_exact')).toBe('Date of birth equal (+0.05)');
    expect(qualifierText('dob_day_disjoint')).toBe('Birth dates differ by more than a day (−0.25)');
  });

  it.each([
    ['equal', 'Equal after normalisation'],
    ['variant-group', 'Same name in a variant group'],
    ['typo', 'A typo within the budget'],
    ['identifier-exact', 'Identifier equal'],
    ['crypto-address-exact', 'Crypto address equal'],
    ['lossy-transliteration', 'Lossy transliteration (score capped)'],
  ])('says the method %s in words', (method, words) => {
    expect(matchMethodWords(method)).toBe(words);
  });

  it.each(['jaro-winkler-9', 'constructor', '__proto__'])(
    'knows nothing of the method %s, which shows as its code',
    (method) => {
      expect(matchMethodWords(method)).toBeUndefined();
    },
  );
});

describe('where a match stands (C75.8)', () => {
  it.each(REPORT_MATCH_STATUSES)('labels the match status %s', (status) => {
    expect(REPORT_MATCH_STATUS_LABELS[status]).toMatch(WORDS);
  });

  it.each(REPORT_REVIEW_STATUSES)('labels the review status %s', (status) => {
    expect(REPORT_REVIEW_STATUS_LABELS[status]).toMatch(WORDS);
  });

  it.each(REPORT_RISK_LEVELS)('labels the risk level %s', (level) => {
    expect(REPORT_RISK_LEVEL_LABELS[level]).toMatch(WORDS);
  });

  it('labels exactly the contract values, each in its order', () => {
    expect(Object.keys(REPORT_MATCH_STATUS_LABELS)).toEqual([...REPORT_MATCH_STATUSES]);
    expect(Object.keys(REPORT_REVIEW_STATUS_LABELS)).toEqual([...REPORT_REVIEW_STATUSES]);
    expect(Object.keys(REPORT_RISK_LEVEL_LABELS)).toEqual([...REPORT_RISK_LEVELS]);
  });
});

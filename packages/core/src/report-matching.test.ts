import { describe, expect, it } from 'vitest';
import {
  CUSTOM_MIN_SCORE_RANGE,
  NAME_MATCHING_PRESET_MINIMUMS,
  NAME_MATCHING_PRESET_RULES,
  NAME_MATCHING_RULES,
  REPORT_MATCH_QUALIFIERS,
  SCREENING_CONSTANTS,
  SCREENING_CONSTANT_NAMES,
  TOLERANT_TYPO_BUDGET,
  TYPO_BUDGET_MIN_TOKEN_LENGTH,
  TYPO_EDIT_DISTANCE,
  keyFrequencyBound,
  presetRules,
  qualifierAdjustment,
} from './report-matching.js';

const value = (name: (typeof SCREENING_CONSTANT_NAMES)[number]) => SCREENING_CONSTANTS[name].value;

describe('SCREENING_CONSTANTS (C78.4)', () => {
  it('fixes the plan values', () => {
    expect(Object.fromEntries(SCREENING_CONSTANT_NAMES.map((name) => [name, value(name)]))).toEqual(
      {
        'token-equal': 1,
        'token-variant-group': 0.9,
        'token-nickname': 0.8,
        'token-initial': 0.9,
        'token-initial-weight': 0.5,
        'jaro-winkler-minimum': 0.88,
        'jaro-winkler-prefix-gate': 0.7,
        'lossy-pair-cap': 0.8,
        'family-name-weight': 1.3,
        'unmatched-subject-token-weight': 0.8,
        'unmatched-list-token-weight': 0.2,
        'particle-weight': 0.5,
        'role-swap-factor': 0.95,
        'subset-unmatched-weight': 0.2,
        'qualifier-floor': 0.7,
        'dob-day-disjoint': -0.25,
        'dob-transposed': -0.1,
        'dob-year-disjoint': -0.15,
        'dob-circa-years': 1,
        'dob-exact': 0.05,
        'country-mismatch': -0.1,
        'gender-mismatch': -0.1,
        'identifier-match-floor': 0.95,
        'weak-alias-score': 0.9,
        'display-floor': 0.7,
        'candidate-cap': 2000,
        'key-frequency-bound-share': 0.25,
        'pair-max-tokens': 6,
        'pair-max-groups': 4,
        'variant-group-max-forms': 60,
      },
    );
  });

  it('marks every constant provisional, with a source that names its contract (decision 15)', () => {
    expect(Object.keys(SCREENING_CONSTANTS)).toEqual([...SCREENING_CONSTANT_NAMES]);
    for (const name of SCREENING_CONSTANT_NAMES) {
      expect(SCREENING_CONSTANTS[name].basis, name).toBe('provisional');
      expect(SCREENING_CONSTANTS[name].source, name).toMatch(/C78\.[34]/);
      expect(Object.isFrozen(SCREENING_CONSTANTS[name])).toBe(true);
    }
    expect(Object.isFrozen(SCREENING_CONSTANTS)).toBe(true);
  });

  it('bounds a key by entries, a share of the candidate cap, whatever the size of the source (owner decision 1 after 6B)', () => {
    expect(keyFrequencyBound(2000)).toBe(500);
    expect(keyFrequencyBound(40)).toBe(10);
    expect(keyFrequencyBound(3)).toBe(1);
    expect(keyFrequencyBound(SCREENING_CONSTANTS['candidate-cap'].value)).toBeLessThan(
      SCREENING_CONSTANTS['candidate-cap'].value,
    );
    expect(SCREENING_CONSTANT_NAMES).not.toContain('key-document-frequency-max');
    const sourceOf = (name: string) =>
      (SCREENING_CONSTANTS as Readonly<Record<string, { source: string } | undefined>>)[name]
        ?.source;
    for (const name of ['key-frequency-bound-share', 'pair-max-tokens', 'pair-max-groups']) {
      // The Workflow 6C calibration kept them (decision 1); H-tier, so the basis stays provisional.
      expect(sourceOf(name), name).toMatch(
        /development tables, seed a362daebb975e71a3e330ffe86234816; kept by docs\/calibration\/watchlist-phase6c\.md \(evaluation seed e8223c34916200e2b8e51f0b47981804, decision 1\): /,
      );
    }
  });

  it('adjusts a score by each qualifier', () => {
    expect(REPORT_MATCH_QUALIFIERS.map((qualifier) => qualifierAdjustment(qualifier))).toEqual([
      -0.25, -0.1, -0.15, 0.05, -0.1, -0.1,
    ]);
  });
});

describe('the name-matching presets (C79.1, H11)', () => {
  const STRICT = [
    'equal_tokens',
    'original_script_equal',
    'icao_transliteration_equal',
    'cross_script_variant_group',
    'initials',
    'joined_tokens',
    'subset',
  ];

  it('are method sets: exact has no pair rule, strict no nickname, spelling variant or typo', () => {
    expect(NAME_MATCHING_PRESET_RULES).toEqual({
      exact: [],
      strict: STRICT,
      tolerant: [...STRICT, 'nicknames', 'same_script_variant_group', 'typos'],
    });
    for (const rules of Object.values(NAME_MATCHING_PRESET_RULES)) {
      expect(rules.every((rule) => NAME_MATCHING_RULES.includes(rule))).toBe(true);
    }
  });

  it('create a match at 0.85 under strict and 0.80 under tolerant; exact has no minimum', () => {
    expect(NAME_MATCHING_PRESET_MINIMUMS.exact).toBeNull();
    expect(NAME_MATCHING_PRESET_MINIMUMS.strict?.value).toBe(0.85);
    expect(NAME_MATCHING_PRESET_MINIMUMS.tolerant?.value).toBe(0.8);
    expect(NAME_MATCHING_PRESET_MINIMUMS.strict?.basis).toBe('provisional');
    expect(NAME_MATCHING_PRESET_MINIMUMS.tolerant?.source).toMatch(/C79\.1/);
    expect(CUSTOM_MIN_SCORE_RANGE).toEqual({ min: 0.7, max: 1 });
  });

  it('count an adjacent transposition as one typo: the optimal string alignment distance (owner decision 4 after 6B)', () => {
    expect(TYPO_EDIT_DISTANCE.value).toBe('optimal_string_alignment');
    expect(TYPO_EDIT_DISTANCE.basis).toBe('provisional');
    expect(TYPO_EDIT_DISTANCE.source).toMatch(/C78\.4/);
    expect(TYPO_EDIT_DISTANCE.source).toMatch(
      /; kept by docs\/calibration\/watchlist-phase6c\.md: no rise in false alerts \(persons −12\.7 and −90\.1 per 1,000 at 100,000 and 2,000,000 names, companies unchanged\)$/,
    );
  });

  it('allow one typo per token of 18, 5 or 3 characters, tolerant at medium', () => {
    expect(TYPO_BUDGET_MIN_TOKEN_LENGTH).toEqual({ none: null, low: 18, medium: 5, high: 3 });
    expect(TOLERANT_TYPO_BUDGET).toBe('medium');
  });

  it('builds a custom preset from strict plus what it allows', () => {
    expect(presetRules('custom')).toEqual(STRICT);
    expect(presetRules('custom', { allowNicknames: true, typoBudget: 'low' })).toEqual([
      ...STRICT,
      'nicknames',
      'typos',
    ]);
    expect(presetRules('custom', { allowVariants: true, typoBudget: 'none' })).toEqual([
      ...STRICT,
      'same_script_variant_group',
    ]);
    expect(presetRules('tolerant')).toBe(NAME_MATCHING_PRESET_RULES.tolerant);
  });
});

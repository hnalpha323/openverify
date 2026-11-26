/** C79.1: the presets as rule sets with their minimums, and the thresholds a report serves. */
import { NAME_MATCHING_PRESET_RULES } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { resolveNameMatching, screeningThresholds } from './index.js';

describe('resolveNameMatching', () => {
  it('gives exact no rule and no minimum', () => {
    expect(resolveNameMatching({ preset: 'exact' })).toEqual({
      preset: 'exact',
      rules: new Set(),
      typoBudget: 'none',
      minScore: null,
    });
  });

  it('gives strict and tolerant their rule sets, minimums and typo budgets', () => {
    expect(resolveNameMatching({ preset: 'strict' })).toEqual({
      preset: 'strict',
      rules: new Set(NAME_MATCHING_PRESET_RULES.strict),
      typoBudget: 'none',
      minScore: 0.85,
    });
    expect(resolveNameMatching({ preset: 'tolerant' })).toEqual({
      preset: 'tolerant',
      rules: new Set(NAME_MATCHING_PRESET_RULES.tolerant),
      typoBudget: 'medium',
      minScore: 0.8,
    });
  });

  it('builds custom from its options, with no typo unless a budget is chosen', () => {
    const custom = resolveNameMatching({
      preset: 'custom',
      'min-score': 0.9,
      'allow-nicknames': true,
      'typo-budget': 'low',
    });
    expect(custom.minScore).toBe(0.9);
    expect(custom.typoBudget).toBe('low');
    expect(custom.rules.has('nicknames')).toBe(true);
    expect(custom.rules.has('typos')).toBe(true);
    expect(custom.rules.has('same_script_variant_group')).toBe(false);
    const plain = resolveNameMatching({ preset: 'custom', 'min-score': 0.75 });
    expect(plain.typoBudget).toBe('none');
    expect(plain.rules).toEqual(new Set(NAME_MATCHING_PRESET_RULES.strict));
  });
});

describe('screeningThresholds', () => {
  it('serves the preset and every threshold applied (ADR 0002 §3f)', () => {
    expect(screeningThresholds(resolveNameMatching({ preset: 'tolerant' }))).toEqual({
      preset: 'tolerant',
      'min-score': 0.8,
      'typo-budget': 'medium',
      'display-floor': 0.7,
      'qualifier-floor': 0.7,
      'identifier-match-floor': 0.95,
      'weak-alias-score': 0.9,
    });
    expect(screeningThresholds(resolveNameMatching({ preset: 'exact' }))).not.toHaveProperty(
      'min-score',
    );
  });
});

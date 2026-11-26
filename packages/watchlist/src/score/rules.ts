/**
 * C79.1: a template's `name-matching` as the rule set the scorer applies. Each preset is a set of
 * the C78.4 rules plus a minimum (`NAME_MATCHING_PRESET_RULES`, `NAME_MATCHING_PRESET_MINIMUMS`,
 * core): `exact` enables none (a strong list name equal to a subject name after normalisation, in
 * any token order); `strict` the same name in another script, as initials, joined or as a subset;
 * `tolerant` adds nicknames, same-script variants and typos within the medium budget; `custom`
 * chooses with `allow-nicknames`, `allow-variants`, `typo-budget` and `min-score`.
 */
import {
  NAME_MATCHING_PRESET_MINIMUMS,
  NAME_MATCHING_PRESET_RULES,
  SCREENING_CONSTANTS,
  TOLERANT_TYPO_BUDGET,
  presetRules,
  type NameMatchingPreset,
  type NameMatchingRule,
  type TypoBudget,
} from '@openverify/core';

/** A template's `name-matching` (contracts `nameMatchingConfigSchema`). */
export interface NameMatchingConfig {
  readonly preset: NameMatchingPreset;
  readonly 'min-score'?: number | undefined;
  readonly 'allow-nicknames'?: boolean | undefined;
  readonly 'allow-variants'?: boolean | undefined;
  readonly 'typo-budget'?: TypoBudget | undefined;
}

export interface ResolvedNameMatching {
  readonly preset: NameMatchingPreset;
  readonly rules: ReadonlySet<NameMatchingRule>;
  /** `none` unless the preset allows typos. */
  readonly typoBudget: TypoBudget;
  /** The score a match is created at; `null` for `exact`, which has no score to clear. */
  readonly minScore: number | null;
}

/** Resolves a template's `name-matching` into the rules and minimum the scorer applies. */
export function resolveNameMatching(config: NameMatchingConfig): ResolvedNameMatching {
  const { preset } = config;
  if (preset === 'custom') {
    const minScore = config['min-score'];
    if (minScore === undefined) {
      throw new Error('a custom name-matching needs its min-score');
    }
    const typoBudget = config['typo-budget'] ?? 'none';
    return {
      preset,
      rules: new Set(
        presetRules('custom', {
          allowNicknames: config['allow-nicknames'] ?? false,
          allowVariants: config['allow-variants'] ?? false,
          typoBudget,
        }),
      ),
      typoBudget,
      minScore,
    };
  }
  return {
    preset,
    rules: new Set(NAME_MATCHING_PRESET_RULES[preset]),
    typoBudget: preset === 'tolerant' ? TOLERANT_TYPO_BUDGET : 'none',
    minScore: NAME_MATCHING_PRESET_MINIMUMS[preset]?.value ?? null,
  };
}

/** ADR 0002 §3f: the preset and thresholds applied, as a report's `thresholds` serves them. */
export function screeningThresholds(
  matching: ResolvedNameMatching,
): Record<string, string | number | boolean> {
  return {
    preset: matching.preset,
    ...(matching.minScore === null ? {} : { 'min-score': matching.minScore }),
    'typo-budget': matching.typoBudget,
    'display-floor': SCREENING_CONSTANTS['display-floor'].value,
    'qualifier-floor': SCREENING_CONSTANTS['qualifier-floor'].value,
    'identifier-match-floor': SCREENING_CONSTANTS['identifier-match-floor'].value,
    'weak-alias-score': SCREENING_CONSTANTS['weak-alias-score'].value,
  };
}

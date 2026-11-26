/**
 * The screening constants of plan C78.4 and the name-matching presets of C79.1. Every value is
 * provisional and ours unless its source says otherwise, fixed here before the matcher exists and
 * never tuned on the evaluation set (C78.8, H21): a change needs a calibration report (decision 15).
 * `packages/watchlist` (`watchlist-matcher`) reads them; `evaluation-6` reports against them.
 */
import { z } from 'zod';
import type { ThresholdBasis } from './check-config/basis.js';

/** C79.1: the public preset names; each is a set of the rules below plus a minimum. */
export const NAME_MATCHING_PRESETS = ['exact', 'strict', 'tolerant', 'custom'] as const;
export const nameMatchingPresetSchema = z.enum(NAME_MATCHING_PRESETS);
export type NameMatchingPreset = z.infer<typeof nameMatchingPresetSchema>;

/**
 * C78.4: the token-pair and alignment rules a preset may enable. `exact` enables none: a strong
 * list name equal to a subject name after normalisation, in any token order.
 */
export const NAME_MATCHING_RULES = [
  'equal_tokens',
  'original_script_equal',
  'icao_transliteration_equal',
  'cross_script_variant_group',
  'initials',
  'joined_tokens',
  'subset',
  'nicknames',
  'same_script_variant_group',
  'typos',
] as const;
export type NameMatchingRule = (typeof NAME_MATCHING_RULES)[number];

/** C79.1: the rules of each fixed preset (`custom` chooses its own). */
const STRICT_RULES: readonly NameMatchingRule[] = Object.freeze([
  'equal_tokens',
  'original_script_equal',
  'icao_transliteration_equal',
  'cross_script_variant_group',
  'initials',
  'joined_tokens',
  'subset',
]);

export const NAME_MATCHING_PRESET_RULES: Readonly<
  Record<Exclude<NameMatchingPreset, 'custom'>, readonly NameMatchingRule[]>
> = Object.freeze({
  exact: Object.freeze([]),
  // The same name, in another script or as initials, joined or as a subset; no spelling
  // variant, nickname or typo.
  strict: STRICT_RULES,
  // The research's sanctions alert level: strict plus nicknames, same-script variants and typos.
  tolerant: Object.freeze<NameMatchingRule[]>([
    ...STRICT_RULES,
    'nicknames',
    'same_script_variant_group',
    'typos',
  ]),
});

/** A provisional screening constant with its source (C78.4). */
export interface ScreeningConstant {
  readonly value: number;
  readonly basis: ThresholdBasis;
  readonly source: string;
}

function provisional(value: number, source: string): ScreeningConstant {
  return Object.freeze({ value, basis: 'provisional', source });
}

/** C79.1: the minimum score that creates a match under each fixed preset (`exact` has none). */
export const NAME_MATCHING_PRESET_MINIMUMS: Readonly<
  Record<Exclude<NameMatchingPreset, 'custom'>, ScreeningConstant | null>
> = Object.freeze({
  // A whole-name equality has no score to clear.
  exact: null,
  strict: provisional(
    0.85,
    'C79.1 (ours): the research PEP alert level (docs/research/phase6-matching.md); not tuned on the evaluation set',
  ),
  tolerant: provisional(
    0.8,
    'C79.1 (ours): the research sanctions alert level (docs/research/phase6-matching.md); not tuned on the evaluation set',
  ),
});

/** C79.1: the typo budgets of `custom` (`tolerant` uses `medium`). */
export const TYPO_BUDGETS = ['none', 'low', 'medium', 'high'] as const;
export const typoBudgetSchema = z.enum(TYPO_BUDGETS);
export type TypoBudget = z.infer<typeof typoBudgetSchema>;

/**
 * C79.1: one typo (an inserted, deleted or substituted letter, or two adjacent letters swapped:
 * {@link TYPO_EDIT_DISTANCE}) per token of at least this many characters; `none` allows no typo.
 */
export const TYPO_BUDGET_MIN_TOKEN_LENGTH: Readonly<Record<TypoBudget, number | null>> =
  Object.freeze({ none: null, low: 18, medium: 5, high: 3 });

/**
 * C78.4: the edit distance of one typo (owner decision 4 after 6B): the optimal string alignment
 * distance, in which an inserted, deleted or substituted letter and two adjacent letters swapped
 * each count as one edit. 6A's Levenshtein distance counted a transposition as two and missed every
 * one (`docs/calibration/watchlist-phase6.md`, finding 1). Kept by the 6C calibration
 * (`docs/calibration/watchlist-phase6c.md`, decision 4).
 */
export type TypoEditDistance = 'levenshtein' | 'optimal_string_alignment';
export const TYPO_EDIT_DISTANCE: Readonly<{
  value: TypoEditDistance;
  basis: ThresholdBasis;
  source: string;
}> = Object.freeze({
  value: 'optimal_string_alignment',
  basis: 'provisional',
  source:
    'C78.4 (owner decision 4 after 6B; ours, provisional): one edit of the optimal string alignment distance, an adjacent transposition included, within the same budget; kept by docs/calibration/watchlist-phase6c.md: no rise in false alerts (persons −12.7 and −90.1 per 1,000 at 100,000 and 2,000,000 names, companies unchanged)',
});

/** C79.1: the typo budget `tolerant` uses. */
export const TOLERANT_TYPO_BUDGET: TypoBudget = 'medium';

/** C79.1: the range of `custom`'s `min-score`. */
export const CUSTOM_MIN_SCORE_RANGE = Object.freeze({ min: 0.7, max: 1 });

/** The C78.4 constants, by name. */
export const SCREENING_CONSTANT_NAMES = [
  'token-equal',
  'token-variant-group',
  'token-nickname',
  'token-initial',
  'token-initial-weight',
  'jaro-winkler-minimum',
  'jaro-winkler-prefix-gate',
  'lossy-pair-cap',
  'family-name-weight',
  'unmatched-subject-token-weight',
  'unmatched-list-token-weight',
  'particle-weight',
  'role-swap-factor',
  'subset-unmatched-weight',
  'qualifier-floor',
  'dob-day-disjoint',
  'dob-transposed',
  'dob-year-disjoint',
  'dob-circa-years',
  'dob-exact',
  'country-mismatch',
  'gender-mismatch',
  'identifier-match-floor',
  'weak-alias-score',
  'display-floor',
  'candidate-cap',
  'key-frequency-bound-share',
  'pair-max-tokens',
  'pair-max-groups',
  'variant-group-max-forms',
] as const;
export type ScreeningConstantName = (typeof SCREENING_CONSTANT_NAMES)[number];

/** C78.4 (with C78.3's retrieval limits): every screening constant. */
const OURS =
  'C78.4 (ours, provisional; fixed before the matcher, never tuned on the evaluation set)';
const RETRIEVAL = 'C78.3 (ours, provisional): retrieval limits of the candidate search';
const RETRIEVAL_6C =
  'C78.3 (owner decision 1 after 6B; ours, provisional): chosen on development tables, seed a362daebb975e71a3e330ffe86234816; kept by docs/calibration/watchlist-phase6c.md (evaluation seed e8223c34916200e2b8e51f0b47981804, decision 1)';

export const SCREENING_CONSTANTS: Readonly<Record<ScreeningConstantName, ScreeningConstant>> =
  Object.freeze({
    'token-equal': provisional(
      1,
      `${OURS}: equal tokens, also in the original script or after ICAO 9303 §6.B`,
    ),
    'token-variant-group': provisional(
      0.9,
      `${OURS}: the same rigour variant group, scored as rigour's own symbol match (docs/research/phase6-matching.md)`,
    ),
    'token-nickname': provisional(0.8, `${OURS}: a C58.3 nickname`),
    'token-initial': provisional(0.9, `${OURS}: an initial against a token it begins`),
    'token-initial-weight': provisional(0.5, `${OURS}: the weight of an initial's pair`),
    'jaro-winkler-minimum': provisional(
      0.88,
      `${OURS}: the lowest Jaro-Winkler that counts as a typo, within the preset's budget`,
    ),
    'jaro-winkler-prefix-gate': provisional(
      0.7,
      `${OURS}: Winkler's boost threshold, as C58's Jaro-Winkler applies it`,
    ),
    'lossy-pair-cap': provisional(0.8, `${OURS}: the best score of a lossy (C78.2) pair`),
    'family-name-weight': provisional(1.3, `${OURS}: the weight of a family-name pair`),
    'unmatched-subject-token-weight': provisional(0.8, `${OURS}: an unmatched subject token`),
    'unmatched-list-token-weight': provisional(0.2, `${OURS}: an unmatched list token`),
    'particle-weight': provisional(0.5, `${OURS}: particles and generic words`),
    'role-swap-factor': provisional(0.95, `${OURS}: given and family names swapped`),
    'subset-unmatched-weight': provisional(
      0.2,
      `${OURS}: the subset rule's unmatched tokens of the longer name, on either side (H11)`,
    ),
    'qualifier-floor': provisional(0.7, `${OURS}: qualifiers apply from this name score`),
    'dob-day-disjoint': provisional(-0.25, `${OURS}: birth dates that share no day (C58.5)`),
    'dob-transposed': provisional(-0.1, `${OURS}: day and month transposed`),
    'dob-year-disjoint': provisional(
      -0.15,
      `${OURS}: birth years apart beyond the circa allowance`,
    ),
    'dob-circa-years': provisional(1, `${OURS}: ranges and circa dates are allowed one year`),
    'dob-exact': provisional(0.05, `${OURS}: an exact birth date`),
    'country-mismatch': provisional(-0.1, `${OURS}: a proven country disagreement`),
    'gender-mismatch': provisional(-0.1, `${OURS}: a proven gender disagreement`),
    'identifier-match-floor': provisional(
      0.95,
      `${OURS}: an exact identifier of the same kind matches at this or the name score (H06)`,
    ),
    'weak-alias-score': provisional(
      0.9,
      `${OURS}: a corroborated weak alias, a rule of its own (H10, decision 16)`,
    ),
    'display-floor': provisional(0.7, `${OURS}: below this nothing is shown`),
    'candidate-cap': provisional(
      2000,
      `${RETRIEVAL}: candidates ranked by shared keys; reaching it records truncated (C78.5)`,
    ),
    'key-frequency-bound-share': provisional(
      0.25,
      `${RETRIEVAL_6C}: a key held by more live entries than this share of the candidate cap is not used alone, so no key returns more than a quarter of the cap; it replaces 6A's 2% of a source's names, which equals the cap at 100,000 names`,
    ),
    'pair-max-tokens': provisional(
      6,
      `${RETRIEVAL_6C}: the first this many keyed tokens of a name are paired (a name of 32 tokens would give 496 pairs)`,
    ),
    'pair-max-groups': provisional(
      4,
      `${RETRIEVAL_6C}: a token in more variant groups than this pairs by its spellings only, so one ambiguous form never multiplies a name's pair keys`,
    ),
    'variant-group-max-forms': provisional(
      60,
      `${RETRIEVAL}: variant groups above this many forms are dropped by the build filter`,
    ),
  });

/**
 * Owner decision 1 after 6B: the most live entries a key may be held by to be used alone, a share
 * of the candidate cap (`key-frequency-bound-share`), at least one. It counts entries, as the cap
 * does, and does not grow with the source, so at every scale a key alone returns at most this
 * many candidates.
 */
export function keyFrequencyBound(cap: number): number {
  return Math.max(1, Math.floor(SCREENING_CONSTANTS['key-frequency-bound-share'].value * cap));
}

/**
 * Owner decision 13 after 6B: the writing systems a list name's `script` may hold (C58's
 * `WRITING_SYSTEMS`, which a test of `@openverify/watchlist` keeps equal), so the source states read
 * each one's `#script:<script>` key frequency by exact key.
 */
export const LIST_NAME_SCRIPTS = Object.freeze([
  'latin',
  'greek',
  'cyrillic',
  'armenian',
  'georgian',
  'hebrew',
  'arabic',
  'devanagari',
  'bengali',
  'thai',
  'han',
  'hiragana',
  'katakana',
  'hangul',
  'other',
] as const);

/** C78.5: the public `match-types` vocabulary, plus ours (`weak_alias`, the media title types). */
export const REPORT_MATCH_TYPES = [
  'name_exact',
  'name_fuzzy',
  'birthdate_exact',
  'identifier_exact',
  'crypto_address_exact',
  'weak_alias',
  'title_full_name',
  'title_all_tokens',
] as const;
export const reportMatchTypeSchema = z.enum(REPORT_MATCH_TYPES);
export type ReportMatchType = z.infer<typeof reportMatchTypeSchema>;

/** C78.4: the qualifiers a match records beside its name score. */
export const REPORT_MATCH_QUALIFIERS = [
  'dob_day_disjoint',
  'dob_transposed',
  'dob_year_disjoint',
  'dob_exact',
  'country_mismatch',
  'gender_mismatch',
] as const;
export const reportMatchQualifierSchema = z.enum(REPORT_MATCH_QUALIFIERS);
export type ReportMatchQualifier = z.infer<typeof reportMatchQualifierSchema>;

/** The score change each qualifier applies (C78.4), from {@link SCREENING_CONSTANTS}. */
const QUALIFIER_CONSTANTS: Readonly<Record<ReportMatchQualifier, ScreeningConstantName>> = {
  dob_day_disjoint: 'dob-day-disjoint',
  dob_transposed: 'dob-transposed',
  dob_year_disjoint: 'dob-year-disjoint',
  dob_exact: 'dob-exact',
  country_mismatch: 'country-mismatch',
  gender_mismatch: 'gender-mismatch',
};

export function qualifierAdjustment(qualifier: ReportMatchQualifier): number {
  return SCREENING_CONSTANTS[QUALIFIER_CONSTANTS[qualifier]].value;
}

/** The rules a fixed preset enables, or a `custom` preset's from its options (C79.1). */
export function presetRules(
  preset: NameMatchingPreset,
  custom: {
    readonly allowNicknames?: boolean;
    readonly allowVariants?: boolean;
    readonly typoBudget?: TypoBudget;
  } = {},
): readonly NameMatchingRule[] {
  if (preset !== 'custom') {
    return NAME_MATCHING_PRESET_RULES[preset];
  }
  return [
    ...STRICT_RULES,
    ...(custom.allowNicknames === true ? (['nicknames'] as const) : []),
    ...(custom.allowVariants === true ? (['same_script_variant_group'] as const) : []),
    ...(custom.typoBudget !== undefined && custom.typoBudget !== 'none'
      ? (['typos'] as const)
      : []),
  ];
}

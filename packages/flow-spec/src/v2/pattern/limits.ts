/** C148.3's limits and refusal reasons, shared by the parser, the VM and the public entry points. */

/** Inputs longer than this are refused before matching (Phase 11's G-REGEX re-checks it). */
export const PATTERN_INPUT_LIMIT = 10_000;

/** A pattern's longest source (C148.3; the component schema bounds it too). */
export const PATTERN_SOURCE_LIMIT = 500;

/**
 * The most instructions a compiled pattern may hold (ours, provisional). Basis: the matcher visits
 * each instruction at most once per input character, so this bounds one match at
 * `PATTERN_INPUT_LIMIT` x 2,048 steps; every pattern in the golden vectors and the public examples
 * compiles to fewer than 200.
 */
export const PATTERN_PROGRAM_LIMIT = 2048;

/** Why `compilePattern` refuses a pattern (`pattern_refused`'s reasons, C148.3, V10). */
export const PATTERN_REFUSAL_REASONS = Object.freeze([
  'empty',
  'too_long',
  'syntax',
  'backreference',
  'lookaround',
  'named_group',
  'property_escape',
  'flag_unsupported',
  'escape_unsupported',
  'nothing_to_repeat',
  'nested_quantifier',
  'lazy_quantifier',
  'quantifier_too_large',
  'class_range_invalid',
  'pattern_too_complex',
] as const);
export type PatternRefusalReason = (typeof PATTERN_REFUSAL_REASONS)[number];

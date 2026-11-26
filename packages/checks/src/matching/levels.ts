/**
 * Match levels and three-valued match groups (C58.1). Every matcher of this folder answers a
 * {@link FieldMatch}: a level (`full`, `partial`, `none`, or `missing` when one side holds no
 * comparable data, never a mismatch), the public method ids the level rests on, and flags
 * (kebab-case words, never values). A match group names fields and the level each must reach;
 * {@link evaluateMatchGroups} gives each group `met`, `unmet` or `undecidable`, and an identity
 * check passes when any group is met, fails only when every group is unmet, and otherwise goes to
 * review.
 */
import { MATCH_LEVELS, type MatchLevel, type MatchRequirement } from '@openverify/core';

export { MATCH_LEVELS, type MatchLevel, type MatchRequirement };

/** The public comparison method ids a level can rest on (C58.1), in this order. */
export const MATCH_METHODS = [
  'remove_prefixes',
  'remove_suffixes',
  'remove_special_characters',
  'fold_characters',
  'string_similarity',
  'string_difference',
  'nickname',
  'substring',
  'tokenization',
  'date_similarity',
  'date_difference',
] as const;
export type MatchMethod = (typeof MATCH_METHODS)[number];

/** One field's comparison: its level, the methods it rests on, and flags (never values). */
export interface FieldMatch {
  readonly level: MatchLevel;
  readonly methods: readonly MatchMethod[];
  readonly flags: readonly string[];
}

/**
 * A field match with its methods deduplicated in {@link MATCH_METHODS} order and its flags
 * deduplicated and sorted, so equal comparisons give equal results.
 */
export function fieldMatch(
  level: MatchLevel,
  methods: Iterable<MatchMethod> = [],
  flags: Iterable<string> = [],
): FieldMatch {
  const used = new Set(methods);
  return {
    level,
    methods: MATCH_METHODS.filter((method) => used.has(method)),
    flags: [...new Set(flags)].sort(),
  };
}

/** Whether a level reaches a requirement: `full` meets both, `partial` meets `partial`. */
export function meetsRequirement(level: MatchLevel, requirement: MatchRequirement): boolean {
  return level === 'full' || (level === 'partial' && requirement === 'partial');
}

/** What one group gives: every field at its level, some below it, or none below but some unknown. */
export type MatchGroupOutcome = 'met' | 'unmet' | 'undecidable';

/** A match group: each field it names, with the level that field must reach. */
export type MatchGroup = Readonly<Partial<Record<string, MatchRequirement>>>;

export interface MatchGroupResult {
  /** The group as configured. */
  readonly fields: MatchGroup;
  readonly outcome: MatchGroupOutcome;
  /** The fields at `none` or below their level, in the group's order. */
  readonly unmetFields: readonly string[];
  /** The fields at `missing`, in the group's order. */
  readonly missingFields: readonly string[];
}

export interface MatchGroupsResult {
  /** `met` when any group is met, `unmet` when every group is unmet, else `undecidable`. */
  readonly outcome: MatchGroupOutcome;
  readonly groups: readonly MatchGroupResult[];
}

/** The level of each field; a field not listed is `missing`. */
export type FieldLevels = Readonly<Partial<Record<string, MatchLevel>>>;

/**
 * One group (C58.1): `unmet` when some field is `none` or below its level, else `undecidable`
 * when some field is `missing`, else `met`.
 */
export function evaluateMatchGroup(group: MatchGroup, levels: FieldLevels): MatchGroupResult {
  const unmetFields: string[] = [];
  const missingFields: string[] = [];
  for (const [field, requirement] of Object.entries(group)) {
    if (requirement === undefined) {
      continue;
    }
    const level = levels[field] ?? 'missing';
    if (level === 'missing') {
      missingFields.push(field);
    } else if (!meetsRequirement(level, requirement)) {
      unmetFields.push(field);
    }
  }
  const outcome: MatchGroupOutcome =
    unmetFields.length > 0 ? 'unmet' : missingFields.length > 0 ? 'undecidable' : 'met';
  return { fields: group, outcome, unmetFields, missingFields };
}

/**
 * Every group (C58.1): `met` when any group is met, `unmet` only when every group is unmet, and
 * `undecidable` otherwise (no group configured included), which an identity check answers with
 * review, never a fraud failure.
 */
export function evaluateMatchGroups(
  groups: readonly MatchGroup[],
  levels: FieldLevels,
): MatchGroupsResult {
  const results = groups.map((group) => evaluateMatchGroup(group, levels));
  const outcome: MatchGroupOutcome = results.some((result) => result.outcome === 'met')
    ? 'met'
    : results.length > 0 && results.every((result) => result.outcome === 'unmet')
      ? 'unmet'
      : 'undecidable';
  return { outcome, groups: results };
}

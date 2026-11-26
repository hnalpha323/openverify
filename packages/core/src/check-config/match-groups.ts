/**
 * Match levels and match groups (C58.1), shared by the database and business identity checks.
 * A comparison gives `full`, `partial`, `none` or `missing` (no data on one side, or values in
 * two scripts: never a mismatch). A match group maps fields to the level each must reach; an
 * identity check passes when any group is met, fails only when every group is unmet, and is
 * otherwise undecidable (review). The levels themselves are computed in
 * `packages/checks/src/matching`.
 */
import { z } from 'zod';

export const MATCH_LEVELS = ['full', 'partial', 'none', 'missing'] as const;
export const matchLevelSchema = z.enum(MATCH_LEVELS);
export type MatchLevel = z.infer<typeof matchLevelSchema>;

/** The levels a requirement may ask for: a field at `partial` is also met by `full`. */
export const MATCH_REQUIREMENTS = ['partial', 'full'] as const;
export const matchRequirementSchema = z.enum(MATCH_REQUIREMENTS);
export type MatchRequirement = z.infer<typeof matchRequirementSchema>;

/** The most groups a template may configure (C51.3). */
export const MAX_MATCH_GROUPS = 5;

/** A field's required level, `min-match-level` (C51.3). */
export const minMatchLevelSchema = matchRequirementSchema;

/**
 * One to {@link MAX_MATCH_GROUPS} groups over `fields`, each naming at least one of them with
 * the level it must reach.
 */
export function matchGroupsSchema(fields: readonly [string, ...string[]]) {
  const group = z
    .strictObject(
      Object.fromEntries(fields.map((field) => [field, matchRequirementSchema.optional()])),
    )
    .refine((value) => Object.keys(value).length > 0, 'a match group names at least one field');
  return z.array(group).min(1).max(MAX_MATCH_GROUPS);
}

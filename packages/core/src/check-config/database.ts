/**
 * Database and AAMVA check config (C51.3, C58, C59). Owned by `checks-matching` in Workflow 5A
 * Stage 2; amendments to these keys are recorded in the plan.
 */
import { z } from 'zod';
import { defaultsTable, distinctList, provisionalDefault } from './basis.js';
import { matchGroupsSchema, minMatchLevelSchema } from './match-groups.js';

/** The fields a database match group can name (C51.3). */
export const DATABASE_MATCH_FIELDS = [
  'name',
  'birthdate',
  'address',
  'identification-number',
  'phone-number',
  'email-address',
] as const;

/** The AAMVA record fields the identity comparison judges (C59.5). */
export const AAMVA_COMPARISON_FIELDS = [
  'name-first',
  'name-last',
  'birthdate',
  'identification-number',
  'issue-date',
  'expiration-date',
  'address-postal-code',
] as const;

/**
 * The fields `ignored-fields` may name: never the surname or the licence number, so the identity
 * always rests on them (a Workflow 5A Stage 1a amendment). DLDV's birthdate coverage is
 * unconfirmed (C59.4), which is why the birthdate may be ignored.
 */
export const AAMVA_IGNORABLE_FIELDS = [
  'name-first',
  'birthdate',
  'issue-date',
  'expiration-date',
  'address-postal-code',
] as const;

/** What the form source does when the jurisdiction does not take part (C59.5). */
export const AAMVA_NON_PARTICIPATION_OUTCOMES = ['review', 'skip'] as const;

export const databaseIdentityComparisonConfigSchema = z.strictObject({
  'match-groups': matchGroupsSchema(DATABASE_MATCH_FIELDS).optional(),
  /** Research R2: a record less precise than the input (year and month only) passes partial. */
  'accept-precision-limited-birthdate': z.boolean().optional(),
  /** Research R4: a day-month transposition passes partial instead of going to review. */
  'accept-transposed-birthdate': z.boolean().optional(),
});

const fieldComparison = () => z.strictObject({ 'min-match-level': minMatchLevelSchema.optional() });

export const databaseNameComparisonConfigSchema = fieldComparison();
export const databaseAddressComparisonConfigSchema = fieldComparison();
export const databaseBirthdateComparisonConfigSchema = fieldComparison();
export const databaseInquiryComparisonConfigSchema = fieldComparison();

export const aamvaIdentityComparisonConfigSchema = z.strictObject({
  'ignored-fields': distinctList(z.enum(AAMVA_IGNORABLE_FIELDS), 0).optional(),
  'on-jurisdiction-not-participating': z.enum(AAMVA_NON_PARTICIPATION_OUTCOMES).optional(),
});

const OURS_MATCH =
  'ours: a partial match (nickname, initial, one fuzzy token) passes; no external basis';

/** C51.3: the database and AAMVA check defaults. */
export const DATABASE_CHECK_CONFIG_DEFAULTS = defaultsTable({
  database_identity_comparison: {
    'match-groups': provisionalDefault(
      [{ name: 'partial', birthdate: 'partial', address: 'partial' }],
      'the public module default: name, birthdate and address each at partial (docs/research/phase5-behaviour.md §5.3)',
    ),
    'accept-precision-limited-birthdate': provisionalDefault(
      true,
      'research R2 (docs/research/phase5-libraries.md §2.4, owner item C4): a precision-limited birthdate passes for database sources',
    ),
    'accept-transposed-birthdate': provisionalDefault(
      false,
      'research R4 (docs/research/phase5-libraries.md §2.4): a day-month transposition goes to review (birthdate_ambiguous)',
    ),
  },
  database_name_comparison: { 'min-match-level': provisionalDefault('partial', OURS_MATCH) },
  database_address_comparison: { 'min-match-level': provisionalDefault('partial', OURS_MATCH) },
  database_birthdate_comparison: { 'min-match-level': provisionalDefault('partial', OURS_MATCH) },
  database_inquiry_comparison: { 'min-match-level': provisionalDefault('partial', OURS_MATCH) },
  aamva_identity_comparison: {
    'ignored-fields': provisionalDefault(
      [],
      'ours: every field the record holds is compared; no external basis',
    ),
    'on-jurisdiction-not-participating': provisionalDefault(
      'review',
      'ours: a form-source attempt in a jurisdiction that does not take part goes to an operator (C59.5)',
    ),
  },
});

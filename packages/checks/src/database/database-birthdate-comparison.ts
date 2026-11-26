/**
 * `database_birthdate_comparison` (R+A, fraud; C58.5, C59.3): the entered birth date against the
 * record's, at `min-match-level`; a day-month transposition is `birthdate_ambiguous` (review).
 */
import type { CheckResult } from '@openverify/core';
import type { DatabaseContext } from './context.js';
import { compareDatabaseField } from './field-comparison.js';

export function databaseBirthdateComparison(context: DatabaseContext): CheckResult {
  return compareDatabaseField(
    context,
    'database_birthdate_comparison',
    'birthdate',
    'birthdate_mismatch',
    (match) => (match.flags.includes('transposed') ? 'birthdate_ambiguous' : null),
  );
}

/**
 * `database_address_comparison` (R+A, fraud; C58.4, C59.3): the entered address against the record's,
 * at `min-match-level`.
 */
import type { CheckResult } from '@openverify/core';
import type { DatabaseContext } from './context.js';
import { compareDatabaseField } from './field-comparison.js';

export function databaseAddressComparison(context: DatabaseContext): CheckResult {
  return compareDatabaseField(
    context,
    'database_address_comparison',
    'address',
    'address_mismatch',
  );
}

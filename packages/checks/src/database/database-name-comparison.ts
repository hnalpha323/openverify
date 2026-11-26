/**
 * `database_name_comparison` (R+A, fraud; C58.2, C59.3): the entered name against the record's, at
 * `min-match-level`.
 */
import type { CheckResult } from '@openverify/core';
import type { DatabaseContext } from './context.js';
import { compareDatabaseField } from './field-comparison.js';

export function databaseNameComparison(context: DatabaseContext): CheckResult {
  return compareDatabaseField(context, 'database_name_comparison', 'name', 'name_mismatch');
}

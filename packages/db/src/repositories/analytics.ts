/**
 * C163.3, C163.4 (Workflow 9B): the analytics rollups' repository. Owner: `api-analytics`, who adds
 * the rollup SQL in the reporting zone, the dirty-day refresh, the redacted contributions, the
 * rebuild, the retention deletes and the reads here; frozen by `foundation-9b` (Stage 1b (A)) with
 * the tables (`tables/analytics.ts`) and this module's export line, so the owner never edits the
 * shared repository index.
 */
import type { AnalyticsRollupTable } from '@openverify/core';
import { analyticsRollupTables } from '../tables/analytics.js';

/** The drizzle table of a rollup, by its name in `ANALYTICS_ROLLUP_TABLES`. */
export function analyticsRollupTableOf<Name extends AnalyticsRollupTable>(
  name: Name,
): (typeof analyticsRollupTables)[Name] {
  return analyticsRollupTables[name];
}

/** A row a recompute or a redaction writes to one rollup table. */
export type NewAnalyticsRollupRow<Name extends AnalyticsRollupTable> =
  (typeof analyticsRollupTables)[Name]['$inferInsert'];

/**
 * C163.2, C163.4 (Workflow 9B; decision 36, review H04): the analytics hook `updateDashboardSettings`
 * (`services/settings.ts`) calls in its transaction after writing the environment's settings, with
 * the settings before and after. Owner: `api-analytics`; `foundation-9b` (Stage 1b (A)) froze the
 * signature and placed the call.
 *
 * A changed `analytics-time-zone` leads to an `analytics-rebuild` over the open days only: the
 * rollup state keeps the zone the stored days were built in, and the next `analytics-rollup` pass,
 * which holds the rebuild producer, sees the state's zone differ from the setting and queues the
 * rebuild (so a failed enqueue after this commit cannot lose it: the next pass sees it again). Here,
 * in the change's transaction, the new zone is held to the database's own zone names, because the
 * rollup SQL hands it to Postgres (`at time zone`): a name `Intl` knows and this database does not
 * would stop the environment's rollups, so the change is refused (422) and rolled back.
 */
import type { Db, EnvironmentSettings } from '@openverify/db';
import { sql } from 'drizzle-orm';
import { UnprocessableContentError } from '../../errors.js';

export type OnAnalyticsSettingsChangedInTx = (
  tx: Db,
  environmentId: string,
  before: EnvironmentSettings,
  after: EnvironmentSettings,
) => Promise<void>;

const ZONE = 'analytics-time-zone';

export const onAnalyticsSettingsChangedInTx: OnAnalyticsSettingsChangedInTx = async (
  tx,
  _environmentId,
  before,
  after,
) => {
  const zone = (after as Record<string, unknown>)[ZONE];
  if (typeof zone !== 'string' || zone === (before as Record<string, unknown>)[ZONE]) {
    return;
  }
  const result = await tx.execute<{ known: boolean }>(
    sql`select exists (select 1 from pg_timezone_names where name = ${zone}) as known`,
  );
  const [row] = (result as { rows: { known: boolean }[] }).rows;
  if (row?.known !== true) {
    throw new UnprocessableContentError('analytics-time-zone is not a zone this database knows.', [
      { location: 'body', pointer: `/${ZONE}`, detail: 'must be a zone the database knows' },
    ]);
  }
};

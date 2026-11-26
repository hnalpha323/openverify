/**
 * C163.1, C163.2, C163.4, C164.8 (Workflow 9B, `api-analytics`; Stage 1b amendment A4): an
 * environment's `analytics_rollup_state` and the settings the analytics read.
 * - `rolled_up_through`: the watermark the last pass covered, `now() - 2 minutes`; every local day
 *   before its day is stored, and later days are computed live;
 * - `outcomes_as_of`: the watermark of the last outcome refresh (once a local day, P21);
 * - `time_zone`: the zone the stored open days were built in (a change is rebuilt, C163.2);
 * - `step_data_from`: the local day of the first step record, set once (C163.1);
 * - `closed_through` (K9-24, AA6): the last local day the rollup closed; a later pass never
 *   recomputes it, so a raised `analytics-settle-days` never reopens it.
 */
import { resolvePlatformSettings, type PlatformSettings } from '@openverify/contracts';
import { analyticsRollupState, environments, type Db } from '@openverify/db';
import { eq, sql } from 'drizzle-orm';
import { localDayOf } from './days.js';

export interface AnalyticsState {
  rolledUpThrough: Date | null;
  outcomesAsOf: Date | null;
  timeZone: string | null;
  stepDataFrom: string | null;
  closedThrough: string | null;
}

/** An environment as the analytics read it: its id and its resolved platform settings. */
export interface AnalyticsEnvironment {
  id: string;
  settings: PlatformSettings;
}

/** The environment's analytics settings, or `null` when there is no such environment. */
export async function analyticsEnvironmentOf(
  db: Db,
  environmentId: string,
): Promise<AnalyticsEnvironment | null> {
  const [row] = await db
    .select({ id: environments.id, settings: environments.settings })
    .from(environments)
    .where(eq(environments.id, environmentId));
  return row === undefined ? null : { id: row.id, settings: resolvePlatformSettings(row.settings) };
}

/** Every environment, in id order. */
export async function analyticsEnvironments(db: Db): Promise<AnalyticsEnvironment[]> {
  const rows = await db
    .select({ id: environments.id, settings: environments.settings })
    .from(environments)
    .orderBy(environments.id);
  return rows.map((row) => ({
    id: row.id,
    settings: resolvePlatformSettings(row.settings as Record<string, unknown>),
  }));
}

export async function readAnalyticsState(
  db: Db,
  environmentId: string,
): Promise<AnalyticsState | null> {
  const [row] = await db
    .select()
    .from(analyticsRollupState)
    .where(eq(analyticsRollupState.environmentId, environmentId));
  return row === undefined
    ? null
    : {
        rolledUpThrough: row.rolledUpThrough,
        outcomesAsOf: row.outcomesAsOf,
        timeZone: row.timeZone,
        stepDataFrom: row.stepDataFrom,
        closedThrough: row.closedThrough,
      };
}

export async function writeAnalyticsState(
  tx: Db,
  environmentId: string,
  state: AnalyticsState,
): Promise<void> {
  const values = {
    rolledUpThrough: state.rolledUpThrough,
    outcomesAsOf: state.outcomesAsOf,
    timeZone: state.timeZone,
    stepDataFrom: state.stepDataFrom,
    closedThrough: state.closedThrough,
    updatedAt: new Date(),
  };
  await tx
    .insert(analyticsRollupState)
    .values({ environmentId, ...values })
    .onConflictDoUpdate({ target: analyticsRollupState.environmentId, set: values });
}

/**
 * The local day of the environment's first step record, in `zone`, or `null` before any. Read once:
 * the state keeps it, since a redaction deletes step records (C163.1).
 */
export async function firstStepDay(
  db: Db,
  environmentId: string,
  zone: string,
): Promise<string | null> {
  const result = await db.execute<{ first: Date | string | null }>(
    sql`select min(entered_at) as first from inquiry_flow_steps where environment_id = ${environmentId}`,
  );
  const [row] = (result as { rows: { first: Date | string | null }[] }).rows;
  return row?.first === null || row?.first === undefined
    ? null
    : localDayOf(new Date(row.first), zone);
}

/**
 * The first local day that is not stored yet, in `zone`: days before it hold rollup rows, it and
 * later days are computed live. `null` before the first pass (every day is live).
 */
export function firstLiveDay(state: AnalyticsState | null, zone: string): string | null {
  return state?.rolledUpThrough == null ? null : localDayOf(state.rolledUpThrough, zone);
}

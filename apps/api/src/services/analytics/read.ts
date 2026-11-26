/**
 * C163.4, C164.8 (Workflow 9B, `api-analytics`): the rows an answer reads for its window, always one
 * environment (A13).
 * - **Stored days** (before the first live day): the `facts` and `redacted` rows of the window, added
 *   (C163.4: a reader adds both sources).
 * - **Live days** (the current day, and any day the last pass has not stored yet; reviews H28, P21):
 *   the live counts only, computed now with the same rollup SQL from the unredacted inquiries and
 *   cases (`computeCohortRollups` and `computeCaseRollups` in `live` mode), plus the live counts of
 *   that day's `redacted` rows. No outcome of a live day is ever read.
 * Filters are applied here, before any figure or suppression (C164.7: suppression after every
 * filter).
 */
import type { Db } from '@openverify/db';
import { analyticsRollupTableOf } from '@openverify/db';
import { and, eq, gte, lte, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { getTableColumns } from 'drizzle-orm';
import { daysFrom, laterDay, localDayOf } from './days.js';
import { computeCaseRollups, computeCohortRollups } from './rollup-sql.js';
import {
  analyticsEnvironmentOf,
  firstLiveDay,
  firstStepDay,
  readAnalyticsState,
  type AnalyticsState,
} from './state.js';
import { ROLLUPS, type RollupDescriptor } from './store.js';

export type AnyRow = Record<string, unknown>;

/** What every answer of one environment reads first. */
export interface AnalyticsReadContext {
  environmentId: string;
  /** `analytics-time-zone`: the zone of the window and of live days. */
  zone: string;
  threshold: number;
  settleDays: number;
  state: AnalyticsState | null;
  /** The current local day in `zone`. */
  today: string;
  /** The first day computed live; `null` before the first pass (every day is live). */
  liveFrom: string | null;
  /** The local day of the environment's first step record, `null` before any (C163.1). */
  stepDataFrom: string | null;
}

/** The filters of C164.8, as the rows name them. */
export interface AnalyticsFilters {
  inquiryTemplateId?: string | undefined;
  inquiryTemplateVersionId?: string | undefined;
  platform?: string | undefined;
  deviceKind?: string | undefined;
  tag?: string | undefined;
  caseTemplateId?: string | undefined;
}

/** The rows of one window: each rollup's rows by its `rows` name, the live days and every zone. */
export interface AnalyticsWindow {
  from: string;
  to: string;
  rows: Readonly<Record<string, readonly AnyRow[]>>;
  liveDays: ReadonlySet<string>;
  /** Every zone a row of the window was computed in, and the setting's zone. */
  zones: readonly string[];
}

export async function readContext(
  db: Db,
  environmentId: string,
  now: Date,
): Promise<AnalyticsReadContext> {
  const environment = await analyticsEnvironmentOf(db, environmentId);
  if (environment === null) {
    throw new Error('the principal’s environment does not exist');
  }
  const zone = environment.settings['analytics-time-zone'];
  const state = await readAnalyticsState(db, environmentId);
  return {
    environmentId,
    zone,
    threshold: environment.settings['analytics-suppression-threshold'],
    settleDays: environment.settings['analytics-settle-days'],
    state,
    today: localDayOf(now, zone),
    liveFrom: firstLiveDay(state, zone),
    stepDataFrom: state?.stepDataFrom ?? (await firstStepDay(db, environmentId, zone)),
  };
}

function columnOf(rollup: RollupDescriptor, field: string): PgColumn | undefined {
  return (getTableColumns(analyticsRollupTableOf(rollup.name)) as Record<string, PgColumn>)[field];
}

/** A column every rollup has (its key). */
function keyColumnOf(rollup: RollupDescriptor, field: 'day' | 'environmentId'): PgColumn {
  const column = columnOf(rollup, field);
  if (column === undefined) {
    throw new Error(`${rollup.name} has no ${field}`);
  }
  return column;
}

/** The filters a rollup has the dimensions for, as conditions on its columns. */
function filterConditions(rollup: RollupDescriptor, filters: AnalyticsFilters): SQL[] {
  const conditions: SQL[] = [];
  for (const [field, value] of Object.entries(filters)) {
    if (value === undefined) {
      continue;
    }
    const column = columnOf(rollup, field);
    if (column !== undefined) {
      conditions.push(eq(column, value));
    }
  }
  return conditions;
}

/** A live row passes the filters it has dimensions for. */
const passes = (row: AnyRow, filters: AnalyticsFilters): boolean =>
  Object.entries(filters).every(
    ([field, value]) => value === undefined || !(field in row) || row[field] === value,
  );

/** A `redacted` row of a live day, cut to its live counts (no outcome is read on a live day). */
function liveOnly(rollup: RollupDescriptor, row: AnyRow): AnyRow {
  const cut: AnyRow = { ...row };
  for (const field of rollup.counts) {
    if (!rollup.live.includes(field)) {
      cut[field] = 0;
    }
  }
  if (rollup.histogram !== undefined) {
    cut[rollup.histogram] = (row[rollup.histogram] as number[]).map(() => 0);
  }
  return cut;
}

/**
 * The window's rows for `rollups`, filtered. `from` and `to` are local days in the context's zone,
 * at most 400 apart (the query schema holds that).
 */
export async function readWindow(
  db: Db,
  context: AnalyticsReadContext,
  input: {
    from: string;
    to: string;
    rollups: readonly RollupDescriptor[];
    filters: AnalyticsFilters;
  },
): Promise<AnalyticsWindow> {
  const { from, to, rollups, filters } = input;
  const liveStart = laterDay(context.liveFrom ?? from, from);
  const liveEnd = context.today < to ? context.today : to;
  const liveDays = new Set(liveStart <= liveEnd ? daysFrom(liveStart, liveEnd) : []);
  const zones = new Set<string>([context.zone]);
  const rows: Record<string, AnyRow[]> = {};
  for (const rollup of rollups) {
    const table = analyticsRollupTableOf(rollup.name);
    const day = keyColumnOf(rollup, 'day');
    const stored = (await db
      .select()
      .from(table)
      .where(
        and(
          eq(keyColumnOf(rollup, 'environmentId'), context.environmentId),
          gte(day, from),
          lte(day, to),
          ...filterConditions(rollup, filters),
        ),
      )) as AnyRow[];
    rows[rollup.rows] = stored.flatMap((row) => {
      if (!liveDays.has(row.day as string)) {
        zones.add(row.timeZone as string);
        return [row];
      }
      // A live day: only the live counts of its `redacted` rows (its `facts` are computed below).
      if (row.source !== 'redacted' || rollup.live.length === 0) {
        return [];
      }
      zones.add(row.timeZone as string);
      return [liveOnly(rollup, row)];
    });
  }
  if (liveDays.size > 0) {
    const days = [...liveDays].sort();
    const range = { from: days[0] ?? from, to: days[days.length - 1] ?? to };
    const names = new Set(rollups.map((rollup) => rollup.rows));
    if (names.has('inquiry') || names.has('tag')) {
      const live = await computeCohortRollups(
        db,
        {
          environmentId: context.environmentId,
          timeZone: context.zone,
          source: 'facts',
          selection: { kind: 'facts', ...range },
        },
        'live',
      );
      for (const name of ['inquiry', 'tag'] as const) {
        if (names.has(name)) {
          rows[name] = [
            ...(rows[name] ?? []),
            ...(live[name] as unknown as AnyRow[]).filter((row) => passes(row, filters)),
          ];
        }
      }
    }
    if (names.has('case')) {
      const live = await computeCaseRollups(
        db,
        { environmentId: context.environmentId, timeZone: context.zone, ...range },
        'live',
      );
      rows.case = [
        ...(rows.case ?? []),
        ...(live.case as unknown as AnyRow[]).filter((row) => passes(row, filters)),
      ];
    }
  }
  return { from, to, rows, liveDays, zones: [...zones].sort() };
}

/** The rollup descriptors by their `rows` name. */
export const rollupsNamed = (...names: string[]): RollupDescriptor[] =>
  ROLLUPS.filter((rollup) => names.includes(rollup.rows));

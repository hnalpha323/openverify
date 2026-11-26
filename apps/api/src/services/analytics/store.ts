/**
 * C163.4 (Workflow 9B, `api-analytics`; reviews H04, P21): how the rollup rows are written.
 * - A recompute replaces a day's `facts` rows in one transaction (`replaceFactsInTx`): every column
 *   (`all`), or only the live counts, the outcome columns kept as the last outcome refresh left them
 *   (`live`, the 5-minute pass; P21).
 * - A redaction adds its inquiry's contribution to the `redacted` rows (`addRedactedInTx`, an upsert
 *   on each table's key) and moves it out of the `facts` rows (`subtractFactsInTx`), so that `facts`
 *   plus `redacted`, which every reader adds, never changes at a redaction.
 * Every writer holds the environment's analytics lock (`lockAnalyticsInTx`) for its transaction, so
 * a recompute and a redaction of one environment never interleave.
 */
import type { AnalyticsRollupTable } from '@openverify/core';
import { analyticsRollupTableOf, type Db } from '@openverify/db';
import { and, eq, getTableColumns, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { CaseRollups, CohortRollups } from './rollup-sql.js';

/** One rollup table: its key dimensions, its counts and its histogram, by field name. */
export interface RollupDescriptor {
  name: AnalyticsRollupTable;
  /** The field of `CohortRollups` or `CaseRollups` holding its rows. */
  rows: keyof CohortRollups | keyof CaseRollups;
  dimensions: readonly string[];
  counts: readonly string[];
  /** The counts a live refresh writes (C163.4); none for a table no live count reaches. */
  live: readonly string[];
  histogram?: string;
}

const INQUIRY_DIMENSIONS = [
  'inquiryTemplateId',
  'inquiryTemplateVersionId',
  'platform',
  'deviceKind',
] as const;
const VERSION = ['inquiryTemplateId', 'inquiryTemplateVersionId'] as const;

/** The twelve rollups, in `ANALYTICS_ROLLUP_TABLES`' order. */
export const ROLLUPS: readonly RollupDescriptor[] = [
  {
    name: 'analytics_inquiry_daily',
    rows: 'inquiry',
    dimensions: INQUIRY_DIMENSIONS,
    counts: [
      'created',
      'started',
      'interacted',
      'finished',
      'completed',
      'completedVerified',
      'completedWithFallback',
      'completedUnverified',
      'failed',
      'expiredBeforeStart',
      'expiredAfterStart',
      'approved',
      'declined',
      'needsReview',
      'markedForReview',
      'decidedAutomatic',
      'decidedManual',
      'decidedNotDeclared',
    ],
    live: ['created', 'started'],
    histogram: 'finishSecondsHistogram',
  },
  {
    name: 'analytics_inquiry_tag_daily',
    rows: 'tag',
    dimensions: [...INQUIRY_DIMENSIONS, 'tag'],
    counts: ['created', 'finished', 'completed', 'failed'],
    live: ['created'],
  },
  {
    name: 'analytics_step_daily',
    rows: 'step',
    dimensions: [...VERSION, 'stepId'],
    counts: ['entered', 'exited', 'revisits'],
    live: [],
  },
  {
    name: 'analytics_transition_daily',
    rows: 'transition',
    dimensions: [...VERSION, 'fromStepId', 'toStepId'],
    counts: ['count'],
    live: [],
  },
  {
    name: 'analytics_path_daily',
    rows: 'path',
    dimensions: [...VERSION, 'pathSha256'],
    counts: ['count'],
    live: [],
  },
  {
    name: 'analytics_verification_daily',
    rows: 'verification',
    dimensions: [...VERSION, 'verificationType', 'captureMethod', 'country'],
    counts: [
      'created',
      'submitted',
      'passed',
      'failed',
      'requiresRetry',
      'skipped',
      'needsReview',
      'canceled',
    ],
    live: [],
  },
  {
    name: 'analytics_verification_step_daily',
    rows: 'verificationStep',
    dimensions: [...VERSION, 'stepId', 'verificationType'],
    counts: ['entered', 'passed', 'failedAfterAttempts', 'needsReview', 'skipped'],
    live: [],
  },
  {
    name: 'analytics_check_daily',
    rows: 'check',
    dimensions: [...VERSION, 'verificationType', 'checkName', 'requirement', 'status'],
    counts: ['count'],
    live: [],
  },
  {
    name: 'analytics_check_reason_daily',
    rows: 'checkReason',
    dimensions: [...VERSION, 'verificationType', 'checkName', 'requirement', 'reason'],
    counts: ['count'],
    live: [],
  },
  {
    name: 'analytics_case_daily',
    rows: 'case',
    dimensions: ['caseTemplateId'],
    counts: ['created', 'resolved', 'slaMet', 'slaMissed'],
    live: ['created'],
    histogram: 'resolutionSecondsHistogram',
  },
  {
    name: 'analytics_case_assignee_daily',
    rows: 'assignee',
    dimensions: ['caseTemplateId', 'userId'],
    counts: ['assigned', 'resolved'],
    live: [],
  },
  {
    name: 'analytics_signal_daily',
    rows: 'signal',
    dimensions: [...INQUIRY_DIMENSIONS, 'signalName', 'bin'],
    counts: ['count'],
    live: [],
  },
];

/** The rollups an inquiry cohort fills (every one but the two case rollups). */
export const COHORT_ROLLUPS = ROLLUPS.filter(
  (rollup) => rollup.rows !== 'case' && rollup.rows !== 'assignee',
);
/** The two case rollups. */
export const CASE_ROLLUPS = ROLLUPS.filter(
  (rollup) => rollup.rows === 'case' || rollup.rows === 'assignee',
);

type AnyRow = Record<string, unknown>;

const tableOf = (rollup: RollupDescriptor): PgTable => analyticsRollupTableOf(rollup.name);

function columnOf(rollup: RollupDescriptor, field: string): PgColumn {
  const column = (getTableColumns(tableOf(rollup)) as Record<string, PgColumn | undefined>)[field];
  if (column === undefined) {
    throw new Error(`${rollup.name} has no column ${field}`);
  }
  return column;
}

/** The analytics lock of one environment, held to the end of the transaction. */
export async function lockAnalyticsInTx(tx: Db, environmentId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`openverify:analytics:${environmentId}`}, 0))`,
  );
}

/** At most this many rows per insert statement (the widest row binds 28 parameters). */
const INSERT_CHUNK = 500;

async function insertRows(tx: Db, rollup: RollupDescriptor, rows: readonly AnyRow[]) {
  for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
    await tx.insert(tableOf(rollup)).values(rows.slice(start, start + INSERT_CHUNK));
  }
}

/** The `facts` rows of `days` of one environment, every zone (a zone change rebuilds them). */
const factsOfDays = (rollup: RollupDescriptor, environmentId: string, days: readonly string[]) =>
  and(
    eq(columnOf(rollup, 'environmentId'), environmentId),
    eq(columnOf(rollup, 'source'), 'facts'),
    inArray(columnOf(rollup, 'day'), [...days]),
  );

const keyString = (rollup: RollupDescriptor, row: AnyRow): string =>
  JSON.stringify([row.day, row.timeZone, ...rollup.dimensions.map((field) => row[field] ?? null)]);

export interface ReplaceFacts {
  environmentId: string;
  days: readonly string[];
  /** `all`: every table and column; `live`: the live counts only (C163.4, P21). */
  columns: 'all' | 'live';
  cohort: CohortRollups;
  cases: CaseRollups;
}

/**
 * Deletes and inserts again the `facts` rows of `days`, in the caller's transaction. With `live`,
 * only the tables that hold a live count change: each row keeps its outcome columns and histogram as
 * the last full recompute left them, takes the new live counts (0 for a key no longer counted), and
 * a key counted for the first time starts with its outcomes at 0.
 */
export async function replaceFactsInTx(tx: Db, input: ReplaceFacts): Promise<void> {
  const { environmentId, days, columns } = input;
  if (days.length === 0) {
    return;
  }
  const sources = { ...input.cohort, ...input.cases } as unknown as Record<
    string,
    readonly AnyRow[]
  >;
  for (const rollup of ROLLUPS) {
    if (columns === 'live' && rollup.live.length === 0) {
      continue;
    }
    const fresh = sources[rollup.rows] ?? [];
    let rows: readonly AnyRow[] = fresh;
    if (columns === 'live') {
      const kept = (await tx
        .select()
        .from(tableOf(rollup))
        .where(factsOfDays(rollup, environmentId, days))) as AnyRow[];
      rows = mergeLive(rollup, kept, fresh);
    }
    await tx.delete(tableOf(rollup)).where(factsOfDays(rollup, environmentId, days));
    await insertRows(tx, rollup, rows);
  }
}

/** The live merge: outcomes kept by key, live counts taken from `fresh`. */
function mergeLive(
  rollup: RollupDescriptor,
  kept: readonly AnyRow[],
  fresh: readonly AnyRow[],
): AnyRow[] {
  const merged = new Map<string, AnyRow>();
  for (const row of kept) {
    const zeroed: AnyRow = { ...row };
    for (const field of rollup.live) {
      zeroed[field] = 0;
    }
    merged.set(keyString(rollup, row), zeroed);
  }
  for (const row of fresh) {
    const key = keyString(rollup, row);
    const existing = merged.get(key);
    if (existing === undefined) {
      const started: AnyRow = { ...row };
      for (const field of rollup.counts) {
        if (!rollup.live.includes(field)) {
          started[field] = 0;
        }
      }
      merged.set(key, started);
    } else {
      for (const field of rollup.live) {
        existing[field] = row[field];
      }
    }
  }
  // A key with nothing left to count is dropped.
  return [...merged.values()].filter(
    (row) =>
      rollup.counts.some((field) => Number(row[field]) > 0) ||
      (rollup.histogram !== undefined &&
        (row[rollup.histogram] as number[]).some((count) => count > 0)),
  );
}

/** Each table's rows of a contribution, with the source given. */
function contributionRows(
  rollup: RollupDescriptor,
  cohort: CohortRollups,
  source: 'facts' | 'redacted',
): AnyRow[] {
  const rows = (cohort as unknown as Record<string, readonly AnyRow[] | undefined>)[rollup.rows];
  return (rows ?? []).map((row) => ({ ...row, source }));
}

/**
 * Adds an inquiry's contribution (computed with `source = 'redacted'`) to the `redacted` rows: an
 * upsert on each table's key, adding counts and histograms. Counts only, no inquiry id.
 */
export async function addRedactedInTx(tx: Db, cohort: CohortRollups): Promise<void> {
  for (const rollup of COHORT_ROLLUPS) {
    const rows = contributionRows(rollup, cohort, 'redacted');
    if (rows.length === 0) {
      continue;
    }
    const table = tableOf(rollup);
    const set: Record<string, SQL> = {};
    for (const field of rollup.counts) {
      const column = columnOf(rollup, field);
      set[field] = sql`${column} + excluded.${sql.identifier(column.name)}`;
    }
    if (rollup.histogram !== undefined) {
      const column = columnOf(rollup, rollup.histogram);
      set[rollup.histogram] = sql`array(select a + b from unnest(${column},
        excluded.${sql.identifier(column.name)}) as h(a, b))`;
    }
    for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
      await tx
        .insert(table)
        .values(rows.slice(start, start + INSERT_CHUNK))
        .onConflictDoUpdate({
          target: ['environmentId', 'day', 'timeZone', 'source', ...rollup.dimensions].map(
            (field) => columnOf(rollup, field),
          ),
          set,
        });
    }
  }
}

/** Thrown inside the savepoint when a `facts` row cannot give the contribution back. */
class NotSubtractable extends Error {}

/**
 * Moves an inquiry's contribution out of the `facts` rows of its day: each row of the same key loses
 * the contribution's counts and histogram, in a savepoint. Answers `false`, changing nothing, when a
 * row is missing or holds less than the contribution (the inquiry's outcome changed since the last
 * full recompute); the caller then recomputes the day without the inquiry.
 */
export async function subtractFactsInTx(tx: Db, cohort: CohortRollups): Promise<boolean> {
  try {
    await tx.transaction(async (savepoint) => {
      for (const rollup of COHORT_ROLLUPS) {
        for (const row of contributionRows(rollup, cohort, 'facts')) {
          const matches: SQL[] = [
            eq(columnOf(rollup, 'environmentId'), row.environmentId as string),
            eq(columnOf(rollup, 'day'), row.day as string),
            eq(columnOf(rollup, 'timeZone'), row.timeZone as string),
            eq(columnOf(rollup, 'source'), 'facts'),
          ];
          for (const field of rollup.dimensions) {
            const value = row[field] ?? null;
            const column = columnOf(rollup, field);
            matches.push(value === null ? isNull(column) : eq(column, value));
          }
          const set: Record<string, SQL> = {};
          for (const field of rollup.counts) {
            const column = columnOf(rollup, field);
            const amount = Number(row[field]);
            set[field] = sql`${column} - ${amount}`;
            matches.push(sql`${column} >= ${amount}`);
          }
          if (rollup.histogram !== undefined) {
            const column = columnOf(rollup, rollup.histogram);
            const amounts = `{${(row[rollup.histogram] as number[]).join(',')}}`;
            set[rollup.histogram] = sql`array(select a - b from unnest(${column},
              ${amounts}::int[]) as h(a, b))`;
            matches.push(sql`0 <= all(array(select a - b from unnest(${column},
              ${amounts}::int[]) as h(a, b)))`);
          }
          const updated = await savepoint
            .update(tableOf(rollup))
            .set(set as never)
            .where(and(...matches))
            .returning({ day: columnOf(rollup, 'day') });
          if (updated.length !== 1) {
            throw new NotSubtractable();
          }
        }
      }
    });
    return true;
  } catch (error: unknown) {
    if (error instanceof NotSubtractable) {
      return false;
    }
    throw error;
  }
}

/**
 * C251.1 (Phase 11, Workflow 11B Stage 2, `quotas`; decision 38, review F12): the admission rows of the
 * capped queues whose work this release admits, and the per-environment, per-queue slots of
 * `queue_slots` (foundation-11b's generalisation of Phase 8's slots, amendment 11).
 *
 * - A row is **in flight** once admitted (`admitted_at` set) and while unfinished; it is **held**
 *   while unfinished and not admitted. Nothing is a counter: every count reads the queue's own rows.
 * - The **slot lock** is a transaction-scoped advisory lock on (environment, queue), so two producers of
 *   one environment cannot both take its last slot, and a slot row exists only once the sweep has
 *   served the environment (`last_served_at`, the fair sweep's turn).
 * - Ids and times only: no column read here holds personal data.
 *
 * `process-verification` (verifications submitted), `report-run` (runs pending or running of a report
 * not redacted), `connect-redeem` (pending share tokens, the destination's work), `account-export`
 * (pending exports) and `integrity-decode` (challenges whose posted token waits for its decode).
 */
import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../client.js';
import { queueSlots } from '../tables/queue-slots.js';

/** The capped queues whose rows this file counts, holds and admits. */
export const ADMISSION_ROW_QUEUES = [
  'process-verification',
  'report-run',
  'connect-redeem',
  'account-export',
  'integrity-decode',
] as const;
export type AdmissionRowQueue = (typeof ADMISSION_ROW_QUEUES)[number];

interface QueueTable {
  readonly table: string;
  /** The environment the work belongs to (the destination's for a share token). */
  readonly environment: string;
  /** Since when a row waits (for the order and the admission wait). */
  readonly since: SQL;
  /** The row is unfinished (alias `t`). */
  readonly unfinished: SQL;
  /** A column the job needs besides the id (`report-run`'s report). */
  readonly extra?: string;
}

const t = (name: string) => sql`t.${sql.identifier(name)}`;

const QUEUE_TABLES: Readonly<Record<AdmissionRowQueue, QueueTable>> = {
  'process-verification': {
    table: 'verifications',
    environment: 'environment_id',
    since: sql`coalesce(t.submitted_at, t.created_at)`,
    unfinished: sql`t.status = 'submitted'`,
  },
  'report-run': {
    table: 'report_runs',
    environment: 'environment_id',
    since: sql`t.scheduled_for`,
    unfinished: sql`t.status in ('pending', 'running') and exists (
      select 1 from reports r
       where r.environment_id = t.environment_id and r.id = t.report_id and r.redacted_at is null)`,
    extra: 'report_id',
  },
  'connect-redeem': {
    table: 'connect_share_tokens',
    environment: 'destination_environment_id',
    since: sql`coalesce(t.pending_at, t.created_at)`,
    unfinished: sql`t.status = 'pending' and t.destination_environment_id is not null`,
  },
  'account-export': {
    table: 'account_exports',
    environment: 'environment_id',
    since: sql`t.created_at`,
    unfinished: sql`t.status = 'pending'`,
  },
  'integrity-decode': {
    table: 'inquiry_integrity_challenges',
    environment: 'environment_id',
    since: sql`coalesce(t.consumed_at, t.created_at)`,
    unfinished: sql`t.token is not null`,
  },
};

/** A held or lost row: its environment, id, since when it waits, and the extra column its job needs. */
export interface QueueRowRef {
  readonly environmentId: string;
  readonly id: string;
  readonly since: Date;
  /** `report-run`: the run's report id; otherwise null. */
  readonly extra: string | null;
}

interface RawRow {
  environment_id: string;
  id: string;
  since: string | Date;
  extra: string | null;
}

function rowsOf<T>(result: unknown): T[] {
  return (result as { rows: T[] }).rows;
}

function from(spec: QueueTable): SQL {
  return sql`${sql.identifier(spec.table)} t`;
}

function selectRef(spec: QueueTable): SQL {
  return sql`${t(spec.environment)} as environment_id, t.id as id, ${spec.since} as since, ${
    spec.extra === undefined ? sql`null::text` : t(spec.extra)
  } as extra`;
}

function refOf(row: RawRow): QueueRowRef {
  return {
    environmentId: row.environment_id,
    id: row.id,
    since: row.since instanceof Date ? row.since : new Date(row.since),
    extra: row.extra,
  };
}

function held(spec: QueueTable): SQL {
  return sql`${spec.unfinished} and t.admitted_at is null`;
}

function idIn(ids: readonly string[]): SQL {
  return sql`t.id in (${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )})`;
}

/** Serialises admissions of one environment and queue until the transaction ends. */
export async function lockQueueSlot(db: Db, environmentId: string, queue: string): Promise<void> {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`openverify:queue-slot:${environmentId}:${queue}`}, 0))`,
  );
}

/** The fair sweep's visit: the slot's `last_served_at` is `now` (the row made on first use). */
export async function touchQueueSlot(
  db: Db,
  environmentId: string,
  queue: string,
  now: Date,
): Promise<void> {
  await db
    .insert(queueSlots)
    .values({ environmentId, queue: queue as never, lastServedAt: now })
    .onConflictDoUpdate({
      target: [queueSlots.environmentId, queueSlots.queue],
      set: { lastServedAt: now, updatedAt: sql`now()` },
    });
}

/** Admitted and unfinished rows of the environment: its in-flight count. */
export async function countQueueInFlight(
  db: Db,
  queue: AdmissionRowQueue,
  environmentId: string,
): Promise<number> {
  const spec = QUEUE_TABLES[queue];
  const result = await db.execute(sql`
    select count(*)::int as n from ${from(spec)}
     where ${t(spec.environment)} = ${environmentId} and ${spec.unfinished} and t.admitted_at is not null`);
  return Number(rowsOf<{ n: number | string }>(result)[0]?.n ?? 0);
}

/** Held rows of the environment, oldest first (then by id), at most `limit`, locked `SKIP LOCKED`. */
export async function claimHeldQueueRows(
  db: Db,
  queue: AdmissionRowQueue,
  environmentId: string,
  limit: number,
): Promise<QueueRowRef[]> {
  const spec = QUEUE_TABLES[queue];
  const result = await db.execute(sql`
    select ${selectRef(spec)} from ${from(spec)}
     where ${t(spec.environment)} = ${environmentId} and ${held(spec)}
     order by ${spec.since}, t.id
     limit ${limit}
     for update of t skip locked`);
  return rowsOf<RawRow>(result).map(refOf);
}

/** Stamps `admitted_at` on the environment's held rows `ids` (a stamped row keeps its first time). */
export async function markQueueRowsAdmitted(
  db: Db,
  queue: AdmissionRowQueue,
  environmentId: string,
  ids: readonly string[],
  at: Date,
): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const spec = QUEUE_TABLES[queue];
  await db.execute(sql`
    update ${from(spec)} set admitted_at = ${at.toISOString()}::timestamptz
     where ${t(spec.environment)} = ${environmentId} and ${idIn(ids)} and t.admitted_at is null`);
}

/** Clears the stamp of rows whose enqueue failed, so they are held again. */
export async function releaseQueueRows(
  db: Db,
  queue: AdmissionRowQueue,
  environmentId: string,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const spec = QUEUE_TABLES[queue];
  await db.execute(sql`
    update ${from(spec)} set admitted_at = null
     where ${t(spec.environment)} = ${environmentId} and ${idIn(ids)}`);
}

/** Environments with held rows: never served first, then the longest unserved, then by id. */
export async function listHeldQueueEnvironments(
  db: Db,
  queue: AdmissionRowQueue,
  limit: number,
): Promise<string[]> {
  const spec = QUEUE_TABLES[queue];
  const result = await db.execute(sql`
    select h.environment_id from (
      select distinct ${t(spec.environment)} as environment_id from ${from(spec)} where ${held(spec)}
    ) h
    left join queue_slots s on s.environment_id = h.environment_id and s.queue = ${queue}
     order by s.last_served_at asc nulls first, h.environment_id asc
     limit ${limit}`);
  return rowsOf<{ environment_id: string }>(result).map((row) => row.environment_id);
}

/** Admitted, unfinished rows admitted before `before`, oldest admission first: never a held row. */
export async function listLostQueueRows(
  db: Db,
  queue: AdmissionRowQueue,
  options: { before: Date; limit: number },
): Promise<QueueRowRef[]> {
  const spec = QUEUE_TABLES[queue];
  const result = await db.execute(sql`
    select ${selectRef(spec)} from ${from(spec)}
     where ${spec.unfinished} and t.admitted_at < ${options.before.toISOString()}::timestamptz
     order by t.admitted_at, t.id
     limit ${options.limit}`);
  return rowsOf<RawRow>(result).map(refOf);
}

/** A produced row as admission sees it: missing, finished, held or admitted. */
export type QueueRowState = 'missing' | 'finished' | 'held' | 'admitted';

/** The state of the environment's row `id`, read in the admission's transaction. */
export async function getQueueRowState(
  db: Db,
  queue: AdmissionRowQueue,
  environmentId: string,
  id: string,
): Promise<QueueRowState> {
  const spec = QUEUE_TABLES[queue];
  const result = await db.execute(sql`
    select (${spec.unfinished}) as unfinished, t.admitted_at is not null as admitted from ${from(spec)}
     where ${t(spec.environment)} = ${environmentId} and t.id = ${id}`);
  const row = rowsOf<{ unfinished: boolean; admitted: boolean }>(result)[0];
  if (row === undefined) {
    return 'missing';
  }
  if (row.admitted) {
    return 'admitted';
  }
  return row.unfinished ? 'held' : 'finished';
}

/**
 * C133.4 to C133.6 (Workflow 8B, checkpoint (Q)): the SLA columns of a case and the `case-sla`
 * sweep's batch. Owner `api-queues-sla`; `foundation-8b` froze the names, and the owner adds what
 * else it needs here. The transitions themselves are `case-logic`'s pure functions
 * (`apps/api/src/services/cases/sla/sla-state.ts`).
 */
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { cases } from '../tables/cases.js';

/** A running deadline the sweep found due, locked for this transaction. */
export interface DueCaseSla {
  environmentId: string;
  organizationId: string;
  caseId: string;
  slaEpoch: number;
  slaExpiresAt: Date;
}

/**
 * C133.6 (decision 60): running SLAs due at `now`, `FOR UPDATE SKIP LOCKED` (`cases_sla_due_idx`), at
 * most `limit` (500), earliest deadline first, so two sweepers never take one case.
 */
export async function lockDueCaseSlas(
  tx: Db,
  options: { now: Date; limit: number },
): Promise<DueCaseSla[]> {
  const result = await tx.execute(sql`
    select c.environment_id, e.organization_id, c.id, c.sla_epoch, c.sla_expires_at
    from cases c
    join environments e on e.id = c.environment_id
    where c.sla_state = 'running'
      and c.sla_expires_at <= ${options.now.toISOString()}::timestamptz
    order by c.sla_expires_at, c.id
    limit ${options.limit}
    for update of c skip locked`);
  return (
    result as {
      rows: {
        environment_id: string;
        organization_id: string;
        id: string;
        sla_epoch: number | string;
        sla_expires_at: string | Date;
      }[];
    }
  ).rows.map((row) => ({
    environmentId: row.environment_id,
    organizationId: row.organization_id,
    caseId: row.id,
    slaEpoch: Number(row.sla_epoch),
    slaExpiresAt: new Date(row.sla_expires_at),
  }));
}

/**
 * Decision 59: the unredacted cases whose running or paused SLA counts on this calendar
 * (`cases_sla_calendar_idx`), `FOR UPDATE`, in id order, for a calendar edit's recompute.
 */
export async function lockCasesOnCalendar(
  tx: Db,
  environmentId: string,
  caseCalendarId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ id: cases.id })
    .from(cases)
    .where(
      and(
        eq(cases.environmentId, environmentId),
        eq(cases.slaCaseCalendarId, caseCalendarId),
        inArray(cases.slaState, ['running', 'paused']),
        isNull(cases.redactedAt),
      ),
    )
    .orderBy(asc(cases.id))
    .for('update');
  return rows.map(({ id }) => id);
}

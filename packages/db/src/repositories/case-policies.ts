/**
 * C132.2, C133.1, C133.2 (Workflow 8B, checkpoint (Q)): assignment policies with their sources, SLA
 * policies and business calendars. Owner `api-queues-sla`; `foundation-8b` froze the names, and the
 * owner adds what else it needs here. Every read and write is scoped to the environment.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type {
  CaseAssignmentDistribution,
  CaseAssignmentSort,
  CaseSlaOnReopen,
} from '@openverify/core';
import type { Db } from '../client.js';
import {
  caseAssignmentPolicies,
  caseCalendars,
  caseSlaPolicies,
  type CaseAssignmentPolicyRow,
  type CaseCalendarRow,
  type CaseSlaPolicyRow,
} from '../tables/case-queues.js';
import {
  caseAssignmentPolicySources,
  type CaseAssignmentPolicySourceRow,
} from '../tables/cases.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import { allFilters, createdAtRange, equalsAny, firstOrNull, inserted } from './rows.js';

const policyIn = (environmentId: string, id: string) =>
  and(eq(caseAssignmentPolicies.environmentId, environmentId), eq(caseAssignmentPolicies.id, id));
const slaPolicyIn = (environmentId: string, id: string) =>
  and(eq(caseSlaPolicies.environmentId, environmentId), eq(caseSlaPolicies.id, id));
const calendarIn = (environmentId: string, id: string) =>
  and(eq(caseCalendars.environmentId, environmentId), eq(caseCalendars.id, id));

/** The policy, or `null` when this environment holds no such policy. */
export async function getCaseAssignmentPolicyRow(
  db: Db,
  environmentId: string,
  id: string,
): Promise<CaseAssignmentPolicyRow | null> {
  return firstOrNull(
    await db.select().from(caseAssignmentPolicies).where(policyIn(environmentId, id)).limit(1),
  );
}

/** A policy's sources in priority order (`position`). */
export async function listCaseAssignmentPolicySources(
  db: Db,
  environmentId: string,
  caseAssignmentPolicyId: string,
): Promise<CaseAssignmentPolicySourceRow[]> {
  return listCaseAssignmentPolicySourcesOf(db, environmentId, [caseAssignmentPolicyId]);
}

/** The SLA policy, or `null`. */
export async function getCaseSlaPolicyRow(
  db: Db,
  environmentId: string,
  id: string,
): Promise<CaseSlaPolicyRow | null> {
  return firstOrNull(
    await db.select().from(caseSlaPolicies).where(slaPolicyIn(environmentId, id)).limit(1),
  );
}

/** The calendar, or `null`. */
export async function getCaseCalendarRow(
  db: Db,
  environmentId: string,
  id: string,
): Promise<CaseCalendarRow | null> {
  return firstOrNull(
    await db.select().from(caseCalendars).where(calendarIn(environmentId, id)).limit(1),
  );
}

// ---------------------------------------------------------------------------------------------
// Assignment policies (C132.2)

/** A source as the service names it: a template or a queue, in priority order. */
export type CaseAssignmentSourceInput = { caseTemplateId: string } | { caseQueueId: string };

export interface NewCaseAssignmentPolicyRow {
  id: string;
  name: string;
  distribution: CaseAssignmentDistribution;
  sort: CaseAssignmentSort;
  agentIds: readonly string[] | null;
  maxCapacity: number | null;
  sources: readonly CaseAssignmentSourceInput[];
}

async function writeSources(
  tx: Db,
  environmentId: string,
  caseAssignmentPolicyId: string,
  sources: readonly CaseAssignmentSourceInput[],
): Promise<void> {
  await tx
    .delete(caseAssignmentPolicySources)
    .where(
      and(
        eq(caseAssignmentPolicySources.environmentId, environmentId),
        eq(caseAssignmentPolicySources.caseAssignmentPolicyId, caseAssignmentPolicyId),
      ),
    );
  if (sources.length === 0) {
    return;
  }
  await tx.insert(caseAssignmentPolicySources).values(
    sources.map((source, position) => ({
      environmentId,
      caseAssignmentPolicyId,
      position,
      caseTemplateId: 'caseTemplateId' in source ? source.caseTemplateId : null,
      caseQueueId: 'caseQueueId' in source ? source.caseQueueId : null,
    })),
  );
}

export async function createCaseAssignmentPolicyRow(
  tx: Db,
  environmentId: string,
  input: NewCaseAssignmentPolicyRow,
): Promise<CaseAssignmentPolicyRow> {
  const row = inserted(
    await tx
      .insert(caseAssignmentPolicies)
      .values({
        id: input.id,
        environmentId,
        name: input.name,
        distribution: input.distribution,
        sort: input.sort,
        agentIds: input.agentIds === null ? null : [...input.agentIds],
        maxCapacity: input.maxCapacity,
      })
      .returning(),
    'createCaseAssignmentPolicyRow',
  );
  await writeSources(tx, environmentId, row.id, input.sources);
  return row;
}

/** What a change sets; `sources` replaces the list whole. */
export interface CaseAssignmentPolicyChanges {
  name?: string;
  distribution?: CaseAssignmentDistribution;
  sort?: CaseAssignmentSort;
  agentIds?: readonly string[] | null;
  maxCapacity?: number | null;
  sources?: readonly CaseAssignmentSourceInput[];
  roundRobinCursor?: string | null;
}

export async function updateCaseAssignmentPolicyRow(
  tx: Db,
  environmentId: string,
  id: string,
  changes: CaseAssignmentPolicyChanges,
): Promise<CaseAssignmentPolicyRow | null> {
  const { sources, agentIds, ...rest } = changes;
  const row = firstOrNull(
    await tx
      .update(caseAssignmentPolicies)
      .set({
        ...rest,
        ...(agentIds === undefined ? {} : { agentIds: agentIds === null ? null : [...agentIds] }),
        // Every change touches the row, so `updated_at` moves with a sources-only change too.
        updatedAt: sql`now()`,
      })
      .where(policyIn(environmentId, id))
      .returning(),
  );
  if (row !== null && sources !== undefined) {
    await writeSources(tx, environmentId, id, sources);
  }
  return row;
}

/** C132.3: the policy row `FOR UPDATE`, for a case that enters no queue (its cursor). */
export async function lockCaseAssignmentPolicyRow(
  tx: Db,
  environmentId: string,
  id: string,
): Promise<CaseAssignmentPolicyRow | null> {
  return firstOrNull(
    await tx.select().from(caseAssignmentPolicies).where(policyIn(environmentId, id)).for('update'),
  );
}

/** The sources of each of these policies, in policy then priority order. */
export async function listCaseAssignmentPolicySourcesOf(
  db: Db,
  environmentId: string,
  caseAssignmentPolicyIds: readonly string[],
): Promise<CaseAssignmentPolicySourceRow[]> {
  if (caseAssignmentPolicyIds.length === 0) {
    return [];
  }
  return db
    .select()
    .from(caseAssignmentPolicySources)
    .where(
      and(
        eq(caseAssignmentPolicySources.environmentId, environmentId),
        inArray(caseAssignmentPolicySources.caseAssignmentPolicyId, [...caseAssignmentPolicyIds]),
      ),
    )
    .orderBy(
      asc(caseAssignmentPolicySources.caseAssignmentPolicyId),
      asc(caseAssignmentPolicySources.position),
    );
}

const policyCursor = environmentCursor(caseAssignmentPolicies);

/** C132.2: newest first (C1), `filter[distribution]`. */
export async function listCaseAssignmentPolicyRows(
  db: Db,
  environmentId: string,
  filters: {
    distributions?: readonly string[] | undefined;
    createdAtStart?: Date | undefined;
    createdAtEnd?: Date | undefined;
  },
  page: PageRequest,
): Promise<Page<CaseAssignmentPolicyRow>> {
  const conditions = allFilters([
    equalsAny(caseAssignmentPolicies.distribution, filters.distributions),
    ...createdAtRange(caseAssignmentPolicies.createdAt, filters),
  ]);
  if (conditions === null) {
    return { items: [], next: null };
  }
  return paginate(db, policyCursor, environmentId, page, (after, limit) =>
    db
      .select()
      .from(caseAssignmentPolicies)
      .where(and(eq(caseAssignmentPolicies.environmentId, environmentId), ...conditions, after))
      .orderBy(...newestFirst(policyCursor))
      .limit(limit),
  );
}

// ---------------------------------------------------------------------------------------------
// SLA policies (C133.1)

export interface NewCaseSlaPolicyRow {
  id: string;
  name: string;
  targetMinutes: number;
  caseCalendarId: string | null;
  onReopen: CaseSlaOnReopen;
}

export async function createCaseSlaPolicyRow(
  tx: Db,
  environmentId: string,
  input: NewCaseSlaPolicyRow,
): Promise<CaseSlaPolicyRow> {
  return inserted(
    await tx
      .insert(caseSlaPolicies)
      .values({ ...input, environmentId })
      .returning(),
    'createCaseSlaPolicyRow',
  );
}

/** What a change sets; `newRevision` moves `revision` by one (C133.4). */
export interface CaseSlaPolicyChanges {
  name?: string;
  targetMinutes?: number;
  caseCalendarId?: string | null;
  onReopen?: CaseSlaOnReopen;
  newRevision?: boolean;
}

export async function updateCaseSlaPolicyRow(
  tx: Db,
  environmentId: string,
  id: string,
  changes: CaseSlaPolicyChanges,
): Promise<CaseSlaPolicyRow | null> {
  const { newRevision, ...rest } = changes;
  return firstOrNull(
    await tx
      .update(caseSlaPolicies)
      .set({
        ...rest,
        ...(newRevision === true ? { revision: sql`${caseSlaPolicies.revision} + 1` } : {}),
      })
      .where(slaPolicyIn(environmentId, id))
      .returning(),
  );
}

const slaPolicyCursor = environmentCursor(caseSlaPolicies);

/** C133.1: newest first (C1), `filter[case-calendar-id]`. */
export async function listCaseSlaPolicyRows(
  db: Db,
  environmentId: string,
  filters: {
    caseCalendarIds?: readonly string[] | undefined;
    createdAtStart?: Date | undefined;
    createdAtEnd?: Date | undefined;
  },
  page: PageRequest,
): Promise<Page<CaseSlaPolicyRow>> {
  const conditions = allFilters([
    equalsAny(caseSlaPolicies.caseCalendarId, filters.caseCalendarIds),
    ...createdAtRange(caseSlaPolicies.createdAt, filters),
  ]);
  if (conditions === null) {
    return { items: [], next: null };
  }
  return paginate(db, slaPolicyCursor, environmentId, page, (after, limit) =>
    db
      .select()
      .from(caseSlaPolicies)
      .where(and(eq(caseSlaPolicies.environmentId, environmentId), ...conditions, after))
      .orderBy(...newestFirst(slaPolicyCursor))
      .limit(limit),
  );
}

// ---------------------------------------------------------------------------------------------
// Calendars (C133.2)

export interface CaseCalendarContent {
  name: string;
  timeZone: string;
  week: Readonly<Record<string, readonly { start: string; end: string }[]>>;
  holidays: readonly { date: string; label: string }[];
  closures: readonly { start: string; end: string; label: string }[];
}

const calendarValues = (content: Partial<CaseCalendarContent>) => ({
  ...(content.name === undefined ? {} : { name: content.name }),
  ...(content.timeZone === undefined ? {} : { timeZone: content.timeZone }),
  ...(content.week === undefined
    ? {}
    : {
        week: Object.fromEntries(
          Object.entries(content.week).map(([day, intervals]) => [day, [...intervals]]),
        ),
      }),
  ...(content.holidays === undefined ? {} : { holidays: [...content.holidays] }),
  ...(content.closures === undefined ? {} : { closures: [...content.closures] }),
});

export async function createCaseCalendarRow(
  tx: Db,
  environmentId: string,
  input: CaseCalendarContent & { id: string },
): Promise<CaseCalendarRow> {
  return inserted(
    await tx
      .insert(caseCalendars)
      .values({
        id: input.id,
        environmentId,
        name: input.name,
        timeZone: input.timeZone,
        ...calendarValues(input),
      } as typeof caseCalendars.$inferInsert)
      .returning(),
    'createCaseCalendarRow',
  );
}

/** C133.2: the calendar row `FOR UPDATE`, which an edit and its recompute hold. */
export async function lockCaseCalendarRow(
  tx: Db,
  environmentId: string,
  id: string,
): Promise<CaseCalendarRow | null> {
  return firstOrNull(
    await tx.select().from(caseCalendars).where(calendarIn(environmentId, id)).for('update'),
  );
}

export async function updateCaseCalendarRow(
  tx: Db,
  environmentId: string,
  id: string,
  changes: Partial<CaseCalendarContent>,
): Promise<CaseCalendarRow | null> {
  return firstOrNull(
    await tx
      .update(caseCalendars)
      .set({ ...calendarValues(changes), updatedAt: sql`now()` })
      .where(calendarIn(environmentId, id))
      .returning(),
  );
}

const calendarCursor = environmentCursor(caseCalendars);

/** C133.2: newest first (C1). */
export async function listCaseCalendarRows(
  db: Db,
  environmentId: string,
  filters: { createdAtStart?: Date | undefined; createdAtEnd?: Date | undefined },
  page: PageRequest,
): Promise<Page<CaseCalendarRow>> {
  return paginate(db, calendarCursor, environmentId, page, (after, limit) =>
    db
      .select()
      .from(caseCalendars)
      .where(
        and(
          eq(caseCalendars.environmentId, environmentId),
          ...createdAtRange(caseCalendars.createdAt, filters),
          after,
        ),
      )
      .orderBy(...newestFirst(calendarCursor))
      .limit(limit),
  );
}

/** K8-24 (Workflow 8D): a policy with sources, which the drain walks. */
export interface DrainableAssignmentPolicy {
  environmentId: string;
  organizationId: string;
  caseAssignmentPolicyId: string;
}

/**
 * K8-24 (C132.2): the assignment policies that name sources, at most `limit`, by environment and id.
 */
export async function listDrainableAssignmentPolicies(
  db: Db,
  limit: number,
): Promise<DrainableAssignmentPolicy[]> {
  const result = await db.execute<{
    environment_id: string;
    organization_id: string;
    policy_id: string;
  }>(sql`
    select distinct s.environment_id, e.organization_id, s.case_assignment_policy_id as policy_id
    from ${caseAssignmentPolicySources} s
    join environments e on e.id = s.environment_id
    order by s.environment_id, policy_id
    limit ${limit}`);
  return (
    result as { rows: { environment_id: string; organization_id: string; policy_id: string }[] }
  ).rows.map((row) => ({
    environmentId: row.environment_id,
    organizationId: row.organization_id,
    caseAssignmentPolicyId: row.policy_id,
  }));
}

/**
 * K8-24 (C132.2): the unassigned, open, unredacted cases a policy's sources hold, in the order it
 * takes them: by its sources' priority, then its `sort`, then age and id; at most `limit`.
 */
export async function listWaitingCasesOfPolicy(
  db: Db,
  input: { environmentId: string; caseAssignmentPolicyId: string; limit: number },
): Promise<string[]> {
  const result = await db.execute<{ id: string }>(sql`
    select c.id
    from cases c
    join ${caseAssignmentPolicySources} s
      on s.environment_id = c.environment_id
      and s.case_assignment_policy_id = ${input.caseAssignmentPolicyId}
      and (s.case_template_id = c.case_template_id or s.case_queue_id = c.case_queue_id)
    join ${caseAssignmentPolicies} p
      on p.environment_id = s.environment_id and p.id = s.case_assignment_policy_id
    where c.environment_id = ${input.environmentId}
      and c.assignee_id is null and c.status_category <> 'end' and c.redacted_at is null
    group by c.id, p.sort, c.sla_expires_at, c.created_at
    order by min(s.position),
      case when p.sort = 'sla-expires-at' then c.sla_expires_at end asc nulls last,
      c.created_at, c.id
    limit ${input.limit}`);
  return (result as { rows: { id: string }[] }).rows.map(({ id }) => id);
}

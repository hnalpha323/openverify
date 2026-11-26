/**
 * C132.1, C132.3 (Workflow 8B, checkpoint (Q)): queues, their members and the pull. Owner
 * `api-queues-sla`; `foundation-8b` froze the names, and the owner adds what else it needs here (the
 * repository index exports this file whole). Every read and write is scoped to the environment.
 *
 * User ids are ordered `COLLATE "C"`, code-unit order, which is the order `case-logic`'s round-robin
 * walks (`packages/core/src/cases/assignment.ts`).
 */
import { and, asc, eq, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../client.js';
import { caseQueueMembers, caseQueues } from '../tables/case-queues.js';
import type { CaseQueueMemberRow, CaseQueueRow } from '../tables/case-queues.js';
import { cases } from '../tables/cases.js';
import { templateVisibleTo, type CaseReader } from './cases.js';
import {
  environmentCursor,
  newestFirst,
  paginate,
  type Page,
  type PageRequest,
} from './pagination.js';
import { roleAssignmentReaches } from './roles.js';
import { allFilters, createdAtRange, equalsAny, firstOrNull, inserted, textArray } from './rows.js';

const inEnvironment = (environmentId: string, id: string) =>
  and(eq(caseQueues.environmentId, environmentId), eq(caseQueues.id, id));

const byUserId = sql`${caseQueueMembers.userId} collate "C"`;

/** The queue, or `null` when this environment holds no such queue. */
export async function getCaseQueueRow(
  db: Db,
  environmentId: string,
  id: string,
): Promise<CaseQueueRow | null> {
  return firstOrNull(
    await db.select().from(caseQueues).where(inEnvironment(environmentId, id)).limit(1),
  );
}

/** C132.3: the queue row `FOR UPDATE`, which every policy's assignment into it takes first. */
export async function lockCaseQueueRow(
  tx: Db,
  environmentId: string,
  id: string,
): Promise<CaseQueueRow | null> {
  return firstOrNull(
    await tx.select().from(caseQueues).where(inEnvironment(environmentId, id)).for('update'),
  );
}

/** A queue's members in user-id order, the order round-robin walks. */
export async function listCaseQueueMembers(
  db: Db,
  environmentId: string,
  caseQueueId: string,
): Promise<CaseQueueMemberRow[]> {
  return listCaseQueueMembersOf(db, environmentId, [caseQueueId]);
}

/**
 * C132.3: `POST /cases/next`: the most urgent unassigned, unresolved, unredacted case of these queues
 * that `reader` may see (C129.4), `FOR UPDATE SKIP LOCKED` (`cases_pull_idx`), or `null` when none
 * waits. The three conditions of the index's predicate are written as it states them, so the planner
 * can use it.
 *
 * Workflow 8C review R008 (Workflow 8D): each queue gives its own head, one limited ordered scan of
 * the index each (a lateral subquery), and the heads are merged; a single scan over `= ANY` of the
 * queues returned their rows queue by queue, so Postgres sorted every waiting case of every queue
 * under `FOR UPDATE`. Each head it reads is locked until the transaction ends, so a pull from N
 * queues holds up to N case rows for its short transaction, and a concurrent pull skips those
 * meanwhile, as it skips any locked case.
 */
export async function pullNextCaseId(
  tx: Db,
  environmentId: string,
  caseQueueIds: readonly string[],
  reader: CaseReader,
): Promise<string | null> {
  if (caseQueueIds.length === 0) {
    return null;
  }
  const queueIds = sql.join(
    [...new Set(caseQueueIds)].map((id) => sql`${id}`),
    sql`, `,
  );
  const result = await tx.execute<{ id: string }>(sql`
    select head.id from unnest(array[${queueIds}]::text[]) as queue(id)
    cross join lateral (
      select ${cases.id} as id, ${cases.slaExpiresAt} as sla_expires_at,
        ${cases.createdAt} as created_at
      from ${cases}
      where ${and(
        eq(cases.environmentId, environmentId),
        sql`${cases.caseQueueId} = queue.id`,
        isNull(cases.assigneeId),
        ne(cases.statusCategory, 'end'),
        isNull(cases.redactedAt),
        // C167.2 (Workflow 9B): the environment as the query's parameter, so the role subquery of
        // `roleAssignmentReaches` stays uncorrelated and the pull reads one case a queue (R008).
        templateVisibleTo(reader, environmentId, cases.caseTemplateId),
      )}
      order by ${cases.slaExpiresAt} asc nulls last, ${cases.createdAt} asc, ${cases.id} asc
      limit 1
      for update skip locked
    ) as head
    order by head.sla_expires_at asc nulls last, head.created_at asc, head.id asc
    limit 1`);
  return (result as { rows: { id: string }[] }).rows[0]?.id ?? null;
}

/** A member as written: the service applied the defaults. */
export interface CaseQueueMemberInput {
  userId: string;
  maxOpen: number;
  paused: boolean;
}

export interface NewCaseQueueRow {
  id: string;
  name: string;
  caseAssignmentPolicyId: string | null;
}

/** C132.1: a new active queue. */
export async function createCaseQueueRow(
  tx: Db,
  environmentId: string,
  input: NewCaseQueueRow,
): Promise<CaseQueueRow> {
  return inserted(
    await tx
      .insert(caseQueues)
      .values({
        id: input.id,
        environmentId,
        name: input.name,
        caseAssignmentPolicyId: input.caseAssignmentPolicyId,
      })
      .returning(),
    'createCaseQueueRow',
  );
}

/** What a change sets; `archivedAt` archives the queue, which is permanent (C132.1). */
export interface CaseQueueChanges {
  name?: string;
  caseAssignmentPolicyId?: string | null;
  archivedAt?: Date;
  roundRobinCursor?: string | null;
}

export async function updateCaseQueueRow(
  tx: Db,
  environmentId: string,
  id: string,
  changes: CaseQueueChanges,
): Promise<CaseQueueRow | null> {
  const { archivedAt, ...rest } = changes;
  return firstOrNull(
    await tx
      .update(caseQueues)
      .set({
        ...rest,
        ...(archivedAt === undefined ? {} : { status: 'archived' as const, archivedAt }),
      })
      .where(inEnvironment(environmentId, id))
      .returning(),
  );
}

/** C132.1: the whole list replaced; answers the users who left, in user-id order. */
export async function replaceCaseQueueMembers(
  tx: Db,
  environmentId: string,
  caseQueueId: string,
  members: readonly CaseQueueMemberInput[],
): Promise<{ removedUserIds: string[] }> {
  const kept = members.map(({ userId }) => userId);
  const ofQueue = and(
    eq(caseQueueMembers.environmentId, environmentId),
    eq(caseQueueMembers.caseQueueId, caseQueueId),
  );
  const removed = await tx
    .delete(caseQueueMembers)
    .where(
      and(
        ofQueue,
        kept.length === 0
          ? undefined
          : sql`not (${caseQueueMembers.userId} = any(${textArray(kept)}))`,
      ),
    )
    .returning({ userId: caseQueueMembers.userId });
  if (members.length > 0) {
    await tx
      .insert(caseQueueMembers)
      .values(
        members.map((member) => ({
          environmentId,
          caseQueueId,
          userId: member.userId,
          maxOpen: member.maxOpen,
          paused: member.paused,
        })),
      )
      .onConflictDoUpdate({
        target: [
          caseQueueMembers.environmentId,
          caseQueueMembers.caseQueueId,
          caseQueueMembers.userId,
        ],
        set: { maxOpen: sql`excluded.max_open`, paused: sql`excluded.paused` },
      });
  }
  return {
    removedUserIds: removed
      .map(({ userId }) => userId)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  };
}

/** The members of each of these queues, in queue then user-id order. */
export async function listCaseQueueMembersOf(
  db: Db,
  environmentId: string,
  caseQueueIds: readonly string[],
): Promise<CaseQueueMemberRow[]> {
  if (caseQueueIds.length === 0) {
    return [];
  }
  return db
    .select()
    .from(caseQueueMembers)
    .where(
      and(
        eq(caseQueueMembers.environmentId, environmentId),
        inArray(caseQueueMembers.caseQueueId, [...caseQueueIds]),
      ),
    )
    .orderBy(asc(caseQueueMembers.caseQueueId), byUserId);
}

/** `GET /case-queues`' filters; each list is "any of". */
export interface CaseQueueFilters {
  statuses?: readonly string[] | undefined;
  memberIds?: readonly string[] | undefined;
  createdAtStart?: Date | undefined;
  createdAtEnd?: Date | undefined;
}

const queueCursor = environmentCursor(caseQueues);

/** C132.1: newest first (C1). */
export async function listCaseQueueRows(
  db: Db,
  environmentId: string,
  filters: CaseQueueFilters,
  page: PageRequest,
): Promise<Page<CaseQueueRow>> {
  const conditions = allFilters([
    equalsAny(caseQueues.status, filters.statuses),
    filters.memberIds === undefined
      ? undefined
      : filters.memberIds.length === 0
        ? null
        : sql`exists (select 1 from ${caseQueueMembers}
            where ${caseQueueMembers.environmentId} = ${caseQueues.environmentId}
              and ${caseQueueMembers.caseQueueId} = ${caseQueues.id}
              and ${caseQueueMembers.userId} = any(${textArray(filters.memberIds)}))`,
    ...createdAtRange(caseQueues.createdAt, filters),
  ]);
  if (conditions === null) {
    return { items: [], next: null };
  }
  return paginate(db, queueCursor, environmentId, page, (after, limit) =>
    db
      .select()
      .from(caseQueues)
      .where(and(eq(caseQueues.environmentId, environmentId), ...conditions, after))
      .orderBy(...newestFirst(queueCursor))
      .limit(limit),
  );
}

/** C132.3: the active queues `userId` is a member of, in id order. */
export async function listMemberCaseQueueIds(
  db: Db,
  environmentId: string,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: caseQueues.id })
    .from(caseQueues)
    .innerJoin(
      caseQueueMembers,
      and(
        eq(caseQueueMembers.environmentId, caseQueues.environmentId),
        eq(caseQueueMembers.caseQueueId, caseQueues.id),
      ),
    )
    .where(
      and(
        eq(caseQueues.environmentId, environmentId),
        eq(caseQueues.status, 'active'),
        eq(caseQueueMembers.userId, userId),
      ),
    )
    .orderBy(asc(caseQueues.id));
  return rows.map(({ id }) => id);
}

const openInQueue = (environmentId: string, caseQueueId: string) =>
  and(
    eq(cases.environmentId, environmentId),
    eq(cases.caseQueueId, caseQueueId),
    ne(cases.statusCategory, 'end'),
    isNull(cases.redactedAt),
  );

/** C132.1: the open cases of a queue assigned to one of `userIds`, `FOR UPDATE`, in id order. */
export async function lockQueueCasesAssignedTo(
  tx: Db,
  environmentId: string,
  caseQueueId: string,
  userIds: readonly string[],
): Promise<string[]> {
  if (userIds.length === 0) {
    return [];
  }
  const rows = await tx
    .select({ id: cases.id })
    .from(cases)
    .where(and(openInQueue(environmentId, caseQueueId), inArray(cases.assigneeId, [...userIds])))
    .orderBy(asc(cases.id))
    .for('update');
  return rows.map(({ id }) => id);
}

/** C132.1: an archived queue's unassigned cases, `FOR UPDATE`, in id order. */
export async function lockUnassignedQueueCases(
  tx: Db,
  environmentId: string,
  caseQueueId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ id: cases.id })
    .from(cases)
    .where(and(openInQueue(environmentId, caseQueueId), isNull(cases.assigneeId)))
    .orderBy(asc(cases.id))
    .for('update');
  return rows.map(({ id }) => id);
}

/** What a policy reads of a person (C132.3), under the queue's lock. */
export interface CaseAssigneeFacts {
  userId: string;
  /** A user of the organisation whose status is `active`. */
  active: boolean;
  /** Holds `cases:write` through a role. */
  holdsCasesWrite: boolean;
  /** May see the template's cases (`visible-to-roles`); `true` when no template is named. */
  seesTemplate: boolean;
  /** Open, unredacted cases of this environment assigned to the user. */
  openCount: number;
  /** The user's latest assignment in this environment. */
  lastAssignedAt: Date | null;
}

/**
 * `exists` a role of `userId` holding `permission` in `environmentId` (C167.2: through an assignment
 * that reaches it, `roleAssignmentReaches`).
 */
const holdsPermission = (userId: SQL, environmentId: SQL, permission: string) =>
  sql`exists (select 1 from user_roles ur join roles r on r.id = ur.role_id
    where ur.user_id = ${userId} and ${permission} = any(r.permissions)
      and ${roleAssignmentReaches(sql`ur`, environmentId)})`;

/** `exists` the template, visible to `userId` (C129.4: no role listed, or a listed role held). */
const seesTemplateOf = (userId: SQL, environmentId: SQL, caseTemplateId: SQL) =>
  sql`exists (select 1 from case_templates t
    where t.environment_id = ${environmentId} and t.id = ${caseTemplateId}
      and (cardinality(t.visible_to_roles) = 0
        or t.visible_to_roles && array(select ur.role_id from user_roles ur
          where ur.user_id = ${userId} and ${roleAssignmentReaches(sql`ur`, environmentId)})))`;

/**
 * The facts of each of `userIds` that is a user of the organisation, in the order given; an id that
 * names nobody there is left out, so the caller reads it as inactive.
 */
export async function readCaseAssigneeFacts(
  db: Db,
  input: {
    environmentId: string;
    organizationId: string;
    caseTemplateId: string | null;
    userIds: readonly string[];
  },
): Promise<CaseAssigneeFacts[]> {
  if (input.userIds.length === 0) {
    return [];
  }
  const userId = sql.raw('u.id');
  const sees =
    input.caseTemplateId === null
      ? sql`true`
      : seesTemplateOf(userId, sql`${input.environmentId}`, sql`${input.caseTemplateId}`);
  const result = await db.execute(sql`
    select u.id as user_id,
      u.status = 'active' as active,
      ${holdsPermission(userId, sql`${input.environmentId}`, 'cases:write')} as holds,
      ${sees} as sees,
      (select count(*) from cases c
        where c.environment_id = ${input.environmentId} and c.assignee_id = u.id
          and c.status_category <> 'end' and c.redacted_at is null) as open_count,
      (select max(c.assigned_at) from cases c
        where c.environment_id = ${input.environmentId} and c.assignee_id = u.id)
        as last_assigned_at
    from users u
    where u.organization_id = ${input.organizationId}
      and u.id = any(${textArray(input.userIds)})`);
  const rows = (
    result as {
      rows: {
        user_id: string;
        active: boolean;
        holds: boolean;
        sees: boolean;
        open_count: string | number;
        last_assigned_at: string | Date | null;
      }[];
    }
  ).rows;
  const byId = new Map(rows.map((row) => [row.user_id, row]));
  return input.userIds.flatMap((id) => {
    const row = byId.get(id);
    return row === undefined
      ? []
      : [
          {
            userId: id,
            active: row.active,
            holdsCasesWrite: row.holds,
            seesTemplate: row.sees,
            openCount: Number(row.open_count),
            lastAssignedAt: row.last_assigned_at === null ? null : new Date(row.last_assigned_at),
          },
        ];
  });
}

/** A case the re-assignment sweep takes. */
export interface StrandedCase {
  environmentId: string;
  organizationId: string;
  caseId: string;
}

/**
 * C132.6: open, unredacted cases assigned to someone who is no active user of the organisation, holds
 * no `cases:write` or may not see the template, across environments, `FOR UPDATE SKIP LOCKED`, at
 * most `limit`, in id order.
 */
export async function lockStrandedCases(
  tx: Db,
  options: { limit: number },
): Promise<StrandedCase[]> {
  const userId = sql.raw('u.id');
  const result = await tx.execute(sql`
    select c.environment_id, e.organization_id, c.id
    from cases c
    join environments e on e.id = c.environment_id
    left join users u on u.id = c.assignee_id and u.organization_id = e.organization_id
    where c.assignee_id is not null and c.status_category <> 'end' and c.redacted_at is null
      and (u.id is null or u.status <> 'active'
        or not ${holdsPermission(userId, sql.raw('c.environment_id'), 'cases:write')}
        or not ${seesTemplateOf(userId, sql.raw('c.environment_id'), sql.raw('c.case_template_id'))})
    order by c.id
    limit ${options.limit}
    for update of c skip locked`);
  return (
    result as { rows: { environment_id: string; organization_id: string; id: string }[] }
  ).rows.map((row) => ({
    environmentId: row.environment_id,
    organizationId: row.organization_id,
    caseId: row.id,
  }));
}

/**
 * Phase 8, Workflow 8B Stage 1b, checkpoint (Q) (C132, C133): the configuration that routes cases and
 * times them. Each table belongs to an environment, and every reference between them is a composite
 * foreign key to `(environment_id, id)`, so the database refuses another environment's object.
 *
 * - `case_queues` (public `cqueue_`): a name and a status; archiving is permanent (C132.1). The policy
 *   that pushes its cases (C132.2), and the round-robin cursor: the last member it gave a case to, in
 *   user-id order (C132.3).
 * - `case_queue_members` (ours): each user once per queue, with `max_open` (1 to 500, default 50) and
 *   `paused`. A user's row goes with the user.
 * - `case_assignment_policies` (public `cap_`): the distribution, the sort, the agents (`null` means
 *   the routed queue's members), the capacity (`null` means each member's `max_open`), and a cursor
 *   for a case with no queue. Its sources, in priority order, are `case_assignment_policy_sources`
 *   in `cases.ts`, because they name templates.
 * - `case_sla_policies` (ours, `cslap_`): a target in business minutes, a calendar (`null` is
 *   `24x7`), `on_reopen` and the revision that each edit moves. A case copies what it pins (C133.4).
 * - `case_calendars` (ours, `ccal_`): a zone, a week, holidays and closures, whose shapes the
 *   contract holds (`packages/contracts/src/case-calendars.ts`).
 *
 * Plaintext by decision (C143.5): names, statuses, user ids, counts, targets, zones and dates are
 * configuration, never a subject's data. Their forms are listed in `docs/tdd/phase8-foundation-8b.tdd.md`.
 */
import {
  CASE_ASSIGNMENT_DISTRIBUTIONS,
  CASE_ASSIGNMENT_SORTS,
  CASE_LIMITS,
  CASE_QUEUE_STATUSES,
  CASE_SLA_ON_REOPEN,
  type CaseAssignmentDistribution,
  type CaseAssignmentSort,
  type CaseQueueStatus,
  type CaseSlaOnReopen,
} from '@openverify/core';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumnFormat, idFormat, oneOf, timestamptz, updatedAt } from './columns.js';
import { environmentId } from './environment-id.js';
import { users } from './users.js';

const limit = (name: keyof typeof CASE_LIMITS) => sql.raw(String(CASE_LIMITS[name].value));

/** C132.2: an assignment policy (`cap_`). Its sources are in `cases.ts`. */
export const caseAssignmentPolicies = pgTable(
  'case_assignment_policies',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    name: text('name').notNull(),
    distribution: text('distribution').$type<CaseAssignmentDistribution>().notNull(),
    sort: text('sort').$type<CaseAssignmentSort>().notNull().default('created-at'),
    /** `usr_` ids; `null` means the members of the queue a case is routed to. */
    agentIds: text('agent_ids').array(),
    /** `null` means each member's own `max_open`. */
    maxCapacity: integer('max_capacity'),
    /** C132.3: round-robin's last agent for a case with no queue (a queue keeps its own). */
    roundRobinCursor: text('round_robin_cursor'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('case_assignment_policies_environment_id_id_key').on(table.environmentId, table.id),
    index('case_assignment_policies_environment_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    idFormat('case_assignment_policies', table.id, 'cap'),
    check(
      'case_assignment_policies_name_length',
      sql`char_length(${table.name}) between 1 and ${limit('config-name-characters')}`,
    ),
    check(
      'case_assignment_policies_distribution_valid',
      oneOf(table.distribution, CASE_ASSIGNMENT_DISTRIBUTIONS),
    ),
    check('case_assignment_policies_sort_valid', oneOf(table.sort, CASE_ASSIGNMENT_SORTS)),
    check(
      'case_assignment_policies_agent_ids_count',
      sql`${table.agentIds} is null
        or cardinality(${table.agentIds}) between 1 and ${limit('policy-agents')}`,
    ),
    check(
      'case_assignment_policies_max_capacity_range',
      sql`${table.maxCapacity} is null
        or ${table.maxCapacity} between 1 and ${limit('member-max-open')}`,
    ),
    idColumnFormat(
      'case_assignment_policies_round_robin_cursor_format',
      table.roundRobinCursor,
      'usr',
    ),
  ],
);

/** C132.1: a queue (`cqueue_`). */
export const caseQueues = pgTable(
  'case_queues',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    name: text('name').notNull(),
    /** Archiving is permanent; an archived queue gives its unassigned cases back to no queue. */
    status: text('status').$type<CaseQueueStatus>().notNull().default('active'),
    /** C132.2: the policy that pushes this queue's cases; `null` leaves them to pull and to hand. */
    caseAssignmentPolicyId: text('case_assignment_policy_id'),
    /** C132.3: round-robin's last member, so the next turn starts after it in user-id order. */
    roundRobinCursor: text('round_robin_cursor'),
    archivedAt: timestamptz('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'case_queues_policy_fk',
      columns: [table.environmentId, table.caseAssignmentPolicyId],
      foreignColumns: [caseAssignmentPolicies.environmentId, caseAssignmentPolicies.id],
    }),
    unique('case_queues_environment_id_id_key').on(table.environmentId, table.id),
    index('case_queues_environment_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    idFormat('case_queues', table.id, 'cqueue'),
    check(
      'case_queues_name_length',
      sql`char_length(${table.name}) between 1 and ${limit('config-name-characters')}`,
    ),
    check('case_queues_status_valid', oneOf(table.status, CASE_QUEUE_STATUSES)),
    check(
      'case_queues_archived_with_status',
      sql`(${table.status} = 'archived') = (${table.archivedAt} is not null)`,
    ),
    idColumnFormat(
      'case_queues_case_assignment_policy_id_format',
      table.caseAssignmentPolicyId,
      'cap',
    ),
    idColumnFormat('case_queues_round_robin_cursor_format', table.roundRobinCursor, 'usr'),
  ],
);

/** C132.1 (ours): a queue's member, once per queue; the count (at most 200) is the service's. */
export const caseQueueMembers = pgTable(
  'case_queue_members',
  {
    environmentId: environmentId(),
    caseQueueId: text('case_queue_id').notNull(),
    userId: text('user_id').notNull(),
    maxOpen: integer('max_open').notNull().default(CASE_LIMITS['member-max-open-default'].value),
    /** A paused member is skipped by every policy and keeps no turn (C132.3). */
    paused: boolean('paused').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({
      name: 'case_queue_members_pkey',
      columns: [table.environmentId, table.caseQueueId, table.userId],
    }),
    foreignKey({
      name: 'case_queue_members_queue_fk',
      columns: [table.environmentId, table.caseQueueId],
      foreignColumns: [caseQueues.environmentId, caseQueues.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'case_queue_members_user_fk',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),
    // A person's queues (`filter[member-id]`, `POST /cases/next`, the re-assignment sweep).
    index('case_queue_members_user_idx').on(table.environmentId, table.userId),
    idColumnFormat('case_queue_members_user_id_format', table.userId, 'usr'),
    check(
      'case_queue_members_max_open_range',
      sql`${table.maxOpen} between 1 and ${limit('member-max-open')}`,
    ),
  ],
);

/** C133.2: a business calendar (`ccal_`). */
export const caseCalendars = pgTable(
  'case_calendars',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    name: text('name').notNull(),
    /** An IANA zone; whether the runtime knows it is the service's check (`calendar_invalid`). */
    timeZone: text('time_zone').notNull(),
    /** Each weekday to its `[start, end)` local `HH:MM` intervals. */
    week: jsonb('week').$type<Record<string, { start: string; end: string }[]>>().notNull(),
    /** `{ date, label }[]`. */
    holidays: jsonb('holidays').$type<{ date: string; label: string }[]>().notNull().default([]),
    /** `{ start, end, label }[]`, local date-times. */
    closures: jsonb('closures')
      .$type<{ start: string; end: string; label: string }[]>()
      .notNull()
      .default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('case_calendars_environment_id_id_key').on(table.environmentId, table.id),
    index('case_calendars_environment_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    idFormat('case_calendars', table.id, 'ccal'),
    check(
      'case_calendars_name_length',
      sql`char_length(${table.name}) between 1 and ${limit('config-name-characters')}`,
    ),
    check('case_calendars_time_zone_length', sql`char_length(${table.timeZone}) between 1 and 64`),
    check('case_calendars_week_object', sql`jsonb_typeof(${table.week}) = 'object'`),
    check(
      'case_calendars_holidays_array',
      sql`jsonb_typeof(${table.holidays}) = 'array'
        and jsonb_array_length(${table.holidays}) <= ${limit('calendar-holidays')}`,
    ),
    check(
      'case_calendars_closures_array',
      sql`jsonb_typeof(${table.closures}) = 'array'
        and jsonb_array_length(${table.closures}) <= ${limit('calendar-closures')}`,
    ),
  ],
);

/** C133.1 (ours): an SLA policy (`cslap_`); `revision` moves with each edit (C133.4). */
export const caseSlaPolicies = pgTable(
  'case_sla_policies',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    name: text('name').notNull(),
    targetMinutes: integer('target_minutes').notNull(),
    /** `null` counts around the clock (`24x7`). */
    caseCalendarId: text('case_calendar_id'),
    onReopen: text('on_reopen').$type<CaseSlaOnReopen>().notNull().default('continue'),
    revision: integer('revision').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'case_sla_policies_calendar_fk',
      columns: [table.environmentId, table.caseCalendarId],
      foreignColumns: [caseCalendars.environmentId, caseCalendars.id],
    }),
    unique('case_sla_policies_environment_id_id_key').on(table.environmentId, table.id),
    index('case_sla_policies_environment_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    // `filter[case-calendar-id]`, and a calendar edit's recompute (decision 59).
    index('case_sla_policies_calendar_idx')
      .on(table.environmentId, table.caseCalendarId)
      .where(sql`${table.caseCalendarId} is not null`),
    idFormat('case_sla_policies', table.id, 'cslap'),
    check(
      'case_sla_policies_name_length',
      sql`char_length(${table.name}) between 1 and ${limit('config-name-characters')}`,
    ),
    check(
      'case_sla_policies_target_minutes_range',
      sql`${table.targetMinutes} between 1 and ${limit('sla-target-minutes')}`,
    ),
    check('case_sla_policies_on_reopen_valid', oneOf(table.onReopen, CASE_SLA_ON_REOPEN)),
    check('case_sla_policies_revision_positive', sql`${table.revision} >= 1`),
    idColumnFormat('case_sla_policies_case_calendar_id_format', table.caseCalendarId, 'ccal'),
  ],
);

export type CaseQueueRow = typeof caseQueues.$inferSelect;
export type CaseQueueMemberRow = typeof caseQueueMembers.$inferSelect;
export type CaseAssignmentPolicyRow = typeof caseAssignmentPolicies.$inferSelect;
export type CaseSlaPolicyRow = typeof caseSlaPolicies.$inferSelect;
export type CaseCalendarRow = typeof caseCalendars.$inferSelect;

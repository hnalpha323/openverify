/**
 * Phase 8, Workflow 8B Stage 1b, checkpoint (C) (C129-C137, C140.1, C134.4): cases, their versioned
 * templates, held objects, comments, history, actions, notifications, field keys and bulk actions.
 *
 * - `case_templates` and `case_template_versions`: as C71 and C104, a draft changes, one version per
 *   template is published and publishing supersedes it; a case pins the version it was created under
 *   (C130.2). `case_name_counters` gives each template's next case number (C129.2, `KYC-6`).
 * - `cases`: `fields` is sealed JSON for its row (`cases.fields#<id>`), `null` only once redacted.
 *   Every actor is a pair of a type and an OpenVerify id, whole or not at all (decision 64). Its
 *   queue (C132.1) and its SLA (C133.4) came with checkpoint (Q): the SLA policy it pins is copied
 *   onto it (target, calendar, `on_reopen`), so a later edit of the policy moves only cases that
 *   start after it.
 * - `case_assignment_policy_sources` (checkpoint (Q), C132.2): a policy's sources in priority order,
 *   each a template or a queue of the same environment. The other (Q) tables are in
 *   `case-queues.ts`.
 * - one join table per held kind (C136.1), with composite foreign keys to `(environment_id, id)`, so
 *   the database refuses another environment's object; `attached_state` is plaintext and PII-free by
 *   rule (C136.3). A document is a document verification (H31), held in `case_verifications` with
 *   `held_as = 'document'`.
 * - `case_comments`: `message` sealed (`case_comments.message#<id>`), `null` once redacted (C134.2).
 * - `case_history`: append-only (the `openverify_case_history_append_only` trigger of migration
 *   0028, F12): an UPDATE is always refused, a DELETE only under `openverify.environment_deletion`
 *   or `openverify.retention`. It holds keys, ids and statuses, never a value (C131.4).
 * - `case_actions` with `case_action_templates` (C140.1); `user_notifications` (C134.4: a kind and a
 *   case, never comment text); `case_field_keys`, 64-hex HMACs of `searchable` fields (C136.4);
 *   `case_bulk_actions` (C137.4), whose request is sealed because a search or a comment can carry PII.
 * - `case_notification_emails` (K8-20, Workflow 8D, migration 0029): the link-only emails owed, an
 *   outbox the worker's sweep empties; ids and a kind, never an address or any case content.
 * - Workflow 9B Stage 1b (C), migration 0031 (C172.1-C172.5; contracts B34-B37): a version's
 *   `layout`, `checklists` and `preset_comments`; `case_checklist_states`, one row per item of a case,
 *   naming who checked it and when (keys and ids only, PII-free); the checklist history kinds; an
 *   action's `placement` in the header, the status switcher or a layout module, and its
 *   `visible_when`.
 *
 * Plaintext by decision (C143.5): names, keys, statuses, resolutions, tags, ids, kinds, timestamps,
 * counts and the attached states. Their forms are listed in `docs/tdd/phase8-foundation-8b.tdd.md`.
 */
import {
  CASE_ACTION_FIXED_PLACEMENTS,
  CASE_ACTION_MODULE_PLACEMENT_PATTERN,
  CASE_ACTION_STATUSES,
  CASE_ASSIGNER_TYPES,
  CASE_BULK_ACTIONS,
  CASE_BULK_STATUSES,
  CASE_CHECKLIST_HISTORY_KINDS,
  CASE_COMMENTER_TYPES,
  CASE_CREATOR_TYPES,
  CASE_HISTORY_KINDS,
  CASE_LIMITS,
  CASE_NOTIFICATION_EMAIL_KINDS,
  NOTIFICATION_KIND_SUBJECT,
  USER_NOTIFICATION_KINDS,
  CASE_RESOLVER_TYPES,
  CASE_SLA_ON_REOPEN,
  CASE_SLA_STARTS_ON,
  CASE_SLA_STATES,
  CASE_STATUS_CATEGORIES,
  CASE_STATUS_KEY_PATTERN,
  CASE_TEMPLATE_KEY_PATTERN,
  CASE_TEMPLATE_STATUSES,
  CASE_TEMPLATE_VERSION_STATUSES,
  CASE_UPDATER_TYPES,
  FIELD_KEY_PATTERN,
  TRANSACTION_LIMITS,
  type CaseActionStatus,
  type CaseAssignerType,
  type CaseBulkAction,
  type CaseBulkStatus,
  type CaseChecklistHistoryKind,
  type CaseCommenterType,
  type CaseCreatorType,
  type CaseHistoryKind,
  type CaseNotificationEmailKind,
  type NotificationSubjectType,
  type CaseResolverType,
  type CaseSlaOnReopen,
  type CaseSlaStartsOn,
  type CaseSlaState,
  type CaseStatusCategory,
  type CaseTemplateStatus,
  type CaseTemplateVersionStatus,
  type CaseUpdaterType,
  type UserNotificationKind,
} from '@openverify/core';
import { sql } from 'drizzle-orm';
import {
  bigint,
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
  uniqueIndex,
  type AnyPgColumn,
  type ExtraConfigColumn,
} from 'drizzle-orm/pg-core';
import { idPattern, type IdPrefix } from '../ids.js';
import { sealedColumn } from '../sealed.js';
import { accounts } from './accounts.js';
import {
  caseAssignmentPolicies,
  caseCalendars,
  caseQueues,
  caseSlaPolicies,
} from './case-queues.js';
import {
  createdAt,
  hexDigest,
  idColumnFormat,
  idFormat,
  lowerTags,
  oneOf,
  timestamptz,
  updatedAt,
  validTags,
  workflowRunStepId,
  workflowRunStepKey,
} from './columns.js';
import { environmentId } from './environment-id.js';
import { graphQueries } from './graph.js';
import { inquiries } from './inquiries.js';
import { reportRuns, reports } from './reports.js';
import { transactions } from './transactions.js';
import { users } from './users.js';
import { verifications } from './verifications.js';
import { webhooks } from './webhooks.js';
import { workflows } from './workflows.js';

/** `<column> ~ '<pattern>'`; the patterns are constants of core, never input. */
const matches = (column: AnyPgColumn, pattern: RegExp) =>
  sql`${column} ~ ${sql.raw(`'${pattern.source}'`)}`;

const limit = (name: keyof typeof CASE_LIMITS) => sql.raw(String(CASE_LIMITS[name].value));

/** C172.2 (contracts B35): a version holds at most 10 checklists. */
export const CASE_CHECKLISTS_MAX = 10;
/** C172.4 (contracts B35): a version holds at most 50 preset comments. */
export const CASE_PRESET_COMMENTS_MAX = 50;
/** C172.2 (contracts B35): a checklist's key and an item's key. */
const CHECKLIST_KEY_PATTERN = '^[a-z][a-z0-9-]{0,39}$';

/** The prefix of each actor type's id (decision 64): an OpenVerify id, never an address. */
const ACTOR_PREFIXES: Readonly<Record<string, IdPrefix>> = {
  user: 'usr',
  'api-key': 'key',
  'workflow-run': 'wfr',
  'case-assignment-policy': 'cap',
};

/**
 * An actor pair (C129.2): `[whole, type, id]` checks: whole or not at all, a type from `types`, and
 * an id with that type's prefix. A type outside {@link ACTOR_PREFIXES} names no prefix (the
 * history's `system`). A pair whose columns are both required takes the last two.
 */
function actorChecks(
  table: string,
  name: string,
  typeColumn: AnyPgColumn,
  idColumn: AnyPgColumn,
  types: readonly string[],
) {
  const formats = types.flatMap((type) => {
    const prefix = ACTOR_PREFIXES[type];
    return prefix === undefined
      ? []
      : [
          sql`(${typeColumn} is distinct from ${sql.raw(`'${type}'`)}
            or ${idColumn} ~ ${sql.raw(`'${idPattern(prefix)}'`)})`,
        ];
  });
  return [
    check(`${table}_${name}_is_whole`, sql`(${typeColumn} is null) = (${idColumn} is null)`),
    check(`${table}_${name}_type_valid`, oneOf(typeColumn, types)),
    check(
      `${table}_${name}_id_format`,
      sql.join(
        formats,
        sql`
      and `,
      ),
    ),
  ];
}

/** A status key (C130.2, Stage 1a amendment 20), as a field key reads. */
const statusFormat = (name: string, column: AnyPgColumn) =>
  check(
    name,
    sql`${matches(column, CASE_STATUS_KEY_PATTERN)}
      and char_length(${column}) <= ${limit('status-key-characters')}`,
  );

/** C130.1: a case template (`ctmpl_`); its content lives in its versions. */
export const caseTemplates = pgTable(
  'case_templates',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    name: text('name').notNull(),
    /** The prefix of its cases' names, unique per environment and never changed. */
    key: text('key').notNull(),
    /** An archived template takes no new case and keeps its cases. */
    status: text('status').$type<CaseTemplateStatus>().notNull().default('active'),
    /** Role ids (P14); empty means every role with `cases:read`. */
    visibleToRoles: text('visible_to_roles')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    archivedAt: timestamptz('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('case_templates_environment_id_id_key').on(table.environmentId, table.id),
    unique('case_templates_environment_id_key_key').on(table.environmentId, table.key),
    index('case_templates_environment_id_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    idFormat('case_templates', table.id, 'ctmpl'),
    check('case_templates_key_format', matches(table.key, CASE_TEMPLATE_KEY_PATTERN)),
    check('case_templates_status_valid', oneOf(table.status, CASE_TEMPLATE_STATUSES)),
    check(
      'case_templates_name_length',
      sql`char_length(${table.name}) between 1 and ${limit('template-name-characters')}`,
    ),
    check(
      'case_templates_archived_with_status',
      sql`(${table.status} = 'archived') = (${table.archivedAt} is not null)`,
    ),
    check(
      'case_templates_visible_to_roles_count',
      sql`cardinality(${table.visibleToRoles}) <= ${limit('visible-to-roles')}`,
    ),
  ],
);

/** C130.2: a version (`ctmplv_`) of a template. Drafts change; published versions never do. */
export const caseTemplateVersions = pgTable(
  'case_template_versions',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    caseTemplateId: text('case_template_id').notNull(),
    version: integer('version').notNull(),
    status: text('status').$type<CaseTemplateVersionStatus>().notNull().default('draft'),
    /** `FieldSchema[]`, the case subset (F37); checked by core at publish. */
    fieldSchemas: jsonb('field_schemas').$type<unknown[]>().notNull().default([]),
    /** `CaseStatusDefinition[]` (C130.2). */
    statuses: jsonb('statuses').$type<unknown[]>().notNull(),
    resolutions: text('resolutions')
      .array()
      .notNull()
      .default(sql`'{Approved,Declined}'::text[]`),
    /** Each status key to the keys it may move to; `null` means every status to every other. */
    transitions: jsonb('transitions').$type<Record<string, string[]>>(),
    defaultQueueId: text('default_queue_id'),
    assignmentPolicyId: text('assignment_policy_id'),
    slaPolicyId: text('sla_policy_id'),
    slaStartsOn: text('sla_starts_on').$type<CaseSlaStartsOn>().notNull().default('created'),
    heldObjectTypes: text('held_object_types')
      .array()
      .notNull()
      .default(
        sql`'{account,inquiry,report,report-run,transaction,verification,graph-query,document}'::text[]`,
      ),
    /** `{ max-files, types }` (C135); `null` takes the defaults. */
    attachmentPolicy: jsonb('attachment_policy').$type<Record<string, unknown>>(),
    /** User ids emailed a link when a case is created (P38). */
    notifyOnCreate: text('notify_on_create')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** `{ key, required-permissions }[]` (C142.2); `null` takes the default layout. */
    layoutModules: jsonb('layout_modules').$type<unknown[]>(),
    /** C172.1 (Workflow 9B): `{ columns, modules[] }`; `null` takes the default layout. */
    layout: jsonb('layout').$type<Record<string, unknown>>(),
    /** C172.2: `{ key, label, items[] }[]`, at most 10 (contracts B35). */
    checklists: jsonb('checklists').$type<unknown[]>().notNull().default([]),
    /** C172.4: `{ key, label, text }[]`, at most 50; an operator's text, never posted by itself. */
    presetComments: jsonb('preset_comments').$type<unknown[]>().notNull().default([]),
    publishedAt: timestamptz('published_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'case_template_versions_template_fk',
      columns: [table.environmentId, table.caseTemplateId],
      foreignColumns: [caseTemplates.environmentId, caseTemplates.id],
    }).onDelete('cascade'),
    // Checkpoint (Q): what a version names is its own environment's (C130.2).
    foreignKey({
      name: 'case_template_versions_default_queue_fk',
      columns: [table.environmentId, table.defaultQueueId],
      foreignColumns: [caseQueues.environmentId, caseQueues.id],
    }),
    foreignKey({
      name: 'case_template_versions_assignment_policy_fk',
      columns: [table.environmentId, table.assignmentPolicyId],
      foreignColumns: [caseAssignmentPolicies.environmentId, caseAssignmentPolicies.id],
    }),
    foreignKey({
      name: 'case_template_versions_sla_policy_fk',
      columns: [table.environmentId, table.slaPolicyId],
      foreignColumns: [caseSlaPolicies.environmentId, caseSlaPolicies.id],
    }),
    unique('case_template_versions_environment_id_id_key').on(table.environmentId, table.id),
    uniqueIndex('case_template_versions_case_template_id_version_key').on(
      table.caseTemplateId,
      table.version,
    ),
    uniqueIndex('case_template_versions_one_published_key')
      .on(table.caseTemplateId)
      .where(sql`${table.status} = 'published'`),
    uniqueIndex('case_template_versions_one_draft_key')
      .on(table.caseTemplateId)
      .where(sql`${table.status} = 'draft'`),
    index('case_template_versions_env_template_created_at_id_idx').on(
      table.environmentId,
      table.caseTemplateId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    idFormat('case_template_versions', table.id, 'ctmplv'),
    idColumnFormat('case_template_versions_case_template_id_format', table.caseTemplateId, 'ctmpl'),
    check('case_template_versions_version_positive', sql`${table.version} >= 1`),
    check(
      'case_template_versions_status_valid',
      oneOf(table.status, CASE_TEMPLATE_VERSION_STATUSES),
    ),
    check(
      'case_template_versions_published_at',
      sql`(${table.status} = 'draft') = (${table.publishedAt} is null)`,
    ),
    check(
      'case_template_versions_sla_starts_on_valid',
      oneOf(table.slaStartsOn, CASE_SLA_STARTS_ON),
    ),
    check(
      'case_template_versions_statuses_array',
      sql`jsonb_typeof(${table.statuses}) = 'array'
        and jsonb_array_length(${table.statuses}) <= ${limit('statuses')}`,
    ),
    check(
      'case_template_versions_field_schemas_array',
      sql`jsonb_typeof(${table.fieldSchemas}) = 'array'`,
    ),
    check(
      'case_template_versions_transitions_object',
      sql`${table.transitions} is null or jsonb_typeof(${table.transitions}) = 'object'`,
    ),
    check(
      'case_template_versions_attachment_policy_object',
      sql`${table.attachmentPolicy} is null or jsonb_typeof(${table.attachmentPolicy}) = 'object'`,
    ),
    check(
      'case_template_versions_layout_modules_array',
      sql`${table.layoutModules} is null or jsonb_typeof(${table.layoutModules}) = 'array'`,
    ),
    // C172.1, C172.2, C172.4 (Workflow 9B Stage 1b (C)); contracts B35's counts.
    check(
      'case_template_versions_layout_object',
      sql`${table.layout} is null or jsonb_typeof(${table.layout}) = 'object'`,
    ),
    check(
      'case_template_versions_checklists_array',
      sql`jsonb_typeof(${table.checklists}) = 'array'
        and jsonb_array_length(${table.checklists}) <= ${sql.raw(String(CASE_CHECKLISTS_MAX))}`,
    ),
    check(
      'case_template_versions_preset_comments_array',
      sql`jsonb_typeof(${table.presetComments}) = 'array'
        and jsonb_array_length(${table.presetComments}) <= ${sql.raw(String(CASE_PRESET_COMMENTS_MAX))}`,
    ),
    check(
      'case_template_versions_resolutions_count',
      sql`cardinality(${table.resolutions}) <= ${limit('resolutions')}`,
    ),
    check(
      'case_template_versions_notify_on_create_count',
      sql`cardinality(${table.notifyOnCreate}) <= ${limit('notify-on-create')}`,
    ),
    idColumnFormat(
      'case_template_versions_default_queue_id_format',
      table.defaultQueueId,
      'cqueue',
    ),
    idColumnFormat(
      'case_template_versions_assignment_policy_id_format',
      table.assignmentPolicyId,
      'cap',
    ),
    idColumnFormat('case_template_versions_sla_policy_id_format', table.slaPolicyId, 'cslap'),
  ],
);

/** C129.2: the last number a template gave a case, taken under the row's lock. */
export const caseNameCounters = pgTable(
  'case_name_counters',
  {
    environmentId: environmentId(),
    caseTemplateId: text('case_template_id').notNull(),
    lastValue: bigint('last_value', { mode: 'number' }).notNull(),
  },
  (table) => [
    primaryKey({
      name: 'case_name_counters_pkey',
      columns: [table.environmentId, table.caseTemplateId],
    }),
    foreignKey({
      name: 'case_name_counters_template_fk',
      columns: [table.environmentId, table.caseTemplateId],
      foreignColumns: [caseTemplates.environmentId, caseTemplates.id],
    }).onDelete('cascade'),
    check('case_name_counters_last_value_positive', sql`${table.lastValue} >= 1`),
  ],
);

/** C129.2, C131: a case (`case_`), pinned to the version it was created under. */
export const cases = pgTable(
  'cases',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    caseTemplateId: text('case_template_id').notNull(),
    caseTemplateVersionId: text('case_template_version_id').notNull(),
    /** The template key and a counter (`KYC-6`), unique per environment. */
    name: text('name').notNull(),
    /** A status key of the pinned version. */
    status: text('status').notNull(),
    statusCategory: text('status_category').$type<CaseStatusCategory>().notNull(),
    resolution: text('resolution'),
    /** C132.1: at most one queue, of its own environment. */
    caseQueueId: text('case_queue_id'),
    creatorType: text('creator_type').$type<CaseCreatorType>().notNull(),
    creatorId: text('creator_id').notNull(),
    assigneeId: text('assignee_id'),
    assignerType: text('assigner_type').$type<CaseAssignerType>(),
    assignerId: text('assigner_id'),
    assignedAt: timestamptz('assigned_at'),
    resolverType: text('resolver_type').$type<CaseResolverType>(),
    resolverId: text('resolver_id'),
    resolvedAt: timestamptz('resolved_at'),
    updaterType: text('updater_type').$type<CaseUpdaterType>(),
    updaterId: text('updater_id'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Each key to `{ type, value }`, sealed JSON; `null` only once redacted (C136.4). */
    fieldsSealed: sealedColumn('fields'),
    /** C131.2: compared with `meta.lock-version`, bumped by every change. */
    lockVersion: integer('lock_version').notNull().default(0),
    redactedAt: timestamptz('redacted_at'),
    /** C117.5: the run's step that created it; `null` for anything else. */
    workflowRunStepId: workflowRunStepId(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // C133.4 (checkpoint (Q)): the SLA, moved only by `case-logic`'s pure transitions (`sla-state.ts`).
    slaState: text('sla_state').$type<CaseSlaState>().notNull().default('none'),
    /** Moves on every start, pause, resume, recompute and clear: the sweep fires once per epoch. */
    slaEpoch: integer('sla_epoch').notNull().default(0),
    /** Business milliseconds used before the running segment. */
    slaConsumedMs: bigint('sla_consumed_ms', { mode: 'number' }).notNull().default(0),
    slaSegmentStartedAt: timestamptz('sla_segment_started_at'),
    /** The public `sla-expires-at`: `null` exactly while the state is `none` or `paused`. */
    slaExpiresAt: timestamptz('sla_expires_at'),
    slaExpiredAt: timestamptz('sla_expired_at'),
    slaMetAt: timestamptz('sla_met_at'),
    /** Business milliseconds the SLA counts to: the policy's target, or `sla-expires-in-seconds`. */
    slaTargetMs: bigint('sla_target_ms', { mode: 'number' }),
    /** The SLA policy and the revision it started under (C133.4); `null` for a public deadline. */
    slaPolicyId: text('sla_policy_id'),
    slaPolicyRevision: integer('sla_policy_revision'),
    /** The pinned revision's calendar; `null` is `24x7`. A calendar edit recomputes (decision 59). */
    slaCaseCalendarId: text('sla_case_calendar_id'),
    /** The pinned revision's `on-reopen` (decision 58); `continue` for a public deadline. */
    slaOnReopen: text('sla_on_reopen').$type<CaseSlaOnReopen>().notNull().default('continue'),
  },
  (table) => [
    ...workflowRunStepKey('cases', table.environmentId, table.workflowRunStepId),
    foreignKey({
      name: 'cases_queue_fk',
      columns: [table.environmentId, table.caseQueueId],
      foreignColumns: [caseQueues.environmentId, caseQueues.id],
    }),
    foreignKey({
      name: 'cases_sla_policy_fk',
      columns: [table.environmentId, table.slaPolicyId],
      foreignColumns: [caseSlaPolicies.environmentId, caseSlaPolicies.id],
    }),
    foreignKey({
      name: 'cases_sla_calendar_fk',
      columns: [table.environmentId, table.slaCaseCalendarId],
      foreignColumns: [caseCalendars.environmentId, caseCalendars.id],
    }),
    foreignKey({
      name: 'cases_template_fk',
      columns: [table.environmentId, table.caseTemplateId],
      foreignColumns: [caseTemplates.environmentId, caseTemplates.id],
    }),
    foreignKey({
      name: 'cases_version_fk',
      columns: [table.environmentId, table.caseTemplateVersionId],
      foreignColumns: [caseTemplateVersions.environmentId, caseTemplateVersions.id],
    }),
    unique('cases_environment_id_id_key').on(table.environmentId, table.id),
    unique('cases_environment_id_name_key').on(table.environmentId, table.name),
    index('cases_environment_id_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    // Workflow 8C review R007 (Workflow 8D, migration 0029): a case search (and an export by search)
    // sorted by a timestamp reads its page from an index in that order. `created_at` reads the index
    // above in either direction; a nullable timestamp sorts missing values last in both directions,
    // so each direction has its own key (`apps/api/src/services/cases/sort.ts`) and index.
    index('cases_environment_id_updated_at_id_idx').on(
      table.environmentId,
      table.updatedAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('cases_environment_id_resolved_at_last_asc_idx').on(
      table.environmentId,
      sql`coalesce(${table.resolvedAt}, 'infinity'::timestamptz)`,
      table.id,
    ),
    index('cases_environment_id_resolved_at_last_desc_idx').on(
      table.environmentId,
      sql`coalesce(${table.resolvedAt}, '-infinity'::timestamptz)`,
      table.id,
    ),
    index('cases_environment_id_sla_expires_at_last_asc_idx').on(
      table.environmentId,
      sql`coalesce(${table.slaExpiresAt}, 'infinity'::timestamptz)`,
      table.id,
    ),
    index('cases_environment_id_sla_expires_at_last_desc_idx').on(
      table.environmentId,
      sql`coalesce(${table.slaExpiresAt}, '-infinity'::timestamptz)`,
      table.id,
    ),
    index('cases_environment_id_template_status_created_at_id_idx').on(
      table.environmentId,
      table.caseTemplateId,
      table.status,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('cases_environment_id_assignee_created_at_id_idx')
      .on(
        table.environmentId,
        table.assigneeId,
        table.createdAt.desc().nullsFirst(),
        table.id.desc().nullsFirst(),
      )
      .where(sql`${table.assigneeId} is not null`),
    // C132.3: `POST /cases/next` takes the most urgent unassigned case of a queue `FOR UPDATE SKIP
    // LOCKED`, ordered by `sla_expires_at NULLS LAST, created_at, id` (`api-queues-sla`'s EXPLAIN test).
    index('cases_pull_idx')
      .on(table.environmentId, table.caseQueueId, table.slaExpiresAt, table.createdAt, table.id)
      .where(
        sql`${table.assigneeId} is null and ${table.statusCategory} <> 'end'
          and ${table.redactedAt} is null`,
      ),
    // C132.3, C132.6: a person's open cases, per queue (capacity, fewest-open, re-assignment).
    index('cases_open_assignee_idx')
      .on(table.environmentId, table.assigneeId, table.caseQueueId)
      .where(
        sql`${table.assigneeId} is not null and ${table.statusCategory} <> 'end'
          and ${table.redactedAt} is null`,
      ),
    // C133.6: the `case-sla` sweep takes the running deadlines that are due, across environments.
    index('cases_sla_due_idx')
      .on(table.slaExpiresAt)
      .where(sql`${table.slaState} = 'running'`),
    // Decision 59: a calendar edit recomputes the running and paused SLAs on it.
    index('cases_sla_calendar_idx')
      .on(table.environmentId, table.slaCaseCalendarId)
      .where(
        sql`${table.slaCaseCalendarId} is not null and ${table.slaState} in ('running', 'paused')`,
      ),
    // C139.3: the retention walks resolved, unredacted cases, oldest resolution first.
    index('cases_unredacted_resolved_at_idx')
      .on(table.resolvedAt)
      .where(sql`${table.redactedAt} is null and ${table.resolvedAt} is not null`),
    index('cases_lower_tags_idx').using('gin', lowerTags(table.tags)),
    validTags('cases_tags_valid', table.tags),
    idFormat('cases', table.id, 'case'),
    idColumnFormat('cases_case_template_id_format', table.caseTemplateId, 'ctmpl'),
    idColumnFormat('cases_case_template_version_id_format', table.caseTemplateVersionId, 'ctmplv'),
    idColumnFormat('cases_case_queue_id_format', table.caseQueueId, 'cqueue'),
    idColumnFormat('cases_assignee_id_format', table.assigneeId, 'usr'),
    check('cases_name_format', sql`${table.name} ~ '^[A-Z][A-Z0-9]{1,9}-[1-9][0-9]{0,17}$'`),
    statusFormat('cases_status_format', table.status),
    check('cases_status_category_valid', oneOf(table.statusCategory, CASE_STATUS_CATEGORIES)),
    check(
      'cases_resolution_length',
      sql`char_length(${table.resolution}) between 1 and ${limit('resolution-characters')}`,
    ),
    check(
      'cases_resolved_in_end',
      sql`(${table.statusCategory} = 'end') = (${table.resolvedAt} is not null)`,
    ),
    ...actorChecks(
      'cases',
      'creator',
      table.creatorType,
      table.creatorId,
      CASE_CREATOR_TYPES,
    ).slice(1),
    ...actorChecks('cases', 'assigner', table.assignerType, table.assignerId, CASE_ASSIGNER_TYPES),
    ...actorChecks('cases', 'resolver', table.resolverType, table.resolverId, CASE_RESOLVER_TYPES),
    ...actorChecks('cases', 'updater', table.updaterType, table.updaterId, CASE_UPDATER_TYPES),
    check('cases_lock_version_non_negative', sql`${table.lockVersion} >= 0`),
    check(
      'cases_fields_until_redacted',
      sql`${table.fieldsSealed} is not null or ${table.redactedAt} is not null`,
    ),
    // C133.4 (checkpoint (Q)).
    check('cases_sla_state_valid', oneOf(table.slaState, CASE_SLA_STATES)),
    check(
      'cases_sla_expires_at_with_state',
      sql`(${table.slaExpiresAt} is null) = (${table.slaState} in ('none', 'paused'))`,
    ),
    check(
      'cases_sla_target_with_state',
      sql`(${table.slaTargetMs} is null) = (${table.slaState} = 'none')`,
    ),
    check(
      'cases_sla_met_at_with_state',
      sql`${table.slaState} <> 'met' or ${table.slaMetAt} is not null`,
    ),
    check(
      'cases_sla_expired_at_with_state',
      sql`${table.slaState} <> 'expired' or ${table.slaExpiredAt} is not null`,
    ),
    check(
      'cases_sla_policy_is_whole',
      sql`(${table.slaPolicyId} is null) = (${table.slaPolicyRevision} is null)`,
    ),
    check(
      'cases_sla_calendar_with_policy',
      sql`${table.slaCaseCalendarId} is null or ${table.slaPolicyId} is not null`,
    ),
    check(
      'cases_sla_counts',
      sql`${table.slaEpoch} >= 0 and ${table.slaConsumedMs} >= 0
        and (${table.slaTargetMs} is null or ${table.slaTargetMs} > 0)
        and (${table.slaPolicyRevision} is null or ${table.slaPolicyRevision} >= 1)`,
    ),
    check('cases_sla_on_reopen_valid', oneOf(table.slaOnReopen, CASE_SLA_ON_REOPEN)),
    idColumnFormat('cases_sla_policy_id_format', table.slaPolicyId, 'cslap'),
    idColumnFormat('cases_sla_case_calendar_id_format', table.slaCaseCalendarId, 'ccal'),
  ],
);

/**
 * C132.2 (checkpoint (Q)): an assignment policy's sources in priority order (`position` from 0),
 * each a template or a queue of the policy's environment, each once.
 */
export const caseAssignmentPolicySources = pgTable(
  'case_assignment_policy_sources',
  {
    environmentId: environmentId(),
    caseAssignmentPolicyId: text('case_assignment_policy_id').notNull(),
    position: integer('position').notNull(),
    caseTemplateId: text('case_template_id'),
    caseQueueId: text('case_queue_id'),
  },
  (table) => [
    primaryKey({
      name: 'case_assignment_policy_sources_pkey',
      columns: [table.environmentId, table.caseAssignmentPolicyId, table.position],
    }),
    foreignKey({
      name: 'case_assignment_policy_sources_policy_fk',
      columns: [table.environmentId, table.caseAssignmentPolicyId],
      foreignColumns: [caseAssignmentPolicies.environmentId, caseAssignmentPolicies.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'case_assignment_policy_sources_template_fk',
      columns: [table.environmentId, table.caseTemplateId],
      foreignColumns: [caseTemplates.environmentId, caseTemplates.id],
    }),
    foreignKey({
      name: 'case_assignment_policy_sources_queue_fk',
      columns: [table.environmentId, table.caseQueueId],
      foreignColumns: [caseQueues.environmentId, caseQueues.id],
    }),
    unique('case_assignment_policy_sources_template_key').on(
      table.environmentId,
      table.caseAssignmentPolicyId,
      table.caseTemplateId,
    ),
    unique('case_assignment_policy_sources_queue_key').on(
      table.environmentId,
      table.caseAssignmentPolicyId,
      table.caseQueueId,
    ),
    // The policies a template or a queue is a source of.
    index('case_assignment_policy_sources_template_idx')
      .on(table.environmentId, table.caseTemplateId)
      .where(sql`${table.caseTemplateId} is not null`),
    index('case_assignment_policy_sources_queue_idx')
      .on(table.environmentId, table.caseQueueId)
      .where(sql`${table.caseQueueId} is not null`),
    check(
      'case_assignment_policy_sources_one_source',
      sql`num_nonnulls(${table.caseTemplateId}, ${table.caseQueueId}) = 1`,
    ),
    check(
      'case_assignment_policy_sources_position_range',
      sql`${table.position} >= 0 and ${table.position} < ${limit('policy-sources')}`,
    ),
    idColumnFormat(
      'case_assignment_policy_sources_case_template_id_format',
      table.caseTemplateId,
      'ctmpl',
    ),
    idColumnFormat(
      'case_assignment_policy_sources_case_queue_id_format',
      table.caseQueueId,
      'cqueue',
    ),
  ],
);

/** The columns every held-object join table shares (C136.3). */
const heldColumns = () => ({
  environmentId: environmentId(),
  caseId: text('case_id').notNull(),
  attachedByType: text('attached_by_type').$type<CaseCreatorType>().notNull(),
  attachedById: text('attached_by_id').notNull(),
  /** Plaintext and PII-free by rule: statuses, template or type ids, key timestamps, ids. */
  attachedState: jsonb('attached_state').$type<Record<string, unknown>>().notNull().default({}),
  /** `attached-at`. */
  createdAt: createdAt(),
});

/**
 * C136.1: a held-object join table for `kind`, holding `objectColumn`, with a composite foreign key
 * to the object's `(environment_id, id)`.
 */
function heldConstraints(
  name: string,
  table: {
    environmentId: AnyPgColumn;
    caseId: AnyPgColumn;
    attachedByType: AnyPgColumn;
    attachedById: AnyPgColumn;
    attachedState: AnyPgColumn;
    createdAt: ExtraConfigColumn;
  },
  object: ExtraConfigColumn,
  target: { environmentId: AnyPgColumn; id: AnyPgColumn },
  prefix: IdPrefix,
  objectName: string,
) {
  return [
    primaryKey({ name: `${name}_pkey`, columns: [table.environmentId, table.caseId, object] }),
    foreignKey({
      name: `${name}_case_fk`,
      columns: [table.environmentId, table.caseId],
      foreignColumns: [cases.environmentId, cases.id],
    }).onDelete('cascade'),
    foreignKey({
      name: `${name}_${objectName}_fk`,
      columns: [table.environmentId, object],
      foreignColumns: [target.environmentId, target.id],
    }).onDelete('cascade'),
    // Which cases hold an object (C128.2's case-holds rule, C143.4's filter, the inquiry's module).
    index(`${name}_object_idx`).on(table.environmentId, object),
    // A case's objects of this kind, newest first (C129.2, `GET /cases/:id/objects`).
    index(`${name}_case_created_at_idx`).on(
      table.environmentId,
      table.caseId,
      table.createdAt.desc().nullsFirst(),
      object.desc().nullsFirst(),
    ),
    idColumnFormat(`${name}_object_id_format`, object, prefix),
    ...actorChecks(
      name,
      'attached_by',
      table.attachedByType,
      table.attachedById,
      CASE_CREATOR_TYPES,
    ).slice(1),
    check(`${name}_attached_state_object`, sql`jsonb_typeof(${table.attachedState}) = 'object'`),
  ];
}

export const caseInquiries = pgTable(
  'case_inquiries',
  { ...heldColumns(), inquiryId: text('inquiry_id').notNull() },
  (table) => heldConstraints('case_inquiries', table, table.inquiryId, inquiries, 'inq', 'inquiry'),
);

export const caseAccounts = pgTable(
  'case_accounts',
  { ...heldColumns(), accountId: text('account_id').notNull() },
  (table) => heldConstraints('case_accounts', table, table.accountId, accounts, 'acc', 'account'),
);

export const caseReports = pgTable(
  'case_reports',
  { ...heldColumns(), reportId: text('report_id').notNull() },
  (table) => heldConstraints('case_reports', table, table.reportId, reports, 'rep', 'report'),
);

export const caseReportRuns = pgTable(
  'case_report_runs',
  { ...heldColumns(), reportRunId: text('report_run_id').notNull() },
  (table) =>
    heldConstraints('case_report_runs', table, table.reportRunId, reportRuns, 'rpr', 'report_run'),
);

export const caseTransactions = pgTable(
  'case_transactions',
  { ...heldColumns(), transactionId: text('transaction_id').notNull() },
  (table) =>
    heldConstraints(
      'case_transactions',
      table,
      table.transactionId,
      transactions,
      'txn',
      'transaction',
    ),
);

/** A verification, or a document, which is a document verification held as one (H31). */
export const CASE_VERIFICATION_HELD_AS = ['verification', 'document'] as const;
export type CaseVerificationHeldAs = (typeof CASE_VERIFICATION_HELD_AS)[number];

export const caseVerifications = pgTable(
  'case_verifications',
  {
    ...heldColumns(),
    verificationId: text('verification_id').notNull(),
    heldAs: text('held_as').$type<CaseVerificationHeldAs>().notNull().default('verification'),
  },
  (table) => [
    ...heldConstraints(
      'case_verifications',
      table,
      table.verificationId,
      verifications,
      'ver',
      'verification',
    ),
    check('case_verifications_held_as_valid', oneOf(table.heldAs, CASE_VERIFICATION_HELD_AS)),
  ],
);

export const caseGraphQueries = pgTable(
  'case_graph_queries',
  { ...heldColumns(), graphQueryId: text('graph_query_id').notNull() },
  (table) =>
    heldConstraints(
      'case_graph_queries',
      table,
      table.graphQueryId,
      graphQueries,
      'grphq',
      'graph_query',
    ),
);

/** C134: a comment (`cscm_`), append-only through the API; a redaction nulls its message. */
export const caseComments = pgTable(
  'case_comments',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    caseId: text('case_id').notNull(),
    /** PII, sealed; `null` once redacted. */
    messageSealed: sealedColumn('message'),
    commenterType: text('commenter_type').$type<CaseCommenterType>().notNull(),
    commenterId: text('commenter_id').notNull(),
    /** User ids the message names, checked when it was written (C134.3). */
    mentions: text('mentions')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    redactedAt: timestamptz('redacted_at'),
    /** C117.5: the run's step that wrote it; `null` for anything else. */
    workflowRunStepId: workflowRunStepId(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    ...workflowRunStepKey('case_comments', table.environmentId, table.workflowRunStepId),
    foreignKey({
      name: 'case_comments_case_fk',
      columns: [table.environmentId, table.caseId],
      foreignColumns: [cases.environmentId, cases.id],
    }).onDelete('cascade'),
    unique('case_comments_environment_id_id_key').on(table.environmentId, table.id),
    index('case_comments_case_created_at_id_idx').on(
      table.environmentId,
      table.caseId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    idFormat('case_comments', table.id, 'cscm'),
    ...actorChecks(
      'case_comments',
      'commenter',
      table.commenterType,
      table.commenterId,
      CASE_COMMENTER_TYPES,
    ).slice(1),
    check(
      'case_comments_mentions_count',
      sql`cardinality(${table.mentions}) <= ${limit('mentions-per-comment')}`,
    ),
    check(
      'case_comments_message_until_redacted',
      sql`${table.messageSealed} is not null or ${table.redactedAt} is not null`,
    ),
  ],
);

/** Who may stand in a history row (C131.4): the case's actors, and the system. */
export const CASE_HISTORY_ACTOR_TYPES = [
  'user',
  'api-key',
  'workflow-run',
  'case-assignment-policy',
  'system',
] as const;
export type CaseHistoryActorType = (typeof CASE_HISTORY_ACTOR_TYPES)[number];

/** C131.4: the timeline, append-only (file header), PII-free by rule. Its row number is its id. */
export const caseHistory = pgTable(
  'case_history',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    environmentId: environmentId(),
    caseId: text('case_id').notNull(),
    kind: text('kind').$type<CaseHistoryKind | CaseChecklistHistoryKind>().notNull(),
    actorType: text('actor_type').$type<CaseHistoryActorType>().notNull(),
    /** `null` for the system. */
    actorId: text('actor_id'),
    /** Keys, ids and statuses only (C131.4). */
    from: jsonb('from').$type<Record<string, unknown>>(),
    to: jsonb('to').$type<Record<string, unknown>>(),
    requestId: text('request_id'),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: 'case_history_case_fk',
      columns: [table.environmentId, table.caseId],
      foreignColumns: [cases.environmentId, cases.id],
    }).onDelete('cascade'),
    index('case_history_case_id_idx').on(
      table.environmentId,
      table.caseId,
      table.id.desc().nullsFirst(),
    ),
    // Workflow 9B Stage 1b (C) (B34): Phase 8's kinds and the checklist's (C172.2).
    check(
      'case_history_kind_valid',
      oneOf(table.kind, [...CASE_HISTORY_KINDS, ...CASE_CHECKLIST_HISTORY_KINDS]),
    ),
    check(
      'case_history_actor_valid',
      sql`(${table.actorType} = 'system' and ${table.actorId} is null)
        or (${table.actorType} <> 'system' and ${table.actorId} is not null)`,
    ),
    ...actorChecks(
      'case_history',
      'actor',
      table.actorType,
      table.actorId,
      CASE_HISTORY_ACTOR_TYPES,
    ).slice(1),
    check(
      'case_history_from_object',
      sql`${table.from} is null or jsonb_typeof(${table.from}) = 'object'`,
    ),
    check(
      'case_history_to_object',
      sql`${table.to} is null or jsonb_typeof(${table.to}) = 'object'`,
    ),
    check('case_history_request_id_length', sql`char_length(${table.requestId}) between 1 and 128`),
  ],
);

/** C172.2 (Workflow 9B; contracts B36): who checks a checklist item, as `checked-by` names them. */
export const CASE_CHECKLIST_ACTOR_TYPES = ['user', 'workflow-run'] as const;
export type CaseChecklistActorType = (typeof CASE_CHECKLIST_ACTOR_TYPES)[number];

/**
 * C172.2, C172.7 (Workflow 9B Stage 1b (C)): a case's checklist state, one row per item of its
 * version's checklists that was ever set. A checked item names who checked it (a user, or a workflow
 * run acting through Phase 8's actions) and when; an unchecked one names neither, so nothing reads
 * as checked on a person's behalf. Keys and ids only (PII-free, as `case_history`); deleted with its
 * case. Owner `api-cases-reports` (`repositories/case-checklists.ts`).
 */
export const caseChecklistStates = pgTable(
  'case_checklist_states',
  {
    environmentId: environmentId(),
    caseId: text('case_id').notNull(),
    checklistKey: text('checklist_key').notNull(),
    itemKey: text('item_key').notNull(),
    checked: boolean('checked').notNull(),
    checkedByType: text('checked_by_type').$type<CaseChecklistActorType>(),
    checkedById: text('checked_by_id'),
    checkedAt: timestamptz('checked_at'),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({
      name: 'case_checklist_states_pkey',
      columns: [table.environmentId, table.caseId, table.checklistKey, table.itemKey],
    }),
    foreignKey({
      name: 'case_checklist_states_case_fk',
      columns: [table.environmentId, table.caseId],
      foreignColumns: [cases.environmentId, cases.id],
    }).onDelete('cascade'),
    check(
      'case_checklist_states_checklist_key_format',
      sql`${table.checklistKey} ~ ${sql.raw(`'${CHECKLIST_KEY_PATTERN}'`)}`,
    ),
    check(
      'case_checklist_states_item_key_format',
      sql`${table.itemKey} ~ ${sql.raw(`'${CHECKLIST_KEY_PATTERN}'`)}`,
    ),
    check(
      'case_checklist_states_checked_whole',
      sql`${table.checked} = (${table.checkedByType} is not null)
        and ${table.checked} = (${table.checkedAt} is not null)`,
    ),
    ...actorChecks(
      'case_checklist_states',
      'checked_by',
      table.checkedByType,
      table.checkedById,
      CASE_CHECKLIST_ACTOR_TYPES,
    ),
  ],
);

/** C172.5: the statuses and roles that see an action; an empty list restricts nothing. */
export interface CaseActionVisibility {
  statuses: readonly string[];
  'role-ids': readonly string[];
}

/** C140.1: a case action (`cact_`) binding a `trigger-case` workflow to templates. */
export const caseActions = pgTable(
  'case_actions',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    workflowId: text('workflow_id').notNull(),
    label: text('label').notNull(),
    status: text('status').$type<CaseActionStatus>().notNull().default('active'),
    /**
     * C172.5 (Workflow 9B Stage 1b (C); B34): `header`, `status-switcher` or `module:<module key>`,
     * held by `case_actions_placement_valid` (core's `CASE_ACTION_FIXED_PLACEMENTS` and
     * `CASE_ACTION_MODULE_PLACEMENT_PATTERN`); a string, as the contract's input schema reads it.
     */
    placement: text('placement').notNull().default('header'),
    /** An input's name to a path, never a value (C140.1, P38). */
    prefill: jsonb('prefill').$type<Record<string, string>>().notNull().default({}),
    /** C172.5 (Workflow 9B): `{ statuses, role-ids }`; `null` restricts nothing. */
    visibleWhen: jsonb('visible_when').$type<CaseActionVisibility>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'case_actions_workflow_fk',
      columns: [table.environmentId, table.workflowId],
      foreignColumns: [workflows.environmentId, workflows.id],
    }).onDelete('cascade'),
    unique('case_actions_environment_id_id_key').on(table.environmentId, table.id),
    index('case_actions_environment_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    idFormat('case_actions', table.id, 'cact'),
    check('case_actions_status_valid', oneOf(table.status, CASE_ACTION_STATUSES)),
    // Workflow 9B Stage 1b (C) (B34): the header, the status switcher or a layout module (C172.5).
    check(
      'case_actions_placement_valid',
      sql`${oneOf(table.placement, CASE_ACTION_FIXED_PLACEMENTS)}
        or ${table.placement} ~ ${sql.raw(`'${CASE_ACTION_MODULE_PLACEMENT_PATTERN.source}'`)}`,
    ),
    check(
      'case_actions_visible_when_object',
      sql`${table.visibleWhen} is null or jsonb_typeof(${table.visibleWhen}) = 'object'`,
    ),
    check('case_actions_label_length', sql`char_length(${table.label}) between 1 and 80`),
    check('case_actions_prefill_object', sql`jsonb_typeof(${table.prefill}) = 'object'`),
  ],
);

/** C140.1: the templates an action is offered on (1 to 50, held by the service). */
export const caseActionTemplates = pgTable(
  'case_action_templates',
  {
    environmentId: environmentId(),
    caseActionId: text('case_action_id').notNull(),
    caseTemplateId: text('case_template_id').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'case_action_templates_pkey',
      columns: [table.environmentId, table.caseActionId, table.caseTemplateId],
    }),
    foreignKey({
      name: 'case_action_templates_action_fk',
      columns: [table.environmentId, table.caseActionId],
      foreignColumns: [caseActions.environmentId, caseActions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'case_action_templates_template_fk',
      columns: [table.environmentId, table.caseTemplateId],
      foreignColumns: [caseTemplates.environmentId, caseTemplates.id],
    }).onDelete('cascade'),
    // `GET /cases/:id/available-actions`: the actions of a case's template.
    index('case_action_templates_template_idx').on(table.environmentId, table.caseTemplateId),
  ],
);

/**
 * C134.4: a user's notification (`unot_`): a kind and its subject, never comment text or a field.
 *
 * C169.7 (Workflow 9B Stage 1b (W); review F18): the subject is polymorphic. A case kind names its case
 * in `case_id` (Phase 8's rows, with `user_notifications_case_fk`), `webhook-failure` its webhook in
 * `webhook_id` (with `user_notifications_webhook_fk`), and one CHECK per kind holds which
 * (`NOTIFICATION_KIND_SUBJECT`). `subject_type` and `subject_id` are derived from the two, so they can
 * never disagree with the foreign key that holds the subject.
 */
export const userNotifications = pgTable(
  'user_notifications',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<UserNotificationKind>().notNull(),
    /** A case kind's case; `NULL` for a webhook failure. */
    caseId: text('case_id'),
    /** C169.7: a webhook failure's webhook; `NULL` for a case kind. */
    webhookId: text('webhook_id'),
    subjectType: text('subject_type')
      .$type<NotificationSubjectType>()
      .notNull()
      .generatedAlwaysAs(sql`case when webhook_id is null then 'case' else 'webhook' end`),
    subjectId: text('subject_id')
      .notNull()
      .generatedAlwaysAs(sql`coalesce(case_id, webhook_id)`),
    readAt: timestamptz('read_at'),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: 'user_notifications_case_fk',
      columns: [table.environmentId, table.caseId],
      foreignColumns: [cases.environmentId, cases.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'user_notifications_webhook_fk',
      columns: [table.environmentId, table.webhookId],
      foreignColumns: [webhooks.environmentId, webhooks.id],
    }).onDelete('cascade'),
    index('user_notifications_user_created_at_id_idx').on(
      table.environmentId,
      table.userId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    // C134.4: kept 90 days, walked oldest first by the retention step.
    index('user_notifications_created_at_idx').on(table.createdAt),
    // C169.6: a webhook's alerts, for the sweep and for the foreign key's cascade.
    index('user_notifications_webhook_idx')
      .on(table.environmentId, table.webhookId)
      .where(sql`${table.webhookId} is not null`),
    idFormat('user_notifications', table.id, 'unot'),
    check('user_notifications_kind_valid', oneOf(table.kind, USER_NOTIFICATION_KINDS)),
    ...USER_NOTIFICATION_KINDS.map((kind) =>
      check(
        `user_notifications_${kind.replaceAll('-', '_')}_subject`,
        NOTIFICATION_KIND_SUBJECT[kind] === 'case'
          ? sql`${table.kind} <> ${sql.raw(`'${kind}'`)} or (${table.caseId} is not null and ${table.webhookId} is null)`
          : sql`${table.kind} <> ${sql.raw(`'${kind}'`)} or (${table.webhookId} is not null and ${table.caseId} is null)`,
      ),
    ),
  ],
);

/**
 * K8-20 (Workflow 8D; C133.7, C134.4, P38, decision 76): a link-only email owed to a user about a
 * case, written in the transaction that wrote its notification (or created the case, for
 * `notify-on-create`) and deleted once the worker's `case-notification-emails` sweep sent it,
 * skipped it or ran out of attempts. It holds ids and a kind; the address is read at send.
 */
export const caseNotificationEmails = pgTable(
  'case_notification_emails',
  {
    /** Its order of writing, which the sweep follows (the primary key's index). */
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    environmentId: environmentId(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<CaseNotificationEmailKind>().notNull(),
    caseId: text('case_id').notNull(),
    /** Sends tried, at most 3; `claimed_at` holds a running try for its lease. */
    attempts: integer('attempts').notNull().default(0),
    claimedAt: timestamptz('claimed_at'),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: 'case_notification_emails_case_fk',
      columns: [table.environmentId, table.caseId],
      foreignColumns: [cases.environmentId, cases.id],
    }).onDelete('cascade'),
    check('case_notification_emails_kind_valid', oneOf(table.kind, CASE_NOTIFICATION_EMAIL_KINDS)),
    check(
      'case_notification_emails_attempts_range',
      sql`${table.attempts} between 0 and 3 and (${table.attempts} = 0) = (${table.claimedAt} is null)`,
    ),
  ],
);

/** C136.4: the equality index of `searchable` case fields, one row per value (P25). */
export const caseFieldKeys = pgTable(
  'case_field_keys',
  {
    environmentId: environmentId(),
    caseId: text('case_id').notNull(),
    fieldKey: text('field_key').notNull(),
    /** 64 hex (`identifierKey`, labelled per case template and field key). */
    valueKey: text('value_key').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'case_field_keys_pkey',
      columns: [table.environmentId, table.caseId, table.fieldKey, table.valueKey],
    }),
    foreignKey({
      name: 'case_field_keys_case_fk',
      columns: [table.environmentId, table.caseId],
      foreignColumns: [cases.environmentId, cases.id],
    }).onDelete('cascade'),
    // `fields.<key> eq <value>` in `POST /cases/search`.
    index('case_field_keys_lookup_idx').on(
      table.environmentId,
      table.fieldKey,
      table.valueKey,
      table.caseId,
    ),
    check(
      'case_field_keys_field_key_format',
      sql`${matches(table.fieldKey, FIELD_KEY_PATTERN)}
        and char_length(${table.fieldKey}) <= ${sql.raw(String(TRANSACTION_LIMITS.fieldKeyLength))}`,
    ),
    hexDigest('case_field_keys_value_key_hex', table.valueKey),
  ],
);

/**
 * C137.4: an asynchronous bulk action (`cblk_`), read by its creating principal alone (Stage 1a
 * amendment 19). The request (a selection or a search, and the action's `meta`) is sealed
 * (`case_bulk_actions.request#<id>`), because a search can name field values and a status change a
 * comment; the outcomes are case ids and codes.
 */
export const caseBulkActions = pgTable(
  'case_bulk_actions',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    action: text('action').$type<CaseBulkAction>().notNull(),
    status: text('status').$type<CaseBulkStatus>().notNull().default('pending'),
    creatorType: text('creator_type').$type<CaseCreatorType>().notNull(),
    creatorId: text('creator_id').notNull(),
    requestSealed: sealedColumn('request'),
    requestedCount: integer('requested_count').notNull().default(0),
    appliedCount: integer('applied_count').notNull().default(0),
    noChangeCount: integer('no_change_count').notNull().default(0),
    refusedCount: integer('refused_count').notNull().default(0),
    /** `{ case-id, outcome, code }[]`, filled in when the job has done. */
    outcomes: jsonb('outcomes').$type<unknown[]>().notNull().default([]),
    completedAt: timestamptz('completed_at'),
    /** C251.1 (Workflow 11B Stage 1b (P)): when the queue's cap admitted this row's job; `null` while held. */
    admittedAt: timestamptz('admitted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('case_bulk_actions_environment_id_id_key').on(table.environmentId, table.id),
    // The pending ones, oldest first, for the job's sweep.
    index('case_bulk_actions_unfinished_idx')
      .on(table.createdAt)
      .where(sql`${table.status} <> 'completed'`),
    idFormat('case_bulk_actions', table.id, 'cblk'),
    check('case_bulk_actions_action_valid', oneOf(table.action, CASE_BULK_ACTIONS)),
    check('case_bulk_actions_status_valid', oneOf(table.status, CASE_BULK_STATUSES)),
    ...actorChecks(
      'case_bulk_actions',
      'creator',
      table.creatorType,
      table.creatorId,
      CASE_CREATOR_TYPES,
    ).slice(1),
    check(
      'case_bulk_actions_counts',
      sql`${table.requestedCount} between 0 and ${limit('bulk-cases')}
        and ${table.appliedCount} >= 0 and ${table.noChangeCount} >= 0 and ${table.refusedCount} >= 0
        and ${table.appliedCount} + ${table.noChangeCount} + ${table.refusedCount} <= ${table.requestedCount}`,
    ),
    check(
      'case_bulk_actions_completed_with_status',
      sql`(${table.status} = 'completed') = (${table.completedAt} is not null)`,
    ),
    check('case_bulk_actions_outcomes_array', sql`jsonb_typeof(${table.outcomes}) = 'array'`),
    check(
      'case_bulk_actions_request_until_completed',
      sql`${table.requestSealed} is not null or ${table.status} = 'completed'`,
    ),
  ],
);

export type CaseTemplateRow = typeof caseTemplates.$inferSelect;
export type CaseTemplateVersionRow = typeof caseTemplateVersions.$inferSelect;
export type CaseRow = typeof cases.$inferSelect;
export type CaseInquiryRow = typeof caseInquiries.$inferSelect;
export type CaseCommentRow = typeof caseComments.$inferSelect;
export type CaseHistoryRow = typeof caseHistory.$inferSelect;
export type CaseChecklistStateRow = typeof caseChecklistStates.$inferSelect;
export type CaseActionRow = typeof caseActions.$inferSelect;
export type UserNotificationRow = typeof userNotifications.$inferSelect;
export type CaseFieldKeyRow = typeof caseFieldKeys.$inferSelect;
export type CaseBulkActionRow = typeof caseBulkActions.$inferSelect;
export type CaseAssignmentPolicySourceRow = typeof caseAssignmentPolicySources.$inferSelect;

/**
 * Phase 8, Workflow 8A (C112, C113, C116-C120): the workflow engine's tables. The database is the
 * only record (C117.1): BullMQ on Valkey only wakes a step up, and a lost Valkey delays work.
 *
 * - `workflows`, `workflow_versions`, `workflow_deployments`: a workflow has at most one draft, and a
 *   published version never changes (C116.1). `workflows`' version pointers carry a format check and
 *   no foreign key: a version's row references its workflow, so the pair would be a cycle, and the
 *   workflow's row lock is what keeps them right (C116.1). `promoted_from` names a version in another
 *   environment, so it has no foreign key either.
 * - `workflow_triggers`: the publish-time index `stage()` reads, one row per event a live version
 *   listens to (C118.1). `workflow_trigger_deliveries`: one row per (event, workflow) owed a run,
 *   written in the event's own transaction, so a delivery exists if and only if its event committed.
 *   `event_id` has no foreign key: C16 keeps an event for a pending delivery only, and a delivery
 *   stays until its run's skeleton goes (P27).
 * - `workflow_runs`, `workflow_run_steps`: a run acts on its pinned version. Trigger snapshot, inputs,
 *   variables, outputs, step input, step output and console are sealed for their row; the plaintext
 *   error columns hold codes alone (C120.2). `parent_run_id`, `root_run_id` and `rerun_of_id` carry a
 *   format check and no foreign key, because a run's skeleton can outlive its parent's.
 * - `workflow_run_journal`: append-only history, never a value and never a replay source (F12).
 * - `workflow_step_effects`: one row per side effect, by `effect_key` (C117.5).
 * - `workflow_run_subjects`: the object ids a run touched, for redaction (C120.9); ids are not
 *   personal data.
 * - `workflow_run_files`: a trigger's file inputs (C118.2), with the `transaction_files` envelope.
 * - `workflow_schedules`, `scheduled_runs`: the recurring trigger (C118.4) and Schedule Workflow's
 *   runs (C118.3). `account_actions`: C118.7.
 * - The per-environment cap and rotation (C117.8), with no counter: since Workflow 11B, the
 *   `workflow-step` rows of `queue_slots` (`tables/queue-slots.ts`, C251.1).
 * - `workflow_wait_index`, `workflow_wait_candidates`: which (environment, event) pairs a published
 *   version waits on, and the events that matched one (C119.3). Both hold ids and names only.
 *
 * Plaintext by decision (C143.5): ids, statuses, codes, definitions and trigger filters (configuration,
 * never subject data: C113.6, C114.5), timings, counts and the correlation key (ids are not personal
 * data, C119.3).
 */
import {
  WORKFLOW_DELIVERY_STATUSES,
  WORKFLOW_DEPLOYMENT_STATUSES,
  WORKFLOW_EFFECT_STATUSES,
  WORKFLOW_KINDS,
  WORKFLOW_NODE_TYPES,
  WORKFLOW_OBJECT_TYPES,
  WORKFLOW_PAUSED_REASONS,
  WORKFLOW_ROLLOUT_LABELS,
  WORKFLOW_RUN_CREATOR_TYPES,
  WORKFLOW_RUN_STATUSES,
  WORKFLOW_RUN_WAITING_ON,
  WORKFLOW_STATUSES,
  WORKFLOW_STEP_STATUSES,
  WORKFLOW_TRIGGER_TYPES,
  WORKFLOW_VERSION_STATUSES,
  type WorkflowDeliveryStatus,
  type WorkflowDeploymentStatus,
  type WorkflowEffectStatus,
  type WorkflowKind,
  type WorkflowNodeType,
  type WorkflowObjectType,
  type WorkflowPausedReason,
  type WorkflowRolloutLabel,
  type WorkflowRunStatus,
  type WorkflowRunWaitingOn,
  type WorkflowStatus,
  type WorkflowStepStatus,
  type WorkflowTriggerType,
  type WorkflowVersionStatus,
} from '@openverify/core';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
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
} from 'drizzle-orm/pg-core';
import { idPattern } from '../ids.js';
import { sealedColumn } from '../sealed.js';
import { accountTypes } from './accounts.js';
import {
  createdAt,
  dottedName,
  hexDigest,
  idColumnFormat,
  idFormat,
  oneOf,
  timestamptz,
  updatedAt,
  workflowRunStepId,
  workflowRunStepKey,
} from './columns.js';
import { auditActorType } from './enums.js';
import { environmentId } from './environment-id.js';

/**
 * C117.2: what a journal row can say. Closed, so the journal can never hold a value: a kind is one
 * of these and its other columns are ids, numbers and a code.
 */
export const WORKFLOW_JOURNAL_KINDS = [
  'run_created',
  'run_completed',
  'run_errored',
  'run_canceled',
  'run_resumed',
  'run_redacted',
  'step_ready',
  'step_started',
  'step_succeeded',
  'step_failed',
  'step_skipped',
  'step_canceled',
  'step_reclaimed',
  'retry_scheduled',
  'wait_started',
  'wait_resolved',
  'wait_restored',
  'wait_timed_out',
] as const;
export type WorkflowJournalKind = (typeof WORKFLOW_JOURNAL_KINDS)[number];

/** C117.2, C120.9: how an id came to be recorded against a run. */
export const WORKFLOW_RUN_SUBJECT_SOURCES = ['trigger', 'read', 'written', 'output'] as const;
export type WorkflowRunSubjectSource = (typeof WORKFLOW_RUN_SUBJECT_SOURCES)[number];

/** C118.3: a scheduled run, and the two ways it stops being one. */
export const SCHEDULED_RUN_STATUSES = ['pending', 'run_created', 'canceled'] as const;
export type ScheduledRunStatus = (typeof SCHEDULED_RUN_STATUSES)[number];

/** C118.3: the offset's units, and which side of the base time it falls on. */
export const SCHEDULED_RUN_UNITS = ['minutes', 'hours', 'days'] as const;
export type ScheduledRunUnit = (typeof SCHEDULED_RUN_UNITS)[number];
export const SCHEDULED_RUN_DIRECTIONS = ['before', 'after'] as const;
export type ScheduledRunDirection = (typeof SCHEDULED_RUN_DIRECTIONS)[number];

/** C118.7. */
export const ACCOUNT_ACTION_ROW_STATUSES = ['active', 'archived'] as const;
export type AccountActionRowStatus = (typeof ACCOUNT_ACTION_ROW_STATUSES)[number];

/** `pg_current_xact_id()`, as `pg_visible_in_snapshot` takes it (C119.3). */
const xid8 = customType<{ data: string }>({ dataType: () => 'xid8' });

/** `pg_current_snapshot()` (C119.3). */
const pgSnapshot = customType<{ data: string }>({ dataType: () => 'pg_snapshot' });

/** A nullable id column: `null`, or a C1 id with this prefix. */
const nullableId = (name: string, column: AnyPgColumn, prefix: Parameters<typeof idPattern>[0]) =>
  check(name, sql`${column} is null or ${column} ~ ${sql.raw(`'${idPattern(prefix)}'`)}`);

/** A code a step error, a refusal or a journal row carries: never text a step produced (C120.2). */
const codeFormat = (name: string, column: AnyPgColumn) =>
  check(name, sql`${column} is null or ${column} ~ '^[a-z][a-z0-9_-]{0,63}$'`);

/** C112.3: a workflow (`wfl_`); what it does lives in its versions. */
export const workflows = pgTable(
  'workflows',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    name: text('name').notNull(),
    description: text('description'),
    kind: text('kind').$type<WorkflowKind>().notNull().default('workflow'),
    status: text('status').$type<WorkflowStatus>().notNull().default('paused'),
    /** C121.5: why it is paused, `null` unless it is. */
    pausedReason: text('paused_reason').$type<WorkflowPausedReason>(),
    /** The file header says why these three carry no foreign key. */
    latestPublishedVersionId: text('latest_published_version_id'),
    draftVersionId: text('draft_version_id'),
    activeDeploymentId: text('active_deployment_id'),
    archivedAt: timestamptz('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('workflows_environment_id_id_key').on(table.environmentId, table.id),
    index('workflows_environment_id_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    // C121.5: the publisher-rights sweep walks the running workflows.
    index('workflows_running_idx')
      .on(table.environmentId)
      .where(sql`${table.status} = 'running'`),
    idFormat('workflows', table.id, 'wfl'),
    check('workflows_kind_valid', oneOf(table.kind, WORKFLOW_KINDS)),
    check('workflows_status_valid', oneOf(table.status, WORKFLOW_STATUSES)),
    check(
      'workflows_paused_reason_valid',
      sql`(${table.pausedReason} is null or ${oneOf(table.pausedReason, WORKFLOW_PAUSED_REASONS)})
        and (${table.pausedReason} is null or ${table.status} = 'paused')`,
    ),
    check('workflows_name_length', sql`char_length(${table.name}) between 1 and 80`),
    check(
      'workflows_description_length',
      sql`${table.description} is null or char_length(${table.description}) <= 500`,
    ),
    check(
      'workflows_archived_at_with_status',
      sql`(${table.status} = 'archived') = (${table.archivedAt} is not null)`,
    ),
    nullableId(
      'workflows_latest_published_version_id_format',
      table.latestPublishedVersionId,
      'wfv',
    ),
    nullableId('workflows_draft_version_id_format', table.draftVersionId, 'wfv'),
    nullableId('workflows_active_deployment_id_format', table.activeDeploymentId, 'wfd'),
  ],
);

/** C112.4: a version (`wfv_`): one draft per workflow, then immutable (C116.1). */
export const workflowVersions = pgTable(
  'workflow_versions',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    workflowId: text('workflow_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    status: text('status').$type<WorkflowVersionStatus>().notNull().default('draft'),
    schemaVersion: integer('schema_version').notNull(),
    /** C113: configuration, never subject data (C114.5). Stored versions are never rewritten. */
    definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
    /** C113.7: `null` until published. */
    definitionSha256: text('definition_sha256'),
    /** C116.1: the draft's optimistic concurrency. */
    lockVersion: integer('lock_version').notNull().default(1),
    triggerType: text('trigger_type').$type<WorkflowTriggerType>(),
    triggerConfig: jsonb('trigger_config').$type<Record<string, unknown>>(),
    /** C121.2: `{ scopes, pii }`, frozen at publish. */
    grant: jsonb('grant').$type<Record<string, unknown>>(),
    /** C121.4. */
    egress: jsonb('egress').$type<unknown[]>().notNull().default([]),
    /** C116.4. */
    acknowledgements: jsonb('acknowledgements').$type<unknown[]>().notNull().default([]),
    warnings: jsonb('warnings').$type<unknown[]>().notNull().default([]),
    /** The change note; `null` on drafts. */
    description: text('description'),
    /** C112.4: an OpenVerify id, never an email address (decision 64). */
    lastUpdater: text('last_updater'),
    publishedAt: timestamptz('published_at'),
    /** C121.2: publishing is user-only, so a published version always names its user. */
    publishedByType: auditActorType('published_by_type'),
    publishedById: text('published_by_id'),
    promotedFrom: text('promoted_from'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'workflow_versions_workflow_fk',
      columns: [table.environmentId, table.workflowId],
      foreignColumns: [workflows.environmentId, workflows.id],
    }).onDelete('cascade'),
    unique('workflow_versions_environment_id_id_key').on(table.environmentId, table.id),
    unique('workflow_versions_workflow_version_key').on(table.workflowId, table.versionNumber),
    // C116.1: at most one draft per workflow.
    uniqueIndex('workflow_versions_one_draft_idx')
      .on(table.workflowId)
      .where(sql`${table.status} = 'draft'`),
    index('workflow_versions_workflow_number_idx').on(
      table.environmentId,
      table.workflowId,
      table.versionNumber.desc().nullsFirst(),
    ),
    idFormat('workflow_versions', table.id, 'wfv'),
    idColumnFormat('workflow_versions_workflow_id_format', table.workflowId, 'wfl'),
    check('workflow_versions_status_valid', oneOf(table.status, WORKFLOW_VERSION_STATUSES)),
    check('workflow_versions_number_positive', sql`${table.versionNumber} >= 1`),
    check('workflow_versions_schema_version_positive', sql`${table.schemaVersion} >= 1`),
    check('workflow_versions_lock_version_positive', sql`${table.lockVersion} >= 1`),
    check(
      'workflow_versions_trigger_type_valid',
      sql`${table.triggerType} is null or ${oneOf(table.triggerType, WORKFLOW_TRIGGER_TYPES)}`,
    ),
    check(
      'workflow_versions_sha256_format',
      sql`${table.definitionSha256} is null or ${table.definitionSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'workflow_versions_published_is_complete',
      sql`${table.status} = 'draft' or (
        ${table.publishedAt} is not null
        and ${table.definitionSha256} is not null
        and ${table.grant} is not null
        and ${table.publishedByType} = 'user'
        and ${table.publishedById} ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')`,
    ),
    check(
      'workflow_versions_last_updater_format',
      sql`${table.lastUpdater} is null
        or ${table.lastUpdater} ~ '^(usr|key)_[0-9A-HJKMNP-TV-Z]{26}$'`,
    ),
    nullableId('workflow_versions_promoted_from_format', table.promotedFrom, 'wfv'),
  ],
);

/** C116.3: a rollout (`wfd_`), `configuration.versions[]` as public. */
export const workflowDeployments = pgTable(
  'workflow_deployments',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    workflowId: text('workflow_id').notNull(),
    status: text('status').$type<WorkflowDeploymentStatus>().notNull().default('active'),
    /** `{ token, percentage, label }[]`. */
    versions: jsonb('versions').$type<unknown[]>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'workflow_deployments_workflow_fk',
      columns: [table.environmentId, table.workflowId],
      foreignColumns: [workflows.environmentId, workflows.id],
    }).onDelete('cascade'),
    unique('workflow_deployments_environment_id_id_key').on(table.environmentId, table.id),
    // C116.3: one rollout at a time.
    uniqueIndex('workflow_deployments_one_active_idx')
      .on(table.workflowId)
      .where(sql`${table.status} = 'active'`),
    index('workflow_deployments_workflow_created_at_id_idx').on(
      table.environmentId,
      table.workflowId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    idFormat('workflow_deployments', table.id, 'wfd'),
    check('workflow_deployments_status_valid', oneOf(table.status, WORKFLOW_DEPLOYMENT_STATUSES)),
  ],
);

/**
 * C118.1: the publish-time index. Rebuilt for a workflow when it publishes. `stage()` reads it with
 * one indexed lookup of `(environment_id, kind, event_name)`, so a row holds what the worker needs to
 * start from and nothing an event has to compute. A live version is named directly, a rollout by its
 * deployment, and `filter` holds no subject data (C114.5).
 */
export const workflowTriggers = pgTable(
  'workflow_triggers',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    environmentId: environmentId(),
    kind: text('kind').$type<WorkflowTriggerType>().notNull(),
    /** `null` for a trigger no event starts. */
    eventName: text('event_name'),
    workflowId: text('workflow_id').notNull(),
    workflowVersionId: text('workflow_version_id'),
    workflowDeploymentId: text('workflow_deployment_id'),
    filter: jsonb('filter').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: 'workflow_triggers_workflow_fk',
      columns: [table.environmentId, table.workflowId],
      foreignColumns: [workflows.environmentId, workflows.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'workflow_triggers_version_fk',
      columns: [table.environmentId, table.workflowVersionId],
      foreignColumns: [workflowVersions.environmentId, workflowVersions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'workflow_triggers_deployment_fk',
      columns: [table.environmentId, table.workflowDeploymentId],
      foreignColumns: [workflowDeployments.environmentId, workflowDeployments.id],
    }).onDelete('cascade'),
    index('workflow_triggers_lookup_idx').on(table.environmentId, table.kind, table.eventName),
    unique('workflow_triggers_workflow_event_key')
      .on(table.workflowId, table.kind, table.eventName)
      .nullsNotDistinct(),
    check('workflow_triggers_kind_valid', oneOf(table.kind, WORKFLOW_TRIGGER_TYPES)),
    check(
      'workflow_triggers_version_or_deployment',
      sql`(${table.workflowVersionId} is null) <> (${table.workflowDeploymentId} is null)`,
    ),
  ],
);

/** C118.1: one row per (event, workflow) owed a run, unique by construction. */
export const workflowTriggerDeliveries = pgTable(
  'workflow_trigger_deliveries',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    /** The file header says why this carries no foreign key. */
    eventId: text('event_id').notNull(),
    eventName: text('event_name').notNull(),
    workflowId: text('workflow_id').notNull(),
    workflowRunId: text('workflow_run_id'),
    status: text('status').$type<WorkflowDeliveryStatus>().notNull().default('pending'),
    reasonCode: text('reason_code'),
    /** C117.8: a deferred delivery waits, and is never dropped. */
    notBefore: timestamptz('not_before'),
    enqueuedAt: timestamptz('enqueued_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'workflow_trigger_deliveries_workflow_fk',
      columns: [table.environmentId, table.workflowId],
      foreignColumns: [workflows.environmentId, workflows.id],
    }).onDelete('cascade'),
    unique('workflow_trigger_deliveries_environment_id_id_key').on(table.environmentId, table.id),
    unique('workflow_trigger_deliveries_event_workflow_key').on(table.eventId, table.workflowId),
    index('workflow_trigger_deliveries_environment_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('workflow_trigger_deliveries_workflow_created_at_id_idx').on(
      table.environmentId,
      table.workflowId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    // The sweep re-enqueues these, and C16 keeps their events.
    index('workflow_trigger_deliveries_pending_idx')
      .on(table.notBefore, table.createdAt)
      .where(sql`${table.status} = 'pending'`),
    index('workflow_trigger_deliveries_pending_event_idx')
      .on(table.eventId)
      .where(sql`${table.status} = 'pending'`),
    // C120.8: the skeleton's retention deletes a run's deliveries with it.
    index('workflow_trigger_deliveries_run_idx').on(table.environmentId, table.workflowRunId),
    idFormat('workflow_trigger_deliveries', table.id, 'wftd'),
    idColumnFormat('workflow_trigger_deliveries_event_id_format', table.eventId, 'evt'),
    dottedName('workflow_trigger_deliveries_event_name_format', table.eventName),
    nullableId('workflow_trigger_deliveries_run_id_format', table.workflowRunId, 'wfr'),
    codeFormat('workflow_trigger_deliveries_reason_code_format', table.reasonCode),
    check(
      'workflow_trigger_deliveries_status_valid',
      oneOf(table.status, WORKFLOW_DELIVERY_STATUSES),
    ),
    check(
      'workflow_trigger_deliveries_reason_with_status',
      sql`(${table.status} in ('pending', 'run_created')) = (${table.reasonCode} is null)`,
    ),
    check(
      'workflow_trigger_deliveries_run_with_status',
      sql`(${table.status} = 'run_created') = (${table.workflowRunId} is not null)`,
    ),
  ],
);

/** C117.2: a run (`wfr_`), pinned to its version (C116.2). */
export const workflowRuns = pgTable(
  'workflow_runs',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    workflowId: text('workflow_id').notNull(),
    workflowVersionId: text('workflow_version_id').notNull(),
    workflowDeploymentId: text('workflow_deployment_id'),
    rolloutLabel: text('rollout_label').$type<WorkflowRolloutLabel>(),
    status: text('status').$type<WorkflowRunStatus>().notNull().default('in_progress'),
    waitingOn: text('waiting_on').$type<WorkflowRunWaitingOn>(),
    triggerType: text('trigger_type').$type<WorkflowTriggerType>().notNull(),
    // C118: each way of starting a run has its own key, so a repeat finds the run it made.
    triggerDeliveryId: text('trigger_delivery_id'),
    /** `<schedule id>/<fire time>/<object id>`: C118.4 starts one run per object of a tick. */
    scheduleFire: text('schedule_fire'),
    scheduledRunId: text('scheduled_run_id'),
    idempotencyKey: text('idempotency_key'),
    /** C120.1; `null` for a recurring tick, which nobody started. */
    creatorType: text('creator_type'),
    creatorId: text('creator_id'),
    rootRunId: text('root_run_id'),
    parentRunId: text('parent_run_id'),
    rerunOfId: text('rerun_of_id'),
    /** C118.9: the earlier run a `one-run-per-subject` run waits for. */
    waitingOnRunId: text('waiting_on_run_id'),
    depth: integer('depth').notNull().default(0),
    triggerDepth: integer('trigger_depth').notNull().default(0),
    stepExecutions: integer('step_executions').notNull().default(0),
    deadlineAt: timestamptz('deadline_at').notNull(),
    /** C121.3: the principal that caused this run's root, `usr_` or `key_`, for the event checks. */
    causedByPrincipal: text('caused_by_principal'),
    /** C121.3: the version's grant, intersected with that principal's when one started the root. */
    effectiveGrant: jsonb('effective_grant').$type<Record<string, unknown>>().notNull(),
    /** C120.2: codes alone; a step's own text lives sealed in its output. */
    errorType: text('error_type'),
    errorCode: text('error_code'),
    errorNodeId: text('error_node_id'),
    /** C120.1 (H32). */
    stepOutcomes: jsonb('step_outcomes').$type<Record<string, number>>().notNull().default({
      succeeded: 0,
      'failed-continued': 0,
      'timed-out': 0,
      'unknown-effect': 0,
      skipped: 0,
    }),
    /** `filter[has-step-errors]`. */
    hasStepErrors: boolean('has_step_errors').notNull().default(false),
    /** C120.7: a test run. Its `test-run-id` is its own id (Stage 1a amendment 33). */
    isTestRun: boolean('is_test_run').notNull().default(false),
    overriddenSteps: text('overridden_steps')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** C120.9 (P33): any redaction in the environment also nulls this run's values. */
    subjectsOverflow: boolean('subjects_overflow').notNull().default(false),
    triggerSnapshotSealed: sealedColumn('trigger_snapshot'),
    inputsSealed: sealedColumn('inputs'),
    variablesSealed: sealedColumn('variables'),
    outputsSealed: sealedColumn('outputs'),
    completedAt: timestamptz('completed_at'),
    redactedAt: timestamptz('redacted_at'),
    valuesPurgedAt: timestamptz('values_purged_at'),
    /** C117.5: the run's step that created it; `null` for anything else. */
    workflowRunStepId: workflowRunStepId(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    ...workflowRunStepKey('workflow_runs', table.environmentId, table.workflowRunStepId),
    foreignKey({
      name: 'workflow_runs_workflow_fk',
      columns: [table.environmentId, table.workflowId],
      foreignColumns: [workflows.environmentId, workflows.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'workflow_runs_version_fk',
      columns: [table.environmentId, table.workflowVersionId],
      foreignColumns: [workflowVersions.environmentId, workflowVersions.id],
    }).onDelete('cascade'),
    unique('workflow_runs_environment_id_id_key').on(table.environmentId, table.id),
    unique('workflow_runs_trigger_delivery_key').on(table.triggerDeliveryId),
    unique('workflow_runs_schedule_fire_key').on(table.environmentId, table.scheduleFire),
    unique('workflow_runs_scheduled_run_key').on(table.scheduledRunId),
    unique('workflow_runs_workflow_idempotency_key').on(table.workflowId, table.idempotencyKey),
    index('workflow_runs_environment_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('workflow_runs_workflow_created_at_id_idx').on(
      table.environmentId,
      table.workflowId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('workflow_runs_version_created_at_id_idx').on(
      table.environmentId,
      table.workflowVersionId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('workflow_runs_parent_idx').on(table.environmentId, table.parentRunId),
    index('workflow_runs_root_idx').on(table.environmentId, table.rootRunId),
    // C117.7: the run deadline's sweep, and C118.9's earlier run.
    index('workflow_runs_unfinished_idx')
      .on(table.deadlineAt)
      .where(sql`${table.status} = 'in_progress'`),
    // C120.8: both retention steps walk the runs that ended, oldest first.
    index('workflow_runs_values_due_idx')
      .on(table.completedAt)
      .where(sql`${table.completedAt} is not null and ${table.valuesPurgedAt} is null`),
    index('workflow_runs_skeleton_due_idx')
      .on(table.completedAt)
      .where(sql`${table.completedAt} is not null`),
    // C120.9 (P33): a short scan of the runs that overflowed.
    index('workflow_runs_overflow_idx')
      .on(table.environmentId)
      .where(sql`${table.subjectsOverflow} and ${table.valuesPurgedAt} is null`),
    idFormat('workflow_runs', table.id, 'wfr'),
    check('workflow_runs_status_valid', oneOf(table.status, WORKFLOW_RUN_STATUSES)),
    check(
      'workflow_runs_waiting_on_valid',
      sql`${table.waitingOn} is null
        or (${table.status} = 'in_progress' and ${oneOf(table.waitingOn, WORKFLOW_RUN_WAITING_ON)})`,
    ),
    check(
      'workflow_runs_rollout_label_valid',
      sql`${table.rolloutLabel} is null or ${oneOf(table.rolloutLabel, WORKFLOW_ROLLOUT_LABELS)}`,
    ),
    check('workflow_runs_trigger_type_valid', oneOf(table.triggerType, WORKFLOW_TRIGGER_TYPES)),
    check(
      'workflow_runs_creator_valid',
      sql`(${table.creatorType} is null and ${table.creatorId} is null)
        or (${table.creatorId} is not null and ${oneOf(table.creatorType, WORKFLOW_RUN_CREATOR_TYPES)})`,
    ),
    check('workflow_runs_depth_range', sql`${table.depth} >= 0 and ${table.triggerDepth} >= 0`),
    check('workflow_runs_step_executions_range', sql`${table.stepExecutions} >= 0`),
    check(
      'workflow_runs_finished_says_when',
      sql`(${table.status} = 'in_progress') = (${table.completedAt} is null)`,
    ),
    check(
      'workflow_runs_errored_says_why',
      sql`(${table.status} = 'errored') = (${table.errorType} is not null)`,
    ),
    check(
      'workflow_runs_caused_by_principal_format',
      sql`${table.causedByPrincipal} is null
        or ${table.causedByPrincipal} ~ '^(usr|key)_[0-9A-HJKMNP-TV-Z]{26}$'`,
    ),
    codeFormat('workflow_runs_error_type_format', table.errorType),
    codeFormat('workflow_runs_error_code_format', table.errorCode),
    nullableId('workflow_runs_root_run_id_format', table.rootRunId, 'wfr'),
    nullableId('workflow_runs_parent_run_id_format', table.parentRunId, 'wfr'),
    nullableId('workflow_runs_rerun_of_id_format', table.rerunOfId, 'wfr'),
    nullableId('workflow_runs_waiting_on_run_id_format', table.waitingOnRunId, 'wfr'),
    nullableId('workflow_runs_trigger_delivery_id_format', table.triggerDeliveryId, 'wftd'),
    nullableId('workflow_runs_scheduled_run_id_format', table.scheduledRunId, 'srrun'),
    nullableId('workflow_runs_deployment_id_format', table.workflowDeploymentId, 'wfd'),
  ],
);

/** C117.2: one row per node and iteration path of a run. */
export const workflowRunSteps = pgTable(
  'workflow_run_steps',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    runId: text('run_id').notNull(),
    nodeId: text('node_id').notNull(),
    /** `loop[3]/send_email`, `module:check/...`; empty at the top level. */
    iterationPath: text('iteration_path').notNull().default(''),
    nodeType: text('node_type').$type<WorkflowNodeType>().notNull(),
    actionKey: text('action_key'),
    actionVersion: integer('action_version'),
    status: text('status').$type<WorkflowStepStatus>().notNull().default('pending'),
    dueAt: timestamptz('due_at'),
    /** C117.6: counts attempts across retries, and a resume carries on from it (C120.3). */
    attempt: integer('attempt').notNull().default(0),
    /** C117.4: claims, for the crash-loop cap, which a retry's attempts must not reach. */
    claims: integer('claims').notNull().default(0),
    claimedBy: text('claimed_by'),
    claimedUntil: timestamptz('claimed_until'),
    enqueuedAt: timestamptz('enqueued_at'),
    // C119.3: the wait. The correlation key is an object id, plain (ids are not personal data).
    waitEventNames: text('wait_event_names').array(),
    waitCorrelationKey: text('wait_correlation_key'),
    waitFilter: jsonb('wait_filter').$type<Record<string, unknown>>(),
    waitFilterOnNull: text('wait_filter_on_null'),
    timeoutAt: timestamptz('timeout_at'),
    waitingSnapshot: pgSnapshot('waiting_snapshot'),
    waitingXact: xid8('waiting_xact'),
    resolvedByEventId: text('resolved_by_event_id'),
    /** C119.4: the join's counter, decremented in each branch's completion transaction. */
    joinRemaining: integer('join_remaining'),
    inputSealed: sealedColumn('input'),
    outputSealed: sealedColumn('output'),
    /** C120.7, C123.4: a sandbox test run's capture. */
    consoleSealed: sealedColumn('console'),
    errorType: text('error_type'),
    errorCode: text('error_code'),
    simulated: boolean('simulated').notNull().default(false),
    overridden: boolean('overridden').notNull().default(false),
    startedAt: timestamptz('started_at'),
    completedAt: timestamptz('completed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'workflow_run_steps_run_fk',
      columns: [table.environmentId, table.runId],
      foreignColumns: [workflowRuns.environmentId, workflowRuns.id],
    }).onDelete('cascade'),
    unique('workflow_run_steps_environment_id_id_key').on(table.environmentId, table.id),
    unique('workflow_run_steps_run_node_iteration_key').on(
      table.runId,
      table.nodeId,
      table.iterationPath,
    ),
    index('workflow_run_steps_run_created_at_id_idx').on(
      table.environmentId,
      table.runId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    // C117.2: finished steps leave the hot indexes at once (engine note 2.4).
    index('workflow_run_steps_ready_idx')
      .on(table.environmentId, table.dueAt)
      .where(sql`${table.status} = 'ready'`),
    index('workflow_run_steps_running_idx')
      .on(table.environmentId, table.claimedUntil)
      .where(sql`${table.status} = 'running'`),
    index('workflow_run_steps_waiting_timeout_idx')
      .on(table.timeoutAt)
      .where(sql`${table.status} = 'waiting' and ${table.timeoutAt} is not null`),
    index('workflow_run_steps_waiting_due_idx')
      .on(table.dueAt)
      .where(sql`${table.status} = 'waiting' and ${table.dueAt} is not null`),
    index('workflow_run_steps_waiting_key_idx')
      .on(table.environmentId, table.waitCorrelationKey)
      .where(sql`${table.status} = 'waiting' and ${table.waitCorrelationKey} is not null`),
    idFormat('workflow_run_steps', table.id, 'wfst'),
    check('workflow_run_steps_status_valid', oneOf(table.status, WORKFLOW_STEP_STATUSES)),
    check('workflow_run_steps_node_type_valid', oneOf(table.nodeType, WORKFLOW_NODE_TYPES)),
    check('workflow_run_steps_attempt_range', sql`${table.attempt} >= 0 and ${table.claims} >= 0`),
    check(
      'workflow_run_steps_join_remaining_range',
      sql`${table.joinRemaining} is null or ${table.joinRemaining} >= 0`,
    ),
    check(
      'workflow_run_steps_claim_with_running',
      sql`${table.status} <> 'running' or (${table.claimedBy} is not null and ${table.claimedUntil} is not null)`,
    ),
    check(
      'workflow_run_steps_failed_says_why',
      sql`${table.status} <> 'failed' or ${table.errorType} is not null`,
    ),
    nullableId('workflow_run_steps_resolved_by_event_id_format', table.resolvedByEventId, 'evt'),
    codeFormat('workflow_run_steps_error_type_format', table.errorType),
    codeFormat('workflow_run_steps_error_code_format', table.errorCode),
  ],
);

/**
 * C117.2: history, never a value. Append-only (F12): migration 0027's trigger refuses an UPDATE, and
 * a DELETE unless the transaction deletes an environment or runs the C16 pass.
 */
export const workflowRunJournal = pgTable(
  'workflow_run_journal',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    environmentId: environmentId(),
    runId: text('run_id').notNull(),
    kind: text('kind').$type<WorkflowJournalKind>().notNull(),
    stepId: text('step_id'),
    nodeId: text('node_id'),
    iterationPath: text('iteration_path'),
    attempt: integer('attempt'),
    durationMs: integer('duration_ms'),
    errorType: text('error_type'),
    errorCode: text('error_code'),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: 'workflow_run_journal_run_fk',
      columns: [table.environmentId, table.runId],
      foreignColumns: [workflowRuns.environmentId, workflowRuns.id],
    }).onDelete('cascade'),
    index('workflow_run_journal_run_idx').on(table.environmentId, table.runId, table.id),
    check('workflow_run_journal_kind_valid', oneOf(table.kind, WORKFLOW_JOURNAL_KINDS)),
    nullableId('workflow_run_journal_step_id_format', table.stepId, 'wfst'),
    codeFormat('workflow_run_journal_error_type_format', table.errorType),
    codeFormat('workflow_run_journal_error_code_format', table.errorCode),
    check(
      'workflow_run_journal_duration_range',
      sql`${table.durationMs} is null or ${table.durationMs} >= 0`,
    ),
  ],
);

/** C117.5: every side effect, keyed independently of the attempt. */
export const workflowStepEffects = pgTable(
  'workflow_step_effects',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    runId: text('run_id').notNull(),
    stepId: text('step_id').notNull(),
    /** `<wfr id>/<node id>/<iteration path>`. */
    effectKey: text('effect_key').notNull(),
    /** The action key that made it. */
    kind: text('kind').notNull(),
    status: text('status').$type<WorkflowEffectStatus>().notNull().default('claimed'),
    resultSealed: sealedColumn('result'),
    /** C120.9 (P20): where a PII-to-PII copy went, and the subjects it came from. */
    copyTargetId: text('copy_target_id'),
    copySourceSubjectIds: text('copy_source_subject_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'workflow_step_effects_run_fk',
      columns: [table.environmentId, table.runId],
      foreignColumns: [workflowRuns.environmentId, workflowRuns.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'workflow_step_effects_step_fk',
      columns: [table.environmentId, table.stepId],
      foreignColumns: [workflowRunSteps.environmentId, workflowRunSteps.id],
    }).onDelete('cascade'),
    unique('workflow_step_effects_environment_id_id_key').on(table.environmentId, table.id),
    unique('workflow_step_effects_effect_key').on(table.environmentId, table.effectKey),
    index('workflow_step_effects_run_idx').on(table.environmentId, table.runId),
    index('workflow_step_effects_copies_idx')
      .using('gin', table.copySourceSubjectIds)
      .where(sql`${table.copyTargetId} is not null`),
    idFormat('workflow_step_effects', table.id, 'wfef'),
    idColumnFormat('workflow_step_effects_step_id_format', table.stepId, 'wfst'),
    check('workflow_step_effects_status_valid', oneOf(table.status, WORKFLOW_EFFECT_STATUSES)),
  ],
);

/** C117.2, C120.9: the object ids of a run, at most 1,000 per run (`subjects_overflow` past it). */
export const workflowRunSubjects = pgTable(
  'workflow_run_subjects',
  {
    environmentId: environmentId(),
    runId: text('run_id').notNull(),
    subjectId: text('subject_id').notNull(),
    source: text('source').$type<WorkflowRunSubjectSource>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({
      name: 'workflow_run_subjects_pkey',
      columns: [table.environmentId, table.runId, table.subjectId],
    }),
    foreignKey({
      name: 'workflow_run_subjects_run_fk',
      columns: [table.environmentId, table.runId],
      foreignColumns: [workflowRuns.environmentId, workflowRuns.id],
    }).onDelete('cascade'),
    index('workflow_run_subjects_subject_idx').on(table.environmentId, table.subjectId),
    check('workflow_run_subjects_source_valid', oneOf(table.source, WORKFLOW_RUN_SUBJECT_SOURCES)),
  ],
);

/** C118.2 (P41, F17): a trigger's file, with `transaction_files`' envelope. */
export const workflowRunFiles = pgTable(
  'workflow_run_files',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    runId: text('run_id').notNull(),
    storageKey: text('storage_key').notNull(),
    wrappedDek: text('wrapped_dek'),
    filenameSealed: sealedColumn('filename'),
    mimeType: text('mime_type').notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    /** C120.8, C120.9: the key and the name go in the redaction's transaction. */
    redactedAt: timestamptz('redacted_at'),
    /** The object is gone: the C16 pass deletes it, so a failed delete fails nothing. */
    deletedAt: timestamptz('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'workflow_run_files_run_fk',
      columns: [table.environmentId, table.runId],
      foreignColumns: [workflowRuns.environmentId, workflowRuns.id],
    }).onDelete('cascade'),
    unique('workflow_run_files_environment_id_id_key').on(table.environmentId, table.id),
    index('workflow_run_files_run_idx').on(table.environmentId, table.runId),
    // The C16 pass deletes these objects.
    index('workflow_run_files_undeleted_idx')
      .on(table.redactedAt)
      .where(sql`${table.redactedAt} is not null and ${table.deletedAt} is null`),
    idFormat('workflow_run_files', table.id, 'wfrf'),
    hexDigest('workflow_run_files_sha256_format', table.sha256),
    check('workflow_run_files_byte_size_range', sql`${table.byteSize} >= 0`),
    check(
      'workflow_run_files_held_until_redacted',
      sql`${table.redactedAt} is not null
        or (${table.wrappedDek} is not null and ${table.filenameSealed} is not null)`,
    ),
    check(
      'workflow_run_files_deleted_after_redacted',
      sql`${table.deletedAt} is null or ${table.redactedAt} is not null`,
    ),
  ],
);

/** C118.4: a recurring trigger's schedule; a tick's fire key is `workflow_runs.schedule_fire`. */
export const workflowSchedules = pgTable(
  'workflow_schedules',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    workflowId: text('workflow_id').notNull(),
    cron: text('cron'),
    everyMinutes: integer('every_minutes'),
    timeZone: text('time_zone').notNull(),
    objectType: text('object_type').$type<WorkflowObjectType>().notNull(),
    /** The C137.2 grammar over plaintext attributes, so no subject data (C118.4). */
    filter: jsonb('filter').$type<Record<string, unknown>>(),
    onNull: text('on_null'),
    batchCap: integer('batch_cap').notNull().default(100),
    /** Where the next tick continues: an object's position, ids and timestamps only. */
    cursor: text('cursor'),
    nextFireAt: timestamptz('next_fire_at').notNull(),
    lastFiredAt: timestamptz('last_fired_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'workflow_schedules_workflow_fk',
      columns: [table.environmentId, table.workflowId],
      foreignColumns: [workflows.environmentId, workflows.id],
    }).onDelete('cascade'),
    unique('workflow_schedules_environment_id_id_key').on(table.environmentId, table.id),
    unique('workflow_schedules_workflow_key').on(table.workflowId),
    index('workflow_schedules_due_idx').on(table.nextFireAt),
    idFormat('workflow_schedules', table.id, 'wfsc'),
    check('workflow_schedules_object_type_valid', oneOf(table.objectType, WORKFLOW_OBJECT_TYPES)),
    check(
      'workflow_schedules_cron_or_every',
      sql`(${table.cron} is null) <> (${table.everyMinutes} is null)`,
    ),
    check(
      'workflow_schedules_every_range',
      sql`${table.everyMinutes} is null or ${table.everyMinutes} >= 1`,
    ),
    check('workflow_schedules_batch_cap_range', sql`${table.batchCap} between 1 and 1000`),
  ],
);

/** C118.3: Schedule Workflow's run (`srrun_`), created at its time by a sweeper. */
export const scheduledRuns = pgTable(
  'scheduled_runs',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    targetWorkflowId: text('target_workflow_id').notNull(),
    /** The run that asked for it; `null` once that run's skeleton is gone. */
    sourceRunId: text('source_run_id'),
    subjectId: text('subject_id'),
    baseAt: timestamptz('base_at').notNull(),
    offsetValue: integer('offset_value').notNull(),
    offsetUnit: text('offset_unit').$type<ScheduledRunUnit>().notNull(),
    offsetDirection: text('offset_direction').$type<ScheduledRunDirection>().notNull(),
    fireAt: timestamptz('fire_at').notNull(),
    status: text('status').$type<ScheduledRunStatus>().notNull().default('pending'),
    workflowRunId: text('workflow_run_id'),
    reasonCode: text('reason_code'),
    inputsSealed: sealedColumn('inputs'),
    /** C117.5: the run's step that created it; `null` for anything else. */
    workflowRunStepId: workflowRunStepId(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    ...workflowRunStepKey('scheduled_runs', table.environmentId, table.workflowRunStepId),
    foreignKey({
      name: 'scheduled_runs_workflow_fk',
      columns: [table.environmentId, table.targetWorkflowId],
      foreignColumns: [workflows.environmentId, workflows.id],
    }).onDelete('cascade'),
    unique('scheduled_runs_environment_id_id_key').on(table.environmentId, table.id),
    index('scheduled_runs_due_idx')
      .on(table.fireAt)
      .where(sql`${table.status} = 'pending'`),
    index('scheduled_runs_pending_subject_idx')
      .on(table.environmentId, table.subjectId)
      .where(sql`${table.status} = 'pending'`),
    index('scheduled_runs_pending_workflow_idx')
      .on(table.environmentId, table.targetWorkflowId)
      .where(sql`${table.status} = 'pending'`),
    idFormat('scheduled_runs', table.id, 'srrun'),
    check('scheduled_runs_status_valid', oneOf(table.status, SCHEDULED_RUN_STATUSES)),
    check('scheduled_runs_offset_unit_valid', oneOf(table.offsetUnit, SCHEDULED_RUN_UNITS)),
    check(
      'scheduled_runs_offset_direction_valid',
      oneOf(table.offsetDirection, SCHEDULED_RUN_DIRECTIONS),
    ),
    check('scheduled_runs_offset_range', sql`${table.offsetValue} >= 0`),
    check(
      'scheduled_runs_run_with_status',
      sql`(${table.status} = 'run_created') = (${table.workflowRunId} is not null)`,
    ),
    nullableId('scheduled_runs_source_run_id_format', table.sourceRunId, 'wfr'),
    nullableId('scheduled_runs_workflow_run_id_format', table.workflowRunId, 'wfr'),
    codeFormat('scheduled_runs_reason_code_format', table.reasonCode),
  ],
);

/** C118.7: an account action (`accac_`) binds a running workflow to an account type. */
export const accountActions = pgTable(
  'account_actions',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    workflowId: text('workflow_id').notNull(),
    accountTypeId: text('account_type_id').notNull(),
    label: text('label').notNull(),
    status: text('status').$type<AccountActionRowStatus>().notNull().default('active'),
    /** An input's name to a path, never a value (Stage 1a amendment 40). */
    prefill: jsonb('prefill').$type<Record<string, string>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'account_actions_workflow_fk',
      columns: [table.environmentId, table.workflowId],
      foreignColumns: [workflows.environmentId, workflows.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'account_actions_account_type_fk',
      columns: [table.environmentId, table.accountTypeId],
      foreignColumns: [accountTypes.environmentId, accountTypes.id],
    }),
    unique('account_actions_environment_id_id_key').on(table.environmentId, table.id),
    index('account_actions_environment_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('account_actions_account_type_idx').on(table.environmentId, table.accountTypeId),
    idFormat('account_actions', table.id, 'accac'),
    check('account_actions_status_valid', oneOf(table.status, ACCOUNT_ACTION_ROW_STATUSES)),
    check('account_actions_label_length', sql`char_length(${table.label}) between 1 and 80`),
  ],
);

/** C119.3: each (environment, event name) a published version waits on. */
export const workflowWaitIndex = pgTable(
  'workflow_wait_index',
  {
    environmentId: environmentId(),
    eventName: text('event_name').notNull(),
    workflowVersionId: text('workflow_version_id').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({
      name: 'workflow_wait_index_pkey',
      columns: [table.environmentId, table.eventName, table.workflowVersionId],
    }),
    foreignKey({
      name: 'workflow_wait_index_version_fk',
      columns: [table.environmentId, table.workflowVersionId],
      foreignColumns: [workflowVersions.environmentId, workflowVersions.id],
    }).onDelete('cascade'),
    dottedName('workflow_wait_index_event_name_format', table.eventName),
  ],
);

/**
 * C119.3: one row per staged event a wait might want, written in the event's own transaction with no
 * lock. `xact` is what `pg_visible_in_snapshot` compares with a wait's snapshot. Deleted once
 * processed and older than the longest wait.
 */
export const workflowWaitCandidates = pgTable(
  'workflow_wait_candidates',
  {
    eventId: text('event_id').primaryKey(),
    environmentId: environmentId(),
    eventName: text('event_name').notNull(),
    subjectIds: text('subject_ids').array().notNull(),
    xact: xid8('xact')
      .notNull()
      .default(sql`pg_current_xact_id()`),
    processedAt: timestamptz('processed_at'),
    createdAt: createdAt(),
  },
  (table) => [
    index('workflow_wait_candidates_unprocessed_idx')
      .on(table.createdAt)
      .where(sql`${table.processedAt} is null`),
    index('workflow_wait_candidates_processed_idx')
      .on(table.processedAt)
      .where(sql`${table.processedAt} is not null`),
    index('workflow_wait_candidates_event_idx').on(table.environmentId, table.eventName),
    index('workflow_wait_candidates_subjects_idx').using('gin', table.subjectIds),
    idColumnFormat('workflow_wait_candidates_event_id_format', table.eventId, 'evt'),
    dottedName('workflow_wait_candidates_event_name_format', table.eventName),
  ],
);

export type WorkflowRow = typeof workflows.$inferSelect;
export type WorkflowVersionRow = typeof workflowVersions.$inferSelect;
export type WorkflowDeploymentRow = typeof workflowDeployments.$inferSelect;
export type WorkflowTriggerRow = typeof workflowTriggers.$inferSelect;
export type WorkflowTriggerDeliveryRow = typeof workflowTriggerDeliveries.$inferSelect;
export type WorkflowRunRow = typeof workflowRuns.$inferSelect;
export type WorkflowRunStepRow = typeof workflowRunSteps.$inferSelect;
export type WorkflowRunJournalRow = typeof workflowRunJournal.$inferSelect;
export type WorkflowStepEffectRow = typeof workflowStepEffects.$inferSelect;
export type WorkflowRunSubjectRow = typeof workflowRunSubjects.$inferSelect;
export type WorkflowRunFileRow = typeof workflowRunFiles.$inferSelect;
export type WorkflowScheduleRow = typeof workflowSchedules.$inferSelect;
export type ScheduledRunRow = typeof scheduledRuns.$inferSelect;
export type AccountActionRow = typeof accountActions.$inferSelect;
export type WorkflowWaitIndexRow = typeof workflowWaitIndex.$inferSelect;
export type WorkflowWaitCandidateRow = typeof workflowWaitCandidates.$inferSelect;

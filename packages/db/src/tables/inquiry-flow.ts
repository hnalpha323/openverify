/**
 * Workflow 9A Stage 1b (S): the server flow engine's records (C151.1, C152.8, C150.9). Each row
 * belongs to its inquiry (`(environment_id, inquiry_id)`, deleted with it), holds ids, step ids and
 * codes and never a value, and is deleted by the inquiry's redaction and so by its retention
 * (C174.5). The repositories are their owners': `inquiry-flow-steps.ts` (`api-flow-engine`),
 * `inquiry-flow-actions.ts` and `inquiry-flow-signal-snapshots.ts` (`api-flow-actions`).
 */
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
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import {
  FLOW_ACTION_ROW_STATUSES,
  FLOW_RECORD_CODE_PATTERN,
  FLOW_RECORD_STEP_ID_PATTERN,
  type FlowActionRowStatus,
} from '@openverify/core';
import { idPattern } from '../ids.js';
import { oneOf, timestamptz } from './columns.js';
import { environmentId } from './environment-id.js';
import { inquiries } from './inquiries.js';

const stepIdFormat = (column: AnyPgColumn) =>
  sql`${column} ~ ${sql.raw(`'${FLOW_RECORD_STEP_ID_PATTERN}'`)}`;
const codeFormat = (column: AnyPgColumn) =>
  sql`${column} ~ ${sql.raw(`'${FLOW_RECORD_CODE_PATTERN}'`)}`;

/**
 * C151.1: the append-only step record, one row per entry of a step, written in the transaction that
 * moves the position, under the inquiry's row lock. Pseudonymous, not PII-free (review P15): a port
 * can reveal what the person chose, so `sensitive` marks such an exit at write time.
 */
export const inquiryFlowSteps = pgTable(
  'inquiry_flow_steps',
  {
    environmentId: environmentId(),
    inquiryId: text('inquiry_id').notNull(),
    /** 1, 2, 3, ... per inquiry, in the order the engine wrote them. */
    seq: integer('seq').notNull(),
    stepId: text('step_id').notNull(),
    /** The step's type in the pinned flow (`screen`, `branch`, `government_id`, ...). */
    stepType: text('step_type').notNull(),
    enteredAt: timestamptz('entered_at').notNull(),
    /** `null` while the person is on the step. */
    exitedAt: timestamptz('exited_at'),
    /** The port it left through: `next`, `exhausted`, `else`, `error`, `route:<key>`, `button:<key>`. */
    exitPort: text('exit_port'),
    /** A code such as `passed`, `submitted` or `scope_path_missing`; `null` while open. */
    outcome: text('outcome'),
    /** How long a branch or action waited, in milliseconds; `null` when it did not wait. */
    waitedMs: bigint('waited_ms', { mode: 'number' }),
    /** C151.1 (P15): a screen button other than `next`, or a route reading a PII-marked path. */
    sensitive: boolean('sensitive').notNull().default(false),
    /** Codes only, such as `position_backfilled`, `scope_path_missing` or `waited_for_facts`. */
    notes: text('notes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
  },
  (table) => [
    primaryKey({
      name: 'inquiry_flow_steps_pkey',
      columns: [table.environmentId, table.inquiryId, table.seq],
    }),
    foreignKey({
      name: 'inquiry_flow_steps_inquiry_fk',
      columns: [table.environmentId, table.inquiryId],
      foreignColumns: [inquiries.environmentId, inquiries.id],
    }).onDelete('cascade'),
    check('inquiry_flow_steps_seq_positive', sql`${table.seq} > 0`),
    check('inquiry_flow_steps_step_id_format', stepIdFormat(table.stepId)),
    check('inquiry_flow_steps_step_type_format', codeFormat(table.stepType)),
    check(
      'inquiry_flow_steps_codes_format',
      sql`(${table.exitPort} is null or ${codeFormat(table.exitPort)})
        and (${table.outcome} is null or ${codeFormat(table.outcome)})`,
    ),
    check(
      'inquiry_flow_steps_exit_coherent',
      sql`(${table.exitedAt} is null) = (${table.exitPort} is null)`,
    ),
    check(
      'inquiry_flow_steps_waited_ms_valid',
      sql`${table.waitedMs} is null or ${table.waitedMs} >= 0`,
    ),
  ],
);

/**
 * C152.8: one row per entry of an `action` step: its state, the workflow run a `run_workflow`
 * started, and the account and keys an `update_account_fields` copied to (V08), set once per entry.
 * Outputs stay in Phase 8's sealed run outputs and are never copied here.
 */
export const inquiryFlowActions = pgTable(
  'inquiry_flow_actions',
  {
    environmentId: environmentId(),
    inquiryId: text('inquiry_id').notNull(),
    stepId: text('step_id').notNull(),
    /** 1 for the step's first entry, then 2, 3, ... (C151.2 caps the entries at 20). */
    entry: integer('entry').notNull(),
    /** The run a `run_workflow` started (`wfr_`), with no foreign key: a run outlives its skeleton. */
    workflowRunId: text('workflow_run_id'),
    status: text('status').$type<FlowActionRowStatus>().notNull(),
    /** Why it took `error`: `timeout`, `run_errored`, `run_canceled`, `workflow_grant_widened`, ... */
    errorType: text('error_type'),
    /** C152.4 (V08): the account `update_account_fields` wrote to (`acc_`). */
    targetAccountId: text('target_account_id'),
    /** C152.4 (V08): the account field keys it wrote, never their values. */
    copiedKeys: text('copied_keys')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    enteredAt: timestamptz('entered_at').notNull(),
    finishedAt: timestamptz('finished_at'),
  },
  (table) => [
    primaryKey({
      name: 'inquiry_flow_actions_pkey',
      columns: [table.environmentId, table.inquiryId, table.stepId, table.entry],
    }),
    foreignKey({
      name: 'inquiry_flow_actions_inquiry_fk',
      columns: [table.environmentId, table.inquiryId],
      foreignColumns: [inquiries.environmentId, inquiries.id],
    }).onDelete('cascade'),
    check('inquiry_flow_actions_entry_positive', sql`${table.entry} > 0`),
    check('inquiry_flow_actions_step_id_format', stepIdFormat(table.stepId)),
    check('inquiry_flow_actions_status_valid', oneOf(table.status, FLOW_ACTION_ROW_STATUSES)),
    check(
      'inquiry_flow_actions_error_coherent',
      sql`(${table.status} = 'errored') = (${table.errorType} is not null)
        and (${table.errorType} is null or ${codeFormat(table.errorType)})`,
    ),
    check(
      'inquiry_flow_actions_finished_coherent',
      sql`(${table.status} = 'running') = (${table.finishedAt} is null)`,
    ),
    check(
      'inquiry_flow_actions_ids_format',
      sql`(${table.workflowRunId} is null or ${table.workflowRunId} ~ ${sql.raw(`'${idPattern('wfr')}'`)})
        and (${table.targetAccountId} is null or ${table.targetAccountId} ~ ${sql.raw(`'${idPattern('acc')}'`)})`,
    ),
    // C152.2: `flow-action-sweep` finds the running actions whose timeout has passed.
    index('inquiry_flow_actions_running_idx')
      .on(table.enteredAt)
      .where(sql`${table.status} = 'running'`),
  ],
);

/**
 * C150.9: the provisional snapshot of a `flow-provisional` signal a branch waits for, computed from
 * the session facts stored so far through Phase 7's own computation. PII-free: Phase 7's signal
 * values are counts, levels, a country code and distances. Deleted with the step record it belongs to.
 */
export const inquiryFlowSignalSnapshots = pgTable(
  'inquiry_flow_signal_snapshots',
  {
    environmentId: environmentId(),
    inquiryId: text('inquiry_id').notNull(),
    /** The branch's entry in `inquiry_flow_steps`. */
    stepRecordSeq: integer('step_record_seq').notNull(),
    /** The registry name, such as `inquiry/vpn_detected`. */
    name: text('name').notNull(),
    /** `null` when the signal could not be computed; `null_reason` then says why. */
    value: jsonb('value').$type<unknown>(),
    tier: text('tier').notNull(),
    stage: text('stage').notNull(),
    /** Phase 7's null reason, or `not_yet_collected` (V06); `null` for a value. */
    nullReason: text('null_reason'),
    computedAt: timestamptz('computed_at').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'inquiry_flow_signal_snapshots_pkey',
      columns: [table.environmentId, table.inquiryId, table.stepRecordSeq, table.name],
    }),
    foreignKey({
      name: 'inquiry_flow_signal_snapshots_step_fk',
      columns: [table.environmentId, table.inquiryId, table.stepRecordSeq],
      foreignColumns: [
        inquiryFlowSteps.environmentId,
        inquiryFlowSteps.inquiryId,
        inquiryFlowSteps.seq,
      ],
    }).onDelete('cascade'),
    check(
      'inquiry_flow_signal_snapshots_null_coherent',
      sql`(${table.value} is null) = (${table.nullReason} is not null)
        and (${table.nullReason} is null or ${codeFormat(table.nullReason)})`,
    ),
  ],
);

export type InquiryFlowStepRow = typeof inquiryFlowSteps.$inferSelect;
export type InquiryFlowActionRow = typeof inquiryFlowActions.$inferSelect;
export type InquiryFlowSignalSnapshotRow = typeof inquiryFlowSignalSnapshots.$inferSelect;

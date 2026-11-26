/**
 * C140.3: the eight case actions' contracts, and everything 8A's tables need to hold them (F33). The
 * registry joins these in `apps/api/src/workflows/definitions/registry.ts`, beside its own entries:
 * `createActionObjectTypeTable([...ACTION_OBJECT_TYPE_ENTRIES, CASE_ACTION_OBJECT_TYPE_ENTRY])`,
 * `createActionRegistry([...createWorkflowActionEntries(table), ...createCaseActionEntries()])` and
 * `createActionSinkTable([...ACTION_SINK_ROWS, ...CASE_ACTION_SINK_ROWS])`.
 *
 * Each action runs through the C131-C136 services in the effect transaction, so each is exactly once.
 * Its ids are templates, because a case usually comes from an earlier step. What a person reads as a
 * state is plain: a status, a resolution, a status tag and a tag refuse PII taint (C115.6), and a
 * case's name is generated, so no step names one. Fields and comments take PII, which the effect row
 * records as a copy (C120.9).
 */
import {
  CASE_LIMITS,
  MAX_TAGS_PER_OBJECT,
  caseSlaStateSchema,
  type ApiScope,
} from '@openverify/core';
import type { EventName } from '@openverify/contracts';
import { z } from 'zod';
import type { ActionSinkRow } from '../templates/sinks.js';
import {
  actionOutcomeSchema,
  actionReferenceSchema,
  actionTemplateSchema,
  actionValueMapSchema,
  plain,
} from './common.js';
import type { ActionContract } from './contracts.js';
import type {
  ActionObjectTypeEntry,
  ActionRegistryEntry,
  AnyActionRegistryEntry,
  CaseActionKey,
} from './registry.js';

const caseIdSchema = z.string().regex(/^case_/);
const statusSchema = z.string().min(1).max(CASE_LIMITS['status-key-characters'].value);
const resolutionSchema = z.string().min(1).max(CASE_LIMITS['resolution-characters'].value);

/** C133.1: the Set Case SLA step takes minutes, hours or days; the service holds the range. */
export const CASE_SLA_UNITS = ['minutes', 'hours', 'days'] as const;

const slaSchema = z.strictObject({
  value: z.union([z.int().min(1), actionReferenceSchema]),
  unit: z.enum(CASE_SLA_UNITS),
});

const objectIdsSchema = z.array(actionReferenceSchema).min(1).max(CASE_LIMITS['object-ids'].value);

const caseConfigShape = { 'case-id': actionReferenceSchema };

/** C140.3: a template, fields, tags, a queue, what it holds, and an SLA. */
export const createCaseConfigSchema = z.strictObject({
  'case-template-id': actionReferenceSchema,
  fields: actionValueMapSchema.optional(),
  tags: z.array(z.string().min(1).max(255)).max(MAX_TAGS_PER_OBJECT).optional(),
  'case-queue-id': actionReferenceSchema.optional(),
  'object-ids': objectIdsSchema.optional(),
  sla: slaSchema.optional(),
});
export type CreateCaseConfig = z.infer<typeof createCaseConfigSchema>;

export const createCaseOutputSchema = z.strictObject({
  'case-id': plain(caseIdSchema),
  name: plain(z.string().min(1).max(32)),
  status: plain(statusSchema),
  outcome: plain(actionOutcomeSchema),
});
export type CreateCaseOutput = z.infer<typeof createCaseOutputSchema>;

/** C140.3: a user, or a policy that chooses one. */
export const assignCaseConfigSchema = z
  .strictObject({
    ...caseConfigShape,
    'user-id': actionReferenceSchema.optional(),
    'assignment-policy-id': actionReferenceSchema.optional(),
  })
  .refine(
    (config) =>
      (config['user-id'] === undefined) !== (config['assignment-policy-id'] === undefined),
    'names a user or a policy',
  );
export type AssignCaseConfig = z.infer<typeof assignCaseConfigSchema>;

export const assignCaseOutputSchema = z.strictObject({
  'case-id': plain(caseIdSchema),
  /** `null` when a policy found nobody eligible: the case waits for a pull (C132.2). */
  'assignee-id': plain(z.string().regex(/^usr_/).nullable()),
  outcome: plain(actionOutcomeSchema),
});
export type AssignCaseOutput = z.infer<typeof assignCaseOutputSchema>;

/** C140.3: a resolution decides nothing else (C131.3). */
export const updateCaseStatusConfigSchema = z.strictObject({
  ...caseConfigShape,
  status: statusSchema,
  resolution: resolutionSchema.optional(),
  comment: actionTemplateSchema.optional(),
  'status-tag': statusSchema.optional(),
});
export type UpdateCaseStatusConfig = z.infer<typeof updateCaseStatusConfigSchema>;

export const updateCaseStatusOutputSchema = z.strictObject({
  'case-id': plain(caseIdSchema),
  status: plain(statusSchema),
  'status-category': plain(z.enum(['initial', 'intermediate', 'end'])),
  resolution: plain(resolutionSchema.nullable()),
  outcome: plain(actionOutcomeSchema),
});
export type UpdateCaseStatusOutput = z.infer<typeof updateCaseStatusOutputSchema>;

export const addCaseCommentConfigSchema = z.strictObject({
  ...caseConfigShape,
  message: actionTemplateSchema,
});
export type AddCaseCommentConfig = z.infer<typeof addCaseCommentConfigSchema>;

export const addCaseCommentOutputSchema = z.strictObject({
  'case-id': plain(caseIdSchema),
  'comment-id': plain(z.string().regex(/^cscm_/)),
  outcome: plain(actionOutcomeSchema),
});
export type AddCaseCommentOutput = z.infer<typeof addCaseCommentOutputSchema>;

export const addCaseToQueueConfigSchema = z.strictObject({
  ...caseConfigShape,
  'case-queue-id': actionReferenceSchema,
});
export type AddCaseToQueueConfig = z.infer<typeof addCaseToQueueConfigSchema>;

export const addCaseToQueueOutputSchema = z.strictObject({
  'case-id': plain(caseIdSchema),
  'case-queue-id': plain(z.string().regex(/^cqueue_/)),
  outcome: plain(actionOutcomeSchema),
});
export type AddCaseToQueueOutput = z.infer<typeof addCaseToQueueOutputSchema>;

export const attachObjectsToCaseConfigSchema = z.strictObject({
  ...caseConfigShape,
  'object-ids': objectIdsSchema,
});
export type AttachObjectsToCaseConfig = z.infer<typeof attachObjectsToCaseConfigSchema>;

export const attachObjectsToCaseOutputSchema = z.strictObject({
  'case-id': plain(caseIdSchema),
  /** Those new to the case: an object it held already is a `no_change` (C136.2). */
  'attached-count': plain(z.int().min(0)),
  outcome: plain(actionOutcomeSchema),
});
export type AttachObjectsToCaseOutput = z.infer<typeof attachObjectsToCaseOutputSchema>;

export const setCaseSlaConfigSchema = z.strictObject({
  ...caseConfigShape,
  sla: slaSchema,
});
export type SetCaseSlaConfig = z.infer<typeof setCaseSlaConfigSchema>;

/**
 * K8-26: a case in a pausing status holds its SLA `paused`, with no deadline until it leaves the
 * status (C133.5), so `sla-expires-at` is `null` exactly then and `sla-state` says why.
 */
export const setCaseSlaOutputSchema = z.strictObject({
  'case-id': plain(caseIdSchema),
  'sla-expires-at': plain(z.iso.datetime({ offset: true }).nullable()),
  'sla-state': plain(caseSlaStateSchema),
  outcome: plain(actionOutcomeSchema),
});
export type SetCaseSlaOutput = z.infer<typeof setCaseSlaOutputSchema>;

export const clearCaseSlaConfigSchema = z.strictObject(caseConfigShape);
export type ClearCaseSlaConfig = z.infer<typeof clearCaseSlaConfigSchema>;

export const clearCaseSlaOutputSchema = z.strictObject({
  'case-id': plain(caseIdSchema),
  outcome: plain(actionOutcomeSchema),
});
export type ClearCaseSlaOutput = z.infer<typeof clearCaseSlaOutputSchema>;

/** Every case action's config and output schemas, by key (C122.2). */
export const CASE_ACTION_CONTRACTS = Object.freeze({
  create_case: {
    config: createCaseConfigSchema,
    output: createCaseOutputSchema,
  },
  assign_case: {
    config: assignCaseConfigSchema,
    output: assignCaseOutputSchema,
  },
  update_case_status: {
    config: updateCaseStatusConfigSchema,
    output: updateCaseStatusOutputSchema,
  },
  add_case_comment: {
    config: addCaseCommentConfigSchema,
    output: addCaseCommentOutputSchema,
  },
  add_case_to_queue: {
    config: addCaseToQueueConfigSchema,
    output: addCaseToQueueOutputSchema,
  },
  attach_objects_to_case: {
    config: attachObjectsToCaseConfigSchema,
    output: attachObjectsToCaseOutputSchema,
  },
  set_case_sla: {
    config: setCaseSlaConfigSchema,
    output: setCaseSlaOutputSchema,
  },
  clear_case_sla: {
    config: clearCaseSlaConfigSchema,
    output: clearCaseSlaOutputSchema,
  },
} as const satisfies Record<CaseActionKey, ActionContract>);

interface CaseRow {
  readonly scope: ApiScope;
  readonly emits: readonly EventName[];
}

/** C122.2: `cases:write`, and `cases:assign` to assign. */
const CASE_ACTION_ROWS: Readonly<Record<CaseActionKey, CaseRow>> = Object.freeze({
  create_case: {
    scope: 'cases:write',
    emits: ['case.created', 'case.assigned'],
  },
  assign_case: { scope: 'cases:assign', emits: ['case.assigned'] },
  update_case_status: {
    scope: 'cases:write',
    emits: ['case.status-updated', 'case.resolved', 'case.reopened'],
  },
  add_case_comment: { scope: 'cases:write', emits: ['case-comment.created'] },
  add_case_to_queue: {
    scope: 'cases:write',
    emits: ['case.queue-updated', 'case.assigned'],
  },
  attach_objects_to_case: { scope: 'cases:write', emits: ['case.updated'] },
  set_case_sla: { scope: 'cases:write', emits: ['case.updated'] },
  clear_case_sla: { scope: 'cases:write', emits: ['case.updated'] },
});

/** C122.2, C140.3: the eight entries, for `createActionRegistry` beside 8A's. */
export function createCaseActionEntries(): readonly AnyActionRegistryEntry[] {
  return Object.freeze(
    (Object.keys(CASE_ACTION_CONTRACTS) as CaseActionKey[]).map((key): AnyActionRegistryEntry => {
      const contract: ActionContract = CASE_ACTION_CONTRACTS[key];
      const row = CASE_ACTION_ROWS[key];
      const entry: ActionRegistryEntry = {
        key,
        version: 1,
        kind: 'internal',
        config: contract.config,
        output: contract.output,
        grant: () => ({ scopes: [row.scope], pii: false }),
        grantDependsOnConfig: false,
        emits: row.emits,
        delivery: 'exactly-once',
        // C143.3 (H30): `case-create` defers a step, never fails it open: a retryable
        // `rate_limited` waits 60, 300 and 900 seconds (provisional: a minute, then the window's
        // own scale). No other case step meets a budget, so none retries.
        retry:
          key === 'create_case'
            ? { allowed: true, defaultIntervalsSeconds: [60, 300, 900] }
            : { allowed: false, defaultIntervalsSeconds: [] },
        availability: 'none',
        triggers: null,
        requires: [],
        adverse: 'never',
        adverseRule: null,
        biometric: false,
        irreversible: false,
        causeChecked: false,
        stage: 'ga',
      };
      return entry as unknown as AnyActionRegistryEntry;
    }),
  );
}

/** C122.1 (F33): the generic actions on a case. A case's own tags and its fields are writable. */
export const CASE_ACTION_OBJECT_TYPE_ENTRY: ActionObjectTypeEntry = Object.freeze({
  type: 'case',
  idPrefix: 'case',
  readScope: 'cases:read',
  writeScope: 'cases:write',
  redactScope: 'cases:redact',
  tags: true,
  writableAttributes: Object.freeze(['fields', 'case-queue-id']),
});

/** C115.2, C115.6: what a person reads as a state is plain; a comment is text and takes PII. */
export const CASE_ACTION_SINK_ROWS: readonly ActionSinkRow[] = Object.freeze([
  { key: 'create_case', member: '/tags/*', sink: 'text', plain: true },
  { key: 'update_case_status', member: '/status', sink: 'text', plain: true },
  {
    key: 'update_case_status',
    member: '/resolution',
    sink: 'text',
    plain: true,
  },
  {
    key: 'update_case_status',
    member: '/status-tag',
    sink: 'text',
    plain: true,
  },
  { key: 'update_case_status', member: '/comment', sink: 'text' },
  { key: 'add_case_comment', member: '/message', sink: 'text' },
]);

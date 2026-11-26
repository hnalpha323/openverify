/**
 * Workflow runs, their steps, trigger deliveries and trigger files (plan C117.2, C118, C120). A run
 * reads with `workflow-runs:read`, outside the viewer role, because its values can be anything a step
 * read or made (P11; decision 78).
 *
 * Values are masked **fail closed** (C120.6): without PII visibility every step input and output, run
 * output, variable and trigger-snapshot value is `null`, except the members the registry's output
 * schema or the trigger's contract declares non-PII. So each of those members is marked PII here, and
 * the run routes mask them by the registry's marks, never by name alone. Secret values never appear:
 * a step's input holds the unresolved template, and its output is scrubbed (C125.5).
 *
 * An event of a run carries ids, statuses, its version, its rollout label and per-step outcome counts,
 * and output names in `meta`, never a value (C112.7, C119.10). A run's error columns hold codes and
 * fixed text only (C120.2): text a step produced lives in the step's sealed output.
 *
 * Routes (frozen by `foundation-8a`): C112.6. `api-engine` builds the run routes, `api-triggers` the
 * trigger, manual-run and delivery routes.
 */
import {
  WORKFLOW_DELIVERY_STATUSES,
  WORKFLOW_EFFECT_STATUSES,
  WORKFLOW_ERROR_TYPES,
  WORKFLOW_RUN_CREATOR_TYPES,
  WORKFLOW_RUN_STATUSES,
  WORKFLOW_RUN_WAITING_ON,
  WORKFLOW_STEP_STATUSES,
  WORKFLOW_TRIGGER_LIMITS,
  workflowDeliveryStatusSchema,
  workflowEffectStatusSchema,
  workflowNodeTypeSchema,
  workflowRolloutLabelSchema,
  workflowRunStatusSchema,
  workflowRunWaitingOnSchema,
  workflowStepStatusSchema,
  workflowTriggerTypeSchema,
  type Permission,
  type WorkflowDeliveryStatus,
  type WorkflowEffectStatus,
  type WorkflowNodeType,
  type WorkflowRolloutLabel,
  type WorkflowRunStatus,
  type WorkflowRunWaitingOn,
  type WorkflowStepStatus,
  type WorkflowTriggerType,
} from '@openverify/core';
import { z } from 'zod';
import { actionBodySchema, emptyActionBodySchema, optionalActionBodySchema } from './actions.js';
import { eventNameSchema, type EventName } from './event-names.js';
import { anyIdSchema, idSchema } from './ids.js';
import {
  listDocumentSchema,
  requestDocumentSchema,
  resourceIdentifierSchema,
  resourceSchema,
  singleDocumentSchema,
  timestampSchema,
  toNullableTimestamp,
  toOneRelationshipSchema,
  toTimestamp,
} from './json-api.js';
import { booleanFilterSchema, filterListSchema, listQuerySchema } from './list-filters.js';
import {
  workflowActionKeySchema,
  workflowDeclaredNameSchema,
  workflowJsonSchema,
  workflowNodeIdSchema,
} from './workflow-definition.js';
import {
  workflowAcknowledgementKeySchema,
  workflowIdentifierSchema,
  workflowResourceSchema,
  workflowVersionIdentifierSchema,
  workflowVersionResourceSchema,
} from './workflows.js';

export {
  WORKFLOW_DELIVERY_STATUSES,
  WORKFLOW_EFFECT_STATUSES,
  WORKFLOW_ERROR_TYPES,
  WORKFLOW_RUN_CREATOR_TYPES,
  WORKFLOW_RUN_STATUSES,
  WORKFLOW_RUN_WAITING_ON,
  WORKFLOW_STEP_STATUSES,
  WORKFLOW_TRIGGER_LIMITS,
};

/** Marks a member PII (C120.6): nullable, so a masked, purged or event copy still parses. */
function pii<Schema extends z.ZodType>(schema: Schema) {
  return schema.nullable().meta({ pii: true });
}

/** C120.1: the identifier of a run. `workflow-run` is in `RESOURCE_TYPES` since Common. */
export const workflowRunIdentifierSchema = resourceIdentifierSchema('workflow-run', 'wfr');

/** C120.1: the public union, then ours; `null` for a recurring tick, which nobody started. */
export const workflowRunCreatorIdentifierSchema = z.union([
  resourceIdentifierSchema('user', 'usr'),
  resourceIdentifierSchema('api-key', 'key'),
  resourceIdentifierSchema('event', 'evt'),
  resourceIdentifierSchema('scheduled-run', 'srrun'),
  workflowRunIdentifierSchema,
  resourceIdentifierSchema('account-action', 'accac'),
  resourceIdentifierSchema('case-action', 'cact'),
  /** C152.2 (Phase 9): a flow's `run_workflow` action, named by its inquiry. */
  resourceIdentifierSchema('inquiry-flow', 'inq'),
]);
export type WorkflowRunCreator = z.infer<typeof workflowRunCreatorIdentifierSchema>;

const openCode = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/, 'must be a lower-case code');

/** C120.2: an open string with six documented values; `message` is fixed text or our own. */
export const workflowRunErrorSchema = z.strictObject({
  type: openCode,
  message: z.string().min(1).max(500),
});
export type WorkflowRunError = z.infer<typeof workflowRunErrorSchema>;

/** C120.2: `null` when the run failed as a whole (`run-failure`). */
export const workflowRunErroredStepSchema = z.strictObject({
  name: z.string().min(1).max(80),
  key: workflowNodeIdSchema,
  type: workflowNodeTypeSchema,
  'action-key': workflowActionKeySchema.nullable(),
});
export type WorkflowRunErroredStep = z.infer<typeof workflowRunErroredStepSchema>;

/** C120.1 (H32): what the console's "completed with N step errors" reads. */
export const workflowRunStepOutcomesSchema = z.strictObject({
  succeeded: z.int().min(0),
  'failed-continued': z.int().min(0),
  'timed-out': z.int().min(0),
  'unknown-effect': z.int().min(0),
  skipped: z.int().min(0),
});
export type WorkflowRunStepOutcomes = z.infer<typeof workflowRunStepOutcomesSchema>;

interface WorkflowRunAttributesShape {
  readonly status: WorkflowRunStatus;
  readonly 'completed-at': string | null;
  readonly 'waiting-on': WorkflowRunWaitingOn | null;
  readonly error: WorkflowRunError | null;
  readonly 'errored-step': WorkflowRunErroredStep | null;
}

const jsonRecord = z.record(z.string(), workflowJsonSchema);

export const workflowRunAttributesSchema = z
  .strictObject({
    // Public (C120.1).
    status: workflowRunStatusSchema,
    'created-at': timestampSchema,
    'completed-at': timestampSchema.nullable(),
    // Ours (C120.1, C120.2).
    'updated-at': timestampSchema,
    'waiting-on': workflowRunWaitingOnSchema.nullable(),
    'rollout-label': workflowRolloutLabelSchema.nullable(),
    'trigger-type': workflowTriggerTypeSchema,
    error: workflowRunErrorSchema.nullable(),
    'errored-step': workflowRunErroredStepSchema.nullable(),
    /** The ids this run is about: ids are not personal data (C119.3). */
    'subject-ids': z.array(anyIdSchema),
    'step-outcomes': workflowRunStepOutcomesSchema,
    /** C120.7: this run's own id when it is a test run, which is how everything it made is marked. */
    'test-run-id': idSchema('wfr').nullable(),
    /** C120.7: the steps a test run's overrides answered. */
    'overridden-steps': z.array(workflowNodeIdSchema),
    /** C120.9, C120.8: said apart, so a masked `null` never reads as a purged one. */
    'redacted-at': timestampSchema.nullable(),
    'values-purged-at': timestampSchema.nullable(),
    // Values (C120.6), each `null` in an event, once purged or redacted, and masked fail closed.
    inputs: pii(jsonRecord),
    variables: pii(jsonRecord),
    outputs: pii(jsonRecord),
    'trigger-snapshot': pii(jsonRecord),
  })
  .refine(
    (value) => {
      const attributes = value as WorkflowRunAttributesShape;
      return (attributes.status === 'in_progress') === (attributes['completed-at'] === null);
    },
    { message: 'a run says when it ended exactly when it has', path: ['completed-at'] },
  )
  .refine(
    (value) => {
      const attributes = value as WorkflowRunAttributesShape;
      return attributes['waiting-on'] === null || attributes.status === 'in_progress';
    },
    { message: 'only a run in progress waits', path: ['waiting-on'] },
  )
  .refine(
    (value) => {
      const attributes = value as WorkflowRunAttributesShape;
      return (
        (attributes.status === 'errored') === (attributes.error !== null) &&
        (attributes['errored-step'] === null || attributes.error !== null)
      );
    },
    { message: 'an errored run says why, and no other does (C120.2)', path: ['error'] },
  );

export const workflowRunRelationshipsSchema = z.strictObject({
  workflow: toOneRelationshipSchema(workflowIdentifierSchema),
  'workflow-version': toOneRelationshipSchema(workflowVersionIdentifierSchema),
  creator: toOneRelationshipSchema(workflowRunCreatorIdentifierSchema.nullable()),
  /** Ours (C120.4). */
  'rerun-of': toOneRelationshipSchema(workflowRunIdentifierSchema.nullable()),
});

/** C120.1: the public resource carries `meta.processing-time-seconds`. */
export const workflowRunResourceSchema = z.strictObject({
  type: z.literal('workflow-run'),
  id: idSchema('wfr'),
  attributes: workflowRunAttributesSchema,
  relationships: workflowRunRelationshipsSchema,
  meta: z.strictObject({ 'processing-time-seconds': z.number().min(0).nullable() }),
});
export type WorkflowRunResource = z.infer<typeof workflowRunResourceSchema>;
export const workflowRunDocumentSchema = singleDocumentSchema(workflowRunResourceSchema);
export type WorkflowRunDocument = z.infer<typeof workflowRunDocumentSchema>;
export const workflowRunListDocumentSchema = listDocumentSchema(workflowRunResourceSchema);

/** `GET /api/v1/workflow-runs`, newest first. */
export const listWorkflowRunsQuerySchema = listQuerySchema('wfr', {
  'filter[workflow-id]': filterListSchema(idSchema('wfl')).optional(),
  'filter[status]': filterListSchema(workflowRunStatusSchema).optional(),
  'filter[workflow-version-id]': filterListSchema(idSchema('wfv')).optional(),
  'filter[subject-id]': anyIdSchema.optional(),
  'filter[has-step-errors]': booleanFilterSchema.optional(),
});

/** C143.6: what `GET /api/v1/workflow-runs/:id` can include. */
export const WORKFLOW_RUN_INCLUDES = ['workflow', 'workflow-version'] as const;
export const workflowRunIncludeSchema = z.enum(WORKFLOW_RUN_INCLUDES);
export type WorkflowRunInclude = z.infer<typeof workflowRunIncludeSchema>;

/** C143.6: a run's reader may not read definitions, which is `workflows:read`. */
export const WORKFLOW_RUN_INCLUDE_PERMISSIONS: Readonly<
  Record<WorkflowRunInclude, readonly Permission[]>
> = Object.freeze({ workflow: ['workflows:read'], 'workflow-version': ['workflows:read'] });

export const getWorkflowRunQuerySchema = z.strictObject({
  include: filterListSchema(workflowRunIncludeSchema, WORKFLOW_RUN_INCLUDES.length).optional(),
});

export const workflowRunIncludeDocumentSchema = z.strictObject({
  data: workflowRunResourceSchema,
  included: z
    .array(z.discriminatedUnion('type', [workflowResourceSchema, workflowVersionResourceSchema]))
    .optional(),
});
export type WorkflowRunIncludeDocument = z.infer<typeof workflowRunIncludeDocumentSchema>;

/** `POST /api/v1/workflow-runs/:id/resume` (C120.3). */
export const resumeWorkflowRunBodySchema = optionalActionBodySchema(
  z.strictObject({ 'skip-unknown-effects': z.boolean().optional() }),
);
export type ResumeWorkflowRunBody = z.infer<typeof resumeWorkflowRunBodySchema>;

/** `POST /api/v1/workflow-runs/:id/rerun` (C120.4): a new run on the latest published version. */
export const rerunWorkflowRunBodySchema = emptyActionBodySchema;
/** `POST /api/v1/workflow-runs/:id/cancel` (C120.5). */
export const cancelWorkflowRunBodySchema = emptyActionBodySchema;

/** `POST /api/v1/workflows/:id/cancel-runs` (C116.2): the unfinished runs of older versions. */
export const cancelWorkflowRunsBodySchema = actionBodySchema(
  z.strictObject({ 'before-version-id': idSchema('wfv') }),
);
export type CancelWorkflowRunsBody = z.infer<typeof cancelWorkflowRunsBodySchema>;

export const cancelWorkflowRunsDocumentSchema = z.strictObject({
  meta: z.strictObject({ 'canceled-count': z.int().min(0) }),
});

// ---------------------------------------------------------------------------------------------
// Steps (C117.2)

interface WorkflowRunStepAttributesShape {
  readonly status: WorkflowStepStatus;
  readonly 'error-type': string | null;
}

export const workflowRunStepAttributesSchema = z
  .strictObject({
    'node-id': workflowNodeIdSchema,
    /** `loop[3]/send_email`, `module:check/…`; empty at the top level. */
    'iteration-path': z.string().max(512),
    'node-type': workflowNodeTypeSchema,
    'action-key': workflowActionKeySchema.nullable(),
    'action-version': z.int().min(1).nullable(),
    status: workflowStepStatusSchema,
    attempt: z.int().min(0),
    'due-at': timestampSchema.nullable(),
    'started-at': timestampSchema.nullable(),
    'completed-at': timestampSchema.nullable(),
    /** Codes alone (C120.2): text a step produced lives in `output`. */
    'error-type': openCode.nullable(),
    'error-code': openCode.nullable(),
    /** C117.5: `unknown` blocks a resume until it is acknowledged (C120.3). */
    'effect-status': workflowEffectStatusSchema.nullable(),
    /** C120.7: a test run's step that made no effect, or whose output a request supplied. */
    simulated: z.boolean(),
    overridden: z.boolean(),
    // Values (C120.6). `input` holds the unresolved templates, never a secret (C125.5).
    input: pii(jsonRecord),
    output: pii(jsonRecord),
    /** C120.7, C123.4: a sandbox test run's capture, served only to the run's creator. */
    console: pii(z.array(z.string().max(1024)).max(50)),
  })
  .refine(
    (value) => {
      const attributes = value as WorkflowRunStepAttributesShape;
      return attributes.status !== 'failed' || attributes['error-type'] !== null;
    },
    { message: 'a failed step says why (C120.2)', path: ['error-type'] },
  );

export const workflowRunStepResourceSchema = resourceSchema(
  'workflow-run-step',
  'wfst',
  workflowRunStepAttributesSchema,
);
export type WorkflowRunStepResource = z.infer<typeof workflowRunStepResourceSchema>;

export const listWorkflowRunStepsQuerySchema = listQuerySchema('wfst', {}, { createdAt: false });

/** C117.2 `workflow_run_files`: a trigger's file, in scope as an id, never as bytes (P41). */
export const workflowRunFileResourceSchema = resourceSchema(
  'workflow-run-file',
  'wfrf',
  z.strictObject({
    filename: pii(z.string().min(1).max(255)),
    'mime-type': z.string().min(1).max(127),
    'byte-size': z.int().min(0),
    'created-at': timestampSchema,
  }),
);
export type WorkflowRunFileResource = z.infer<typeof workflowRunFileResourceSchema>;

/** `GET /api/v1/workflow-runs/:id/steps`: the run's files come with its steps (C112.1). */
export const workflowRunStepListDocumentSchema = z.strictObject({
  data: z.array(workflowRunStepResourceSchema),
  included: z.array(workflowRunFileResourceSchema).optional(),
  links: z.strictObject({ next: z.string().nullable() }),
});
export type WorkflowRunStepListDocument = z.infer<typeof workflowRunStepListDocumentSchema>;

// ---------------------------------------------------------------------------------------------
// Trigger deliveries (C118.1)

export const workflowTriggerDeliveryResourceSchema = z.strictObject({
  type: z.literal('workflow-trigger-delivery'),
  id: idSchema('wftd'),
  attributes: z.strictObject({
    status: workflowDeliveryStatusSchema,
    /** Why it did not start a run; `null` while pending and once it did. */
    'reason-code': z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,63}$/, 'must be a snake_case code')
      .nullable(),
    'event-name': eventNameSchema,
    'not-before': timestampSchema.nullable(),
    'created-at': timestampSchema,
    'updated-at': timestampSchema,
  }),
  relationships: z.strictObject({
    workflow: toOneRelationshipSchema(workflowIdentifierSchema),
    event: toOneRelationshipSchema(resourceIdentifierSchema('event', 'evt')),
    'workflow-run': toOneRelationshipSchema(workflowRunIdentifierSchema.nullable()),
  }),
});
export type WorkflowTriggerDeliveryResource = z.infer<typeof workflowTriggerDeliveryResourceSchema>;
export const workflowTriggerDeliveryListDocumentSchema = listDocumentSchema(
  workflowTriggerDeliveryResourceSchema,
);

/** `GET /api/v1/workflow-trigger-deliveries` (H18). */
export const listWorkflowTriggerDeliveriesQuerySchema = listQuerySchema('wftd', {
  'filter[workflow-id]': filterListSchema(idSchema('wfl')).optional(),
  'filter[status]': filterListSchema(workflowDeliveryStatusSchema).optional(),
});

// ---------------------------------------------------------------------------------------------
// Starting a run (C118.2, C118.5, C120.7)

/**
 * C118.2: a file value, `{ filename, data }` with base64 data, at any depth of `fields`, nested and
 * undeclared ones too. The route decodes it, answers 400 with `source.pointer` when it is malformed,
 * and puts the id in scope, never the bytes.
 */
export const workflowTriggerFileValueSchema = z.strictObject({
  filename: z.string().min(1).max(255).meta({ pii: true }),
  data: z.base64().meta({ pii: true }),
});
export type WorkflowTriggerFileValue = z.infer<typeof workflowTriggerFileValueSchema>;

/**
 * `POST /api/v1/workflows/:id/trigger` (public): `data.attributes.fields` alone, so `meta.params` and
 * top-level attributes are refused. The fields are validated by the live version's `inputs` (C118.2),
 * so a value this schema cannot know is that route's 422, and a problem never echoes it.
 */
export const triggerWorkflowBodySchema = z.strictObject({
  data: z.strictObject({
    attributes: z.strictObject({
      fields: z.record(workflowDeclaredNameSchema, workflowJsonSchema).meta({ pii: true }),
    }),
  }),
});
export type TriggerWorkflowBody = z.infer<typeof triggerWorkflowBodySchema>;

/** `POST /api/v1/workflows/:id/manual-runs` (H26): one run per object, by ids or a CSV of ids. */
export const createWorkflowManualRunsBodySchema = requestDocumentSchema(
  'workflow-run',
  z
    .strictObject({
      'object-ids': z
        .array(anyIdSchema)
        .min(1)
        .max(WORKFLOW_TRIGGER_LIMITS['manual-run-objects'].value)
        .optional()
        .meta({ pii: true }),
      /** Read by `readCsv`, with the importers' parser rules (F13). */
      csv: z
        .string()
        .min(1)
        .max(WORKFLOW_TRIGGER_LIMITS['manual-run-csv-characters'].value)
        .optional()
        .meta({ pii: true }),
    })
    .refine(
      (attributes) => (attributes['object-ids'] === undefined) !== (attributes.csv === undefined),
      'takes object ids or a CSV, never both',
    ),
);
export type CreateWorkflowManualRunsBody = z.infer<typeof createWorkflowManualRunsBodySchema>;

/** One id or row that started no run, by code: a problem never echoes a value (P21). */
export const workflowManualRunRefusalSchema = z.strictObject({
  'object-id': anyIdSchema.nullable(),
  row: z.int().min(1).nullable(),
  code: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'must be a snake_case code'),
});

export const workflowManualRunsDocumentSchema = z.strictObject({
  meta: z.strictObject({
    'workflow-run-ids': z.array(idSchema('wfr')),
    refused: z.array(workflowManualRunRefusalSchema),
  }),
});
export type WorkflowManualRunsDocument = z.infer<typeof workflowManualRunsDocumentSchema>;

/**
 * `POST /api/v1/workflows/:id/test-runs` (C120.7), sandbox environments only. The trigger object is
 * an existing id or a synthetic payload; a step's override stands in for its output. Without its
 * acknowledgement an irreversible step is simulated.
 */
export const createWorkflowTestRunBodySchema = z.strictObject({
  data: z.strictObject({
    type: z.literal('workflow-run').optional(),
    attributes: z
      .strictObject({
        /** The draft when left out. */
        'workflow-version-id': idSchema('wfv').optional(),
        /** An existing object, or a synthetic payload the trigger's schema validates. */
        'object-id': anyIdSchema.optional(),
        'trigger-payload': workflowJsonSchema.optional().meta({ pii: true }),
        'start-step': workflowNodeIdSchema.optional(),
        'end-step': workflowNodeIdSchema.optional(),
        overrides: z
          .record(workflowNodeIdSchema, workflowJsonSchema)
          .optional()
          .meta({ pii: true }),
        'allow-hosts': z.array(z.string().min(1).max(255)).max(32).optional(),
        /** Events a test run causes trigger no workflows unless this opts in. */
        'allow-triggers': z.boolean().optional(),
      })
      .refine(
        (attributes) =>
          (attributes['object-id'] === undefined) !== (attributes['trigger-payload'] === undefined),
        'takes an object id or a payload, never both',
      ),
  }),
  meta: z
    .strictObject({ acknowledgements: z.array(workflowAcknowledgementKeySchema).max(400) })
    .optional(),
});
export type CreateWorkflowTestRunBody = z.infer<typeof createWorkflowTestRunBodySchema>;

// ---------------------------------------------------------------------------------------------
// Events (C112.7)

/**
 * C112.7, C119.10: `payload.meta.context` of a run event. `workflow-run.errored` names the step and
 * the error, `workflow-run.completed` the output names; neither ever holds a value, and the others
 * are `{}`, as the public `context` is.
 */
export const workflowRunEventMetaSchema = z.strictObject({
  context: z.strictObject({
    'errored-step': workflowRunErroredStepSchema.nullable().optional(),
    error: workflowRunErrorSchema.optional(),
    'output-names': z.array(workflowDeclaredNameSchema).optional(),
  }),
});
export type WorkflowRunEventMeta = z.infer<typeof workflowRunEventMetaSchema>;

/** `workflow-run.errored` always names its error. */
export const workflowRunErroredEventMetaSchema = z.strictObject({
  context: z.strictObject({
    'errored-step': workflowRunErroredStepSchema.nullable(),
    error: workflowRunErrorSchema,
  }),
});

/**
 * C143.5: the PII names of the run resources and request bodies, joined to the masking lists and the
 * API-log set by `foundation-8a`. `input`, `output`, `outputs` and `variables` are masked whole in a
 * stored log. The run routes mask members by the registry's marks, which is stricter (C120.6). A file
 * value's `data` is not listed, because it sits inside `fields` and `data` names every JSON:API body.
 */
export const PII_WORKFLOW_RUN_ATTRIBUTES: readonly string[] = Object.freeze([
  'inputs',
  'variables',
  'outputs',
  'trigger-snapshot',
  'input',
  'output',
  'console',
  'filename',
  'fields',
  'trigger-payload',
  'overrides',
  'parameters',
  'prefilled-value',
  'object-ids',
  'csv',
]);

// ---------------------------------------------------------------------------------------------
// Builders

export interface WorkflowRunRecord {
  id: string;
  workflowId: string;
  workflowVersionId: string;
  status: WorkflowRunStatus;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  waitingOn: WorkflowRunWaitingOn | null;
  rolloutLabel: WorkflowRolloutLabel | null;
  triggerType: WorkflowTriggerType;
  error: WorkflowRunError | null;
  erroredStep: WorkflowRunErroredStep | null;
  subjectIds: readonly string[];
  stepOutcomes: WorkflowRunStepOutcomes;
  testRunId: string | null;
  overriddenSteps: readonly string[];
  redactedAt: Date | null;
  valuesPurgedAt: Date | null;
  inputs: Record<string, unknown> | null;
  variables: Record<string, unknown> | null;
  outputs: Record<string, unknown> | null;
  triggerSnapshot: Record<string, unknown> | null;
  creator: WorkflowRunCreator | null;
  rerunOf: string | null;
  processingTimeSeconds: number | null;
}

/**
 * Builds the run resource. The caller has masked its values (C120.6).
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildWorkflowRunResource(record: WorkflowRunRecord): WorkflowRunResource {
  return workflowRunResourceSchema.parse({
    type: 'workflow-run',
    id: record.id,
    attributes: {
      status: record.status,
      'created-at': toTimestamp(record.createdAt),
      'completed-at': toNullableTimestamp(record.completedAt),
      'updated-at': toTimestamp(record.updatedAt),
      'waiting-on': record.waitingOn,
      'rollout-label': record.rolloutLabel,
      'trigger-type': record.triggerType,
      error: record.error,
      'errored-step': record.erroredStep,
      'subject-ids': record.subjectIds,
      'step-outcomes': record.stepOutcomes,
      'test-run-id': record.testRunId,
      'overridden-steps': record.overriddenSteps,
      'redacted-at': toNullableTimestamp(record.redactedAt),
      'values-purged-at': toNullableTimestamp(record.valuesPurgedAt),
      inputs: record.inputs,
      variables: record.variables,
      outputs: record.outputs,
      'trigger-snapshot': record.triggerSnapshot,
    },
    relationships: {
      workflow: { data: { type: 'workflow', id: record.workflowId } },
      'workflow-version': { data: { type: 'workflow-version', id: record.workflowVersionId } },
      creator: { data: record.creator },
      'rerun-of': {
        data: record.rerunOf === null ? null : { type: 'workflow-run', id: record.rerunOf },
      },
    },
    meta: { 'processing-time-seconds': record.processingTimeSeconds },
  });
}

export interface WorkflowRunStepRecord {
  id: string;
  nodeId: string;
  iterationPath: string;
  nodeType: WorkflowNodeType;
  actionKey: string | null;
  actionVersion: number | null;
  status: WorkflowStepStatus;
  attempt: number;
  dueAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  errorType: string | null;
  errorCode: string | null;
  effectStatus: WorkflowEffectStatus | null;
  simulated: boolean;
  overridden: boolean;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  console: readonly string[] | null;
}

/**
 * Builds a step resource. The caller has masked its values (C120.6).
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildWorkflowRunStepResource(
  record: WorkflowRunStepRecord,
): WorkflowRunStepResource {
  return workflowRunStepResourceSchema.parse({
    type: 'workflow-run-step',
    id: record.id,
    attributes: {
      'node-id': record.nodeId,
      'iteration-path': record.iterationPath,
      'node-type': record.nodeType,
      'action-key': record.actionKey,
      'action-version': record.actionVersion,
      status: record.status,
      attempt: record.attempt,
      'due-at': toNullableTimestamp(record.dueAt),
      'started-at': toNullableTimestamp(record.startedAt),
      'completed-at': toNullableTimestamp(record.completedAt),
      'error-type': record.errorType,
      'error-code': record.errorCode,
      'effect-status': record.effectStatus,
      simulated: record.simulated,
      overridden: record.overridden,
      input: record.input,
      output: record.output,
      console: record.console,
    },
  });
}

export interface WorkflowTriggerDeliveryRecord {
  id: string;
  workflowId: string;
  eventId: string;
  eventName: EventName;
  workflowRunId: string | null;
  status: WorkflowDeliveryStatus;
  reasonCode: string | null;
  notBefore: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Builds a delivery resource.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildWorkflowTriggerDeliveryResource(
  record: WorkflowTriggerDeliveryRecord,
): WorkflowTriggerDeliveryResource {
  return workflowTriggerDeliveryResourceSchema.parse({
    type: 'workflow-trigger-delivery',
    id: record.id,
    attributes: {
      status: record.status,
      'reason-code': record.reasonCode,
      'event-name': record.eventName,
      'not-before': toNullableTimestamp(record.notBefore),
      'created-at': toTimestamp(record.createdAt),
      'updated-at': toTimestamp(record.updatedAt),
    },
    relationships: {
      workflow: { data: { type: 'workflow', id: record.workflowId } },
      event: { data: { type: 'event', id: record.eventId } },
      'workflow-run': {
        data:
          record.workflowRunId === null ? null : { type: 'workflow-run', id: record.workflowRunId },
      },
    },
  });
}

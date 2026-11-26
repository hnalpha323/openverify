/**
 * The workflow vocabularies (plan C112, C113, C117, C118, C120, C122): the lists the contracts serve
 * and the tables pin, in `@openverify/core` because `packages/db` reads core alone. The definition
 * schema itself lives in `@openverify/contracts`, which holds the event names and ids it uses.
 *
 * Public values are the public product's (behaviour note 1.1-1.3); the rest are ours. Every constant
 * says which it is and where it comes from.
 */
import { z } from 'zod';

const KIB = 1024;

const stated = (value: number, basis: 'public' | 'provisional', source: string) =>
  Object.freeze({ value, basis, source });

const NOTE = 'docs/research/phase8-behaviour.md';
const ENGINE = 'docs/research/phase8-workflow-engine.md';

/** C112.3: the public open enum. */
export const WORKFLOW_STATUSES = ['paused', 'running', 'archived'] as const;
export const workflowStatusSchema = z.enum(WORKFLOW_STATUSES);
export type WorkflowStatus = z.infer<typeof workflowStatusSchema>;

/** C112.3 (ours): a module runs only inside another workflow's run (C119.8). */
export const WORKFLOW_KINDS = ['workflow', 'module'] as const;
export const workflowKindSchema = z.enum(WORKFLOW_KINDS);
export type WorkflowKind = z.infer<typeof workflowKindSchema>;

/** C121.5 (ours): why a workflow is paused, so the console's banner can say so. */
export const WORKFLOW_PAUSED_REASONS = ['operator', 'publisher_revoked'] as const;
export const workflowPausedReasonSchema = z.enum(WORKFLOW_PAUSED_REASONS);
export type WorkflowPausedReason = z.infer<typeof workflowPausedReasonSchema>;

/** C112.4 (public). */
export const WORKFLOW_VERSION_STATUSES = ['draft', 'published', 'archived'] as const;
export const workflowVersionStatusSchema = z.enum(WORKFLOW_VERSION_STATUSES);
export type WorkflowVersionStatus = z.infer<typeof workflowVersionStatusSchema>;

/**
 * C112.4 (public): the eight public trigger types, then `trigger-flow` (C152.2, Phase 9; ours): a
 * workflow started only by a flow's `run_workflow` action, with the inquiry as its subject and its
 * declared inputs as its trigger view.
 */
export const WORKFLOW_TRIGGER_TYPES = [
  'trigger-event',
  'trigger-api',
  'trigger-schedule',
  'trigger-recurring',
  'trigger-direct',
  'trigger-account',
  'trigger-case',
  'trigger-verification',
  'trigger-flow',
] as const;
export const workflowTriggerTypeSchema = z.enum(WORKFLOW_TRIGGER_TYPES);
export type WorkflowTriggerType = z.infer<typeof workflowTriggerTypeSchema>;

const TRIGGER_TYPES: ReadonlySet<string> = new Set(WORKFLOW_TRIGGER_TYPES);

/** Whether `value` names a trigger type (C112.4). */
export function isWorkflowTriggerType(value: unknown): value is WorkflowTriggerType {
  return typeof value === 'string' && TRIGGER_TYPES.has(value);
}

/**
 * The trigger types an action serves only when its `triggers` lists them (C152.2, Workflow 9A
 * Stage 1a amendment 3): an action whose `triggers` is `null` serves every other type.
 */
export const LISTED_ONLY_TRIGGER_TYPES: readonly WorkflowTriggerType[] = Object.freeze([
  'trigger-flow',
]);

/**
 * Whether an action with `triggers` serves `trigger` (C122.3): `null` serves every type but those
 * of `LISTED_ONLY_TRIGGER_TYPES`, so no action serves a flow until someone lists it there. The
 * graph check, the console's palette and the action catalogue's documented rule all read this.
 */
export function actionServesTrigger(
  triggers: readonly WorkflowTriggerType[] | null,
  trigger: WorkflowTriggerType,
): boolean {
  return triggers === null
    ? !LISTED_ONLY_TRIGGER_TYPES.includes(trigger)
    : triggers.includes(trigger);
}

/** C118.4: the objects a recurring trigger or a manual run walks. */
export const WORKFLOW_OBJECT_TYPES = [
  'account',
  'case',
  'inquiry',
  'report',
  'transaction',
] as const;
export const workflowObjectTypeSchema = z.enum(WORKFLOW_OBJECT_TYPES);
export type WorkflowObjectType = z.infer<typeof workflowObjectTypeSchema>;

/** C112.4 (public). */
export const WORKFLOW_ROLLOUT_LABELS = ['treatment', 'control'] as const;
export const workflowRolloutLabelSchema = z.enum(WORKFLOW_ROLLOUT_LABELS);
export type WorkflowRolloutLabel = z.infer<typeof workflowRolloutLabelSchema>;

/** C116.3 (public). */
export const WORKFLOW_DEPLOYMENT_STATUSES = ['active', 'inactive'] as const;
export const workflowDeploymentStatusSchema = z.enum(WORKFLOW_DEPLOYMENT_STATUSES);
export type WorkflowDeploymentStatus = z.infer<typeof workflowDeploymentStatusSchema>;

/** C113.2: the node types of a definition. `join` closes a `parallel`. */
export const WORKFLOW_NODE_TYPES = [
  'action',
  'wait',
  'parallel',
  'join',
  'conditional',
  'loop',
  'module',
  'output',
  'module-input',
  'array-map-output',
] as const;
export const workflowNodeTypeSchema = z.enum(WORKFLOW_NODE_TYPES);
export type WorkflowNodeType = z.infer<typeof workflowNodeTypeSchema>;

/** C113.2: what a wait waits for, and what a timed-out one does. */
export const WORKFLOW_WAIT_MODES = ['events', 'time'] as const;
export const WORKFLOW_WAIT_TIMEOUT_ACTIONS = ['continue', 'error'] as const;

/** C113.2: the three loops. */
export const WORKFLOW_LOOP_MODES = ['for-each', 'while', 'map'] as const;

/**
 * C114.6: what each condition position does with a nullable path. There is no default: a condition
 * that reads one declares its answer, so an unknown never reads as false.
 */
export const WORKFLOW_TRIGGER_ON_NULL = ['error', 'admit', 'skip'] as const;
export const WORKFLOW_WAIT_ON_NULL = ['error', 'keep-waiting', 'accept'] as const;
export const WORKFLOW_WHILE_ON_NULL = ['error', 'stop'] as const;
export const WORKFLOW_PREDICATE_ON_NULL = ['error', 'include', 'exclude'] as const;

/** C120.1 (decision 20): the public three, and ours `canceled`, spelled as the session status is. */
export const WORKFLOW_RUN_STATUSES = ['in_progress', 'completed', 'errored', 'canceled'] as const;
export const workflowRunStatusSchema = z.enum(WORKFLOW_RUN_STATUSES);
export type WorkflowRunStatus = z.infer<typeof workflowRunStatusSchema>;

/** C120.1: waiting is `in_progress` with one of these. */
export const WORKFLOW_RUN_WAITING_ON = [
  'event',
  'time',
  'earlier-run',
  'child-run',
  'admission',
] as const;
export const workflowRunWaitingOnSchema = z.enum(WORKFLOW_RUN_WAITING_ON);
export type WorkflowRunWaitingOn = z.infer<typeof workflowRunWaitingOnSchema>;

/**
 * C120.1: a run's creator, ours after the public `user`, `event` and `scheduled-run`. A recurring tick
 * has no creator, so its run reads `null` and its `trigger-type` says what started it.
 */
export const WORKFLOW_RUN_CREATOR_TYPES = [
  'user',
  'api-key',
  'event',
  'scheduled-run',
  'workflow-run',
  'account-action',
  'case-action',
  // C152.2 (Phase 9; ours): a flow's run_workflow action, named by the inquiry's `inq_` id.
  'inquiry-flow',
] as const;

/** C117.2: a step's statuses. */
export const WORKFLOW_STEP_STATUSES = [
  'pending',
  'ready',
  'running',
  'waiting',
  'succeeded',
  'failed',
  'skipped',
  'canceled',
  'timed_out',
] as const;
export const workflowStepStatusSchema = z.enum(WORKFLOW_STEP_STATUSES);
export type WorkflowStepStatus = z.infer<typeof workflowStepStatusSchema>;

/** C117.5: a step's effect. `unknown` blocks a resume until it is acknowledged (C120.3). */
export const WORKFLOW_EFFECT_STATUSES = ['claimed', 'done', 'unknown'] as const;
export const workflowEffectStatusSchema = z.enum(WORKFLOW_EFFECT_STATUSES);
export type WorkflowEffectStatus = z.infer<typeof workflowEffectStatusSchema>;

/** C117.2: one row per (event, workflow) owed a run. */
export const WORKFLOW_DELIVERY_STATUSES = [
  'pending',
  'run_created',
  'filtered',
  'refused',
  'expired',
] as const;
export const workflowDeliveryStatusSchema = z.enum(WORKFLOW_DELIVERY_STATUSES);
export type WorkflowDeliveryStatus = z.infer<typeof workflowDeliveryStatusSchema>;

/**
 * C120.2 (decision 21): the six public error types OpenVerify emits. The served field is an open
 * string, so adding one later is not breaking, and each internal code maps to one of these.
 */
export const WORKFLOW_ERROR_TYPES = [
  'missing-input-error',
  'invalid-input-error',
  'configuration-error',
  'resource-error',
  'unknown-error',
  'run-failure',
] as const;
export type WorkflowErrorType = (typeof WORKFLOW_ERROR_TYPES)[number];

/** C116.4: what a publish can acknowledge, each as `<kind>:<step id>`. */
export const WORKFLOW_ACKNOWLEDGEMENT_KINDS = [
  'egress',
  'irreversible',
  'heuristic',
  'override-failed',
  'unconfirmed',
] as const;
export type WorkflowAcknowledgementKind = (typeof WORKFLOW_ACKNOWLEDGEMENT_KINDS)[number];

/** C122.1: what an action touches. */
export const ACTION_KINDS = ['internal', 'egress', 'compute', 'control'] as const;
export const actionKindSchema = z.enum(ACTION_KINDS);
export type ActionKind = z.infer<typeof actionKindSchema>;

/** C122.1, C117.5: each action's stated guarantee. */
export const ACTION_DELIVERIES = [
  'exactly-once',
  'at-least-once',
  'at-most-once',
  'pure',
  'control',
] as const;
export const actionDeliverySchema = z.enum(ACTION_DELIVERIES);
export type ActionDelivery = z.infer<typeof actionDeliverySchema>;

/** C122.1 (P42, V10; decision 80). */
export const ACTION_ADVERSE = ['always', 'by-config', 'never'] as const;
export const actionAdverseSchema = z.enum(ACTION_ADVERSE);
export type ActionAdverse = z.infer<typeof actionAdverseSchema>;

/** C122.1: `beta` where the output carries H-tier results. */
export const ACTION_STAGES = ['ga', 'beta'] as const;
export const actionStageSchema = z.enum(ACTION_STAGES);
export type ActionStage = z.infer<typeof actionStageSchema>;

/**
 * C113.4 and C117.7. `public` values are the public product's. A definition's `config` cap is measured
 * without the three members that have larger caps of their own (Stage 1a amendment 21).
 */
export const WORKFLOW_DEFINITION_LIMITS = Object.freeze({
  nodes: stated(200, 'provisional', `C113.4; ${ENGINE} 3.9`),
  edges: stated(400, 'provisional', `C113.4; ${ENGINE} 3.9`),
  'name-length': stated(80, 'provisional', 'C113.4: what a node shows in the console'),
  'config-bytes': stated(16 * KIB, 'provisional', 'C113.4'),
  'definition-bytes': stated(256 * KIB, 'provisional', 'C113.4'),
  inputs: stated(32, 'provisional', 'C113.4'),
  variables: stated(32, 'provisional', 'C113.4'),
  outputs: stated(32, 'provisional', 'C113.4'),
  'nesting-depth': stated(3, 'provisional', 'C113.4'),
  'parallel-branches-min': stated(2, 'provisional', 'C113.2: one branch is no parallel'),
  'parallel-branches': stated(10, 'provisional', 'C113.2'),
  'retry-intervals': stated(10, 'provisional', 'C113.2'),
  'retry-interval-seconds': stated(3_600, 'provisional', 'C113.2'),
  'wait-seconds': stated(2_592_000, 'public', `${NOTE} 1.8: 30 days, both kinds of wait`),
  'loop-iterations': stated(100, 'public', `${NOTE} 1.8`),
  'loop-concurrency': stated(10, 'provisional', 'C113.2'),
  'recurring-batch': stated(1_000, 'provisional', 'C118.4: at most, per tick'),
  'recurring-batch-default': stated(100, 'provisional', 'C118.4 (decision 24)'),
  'recurring-every-minutes': stated(1, 'provisional', 'C118.4 (decision 9): the shortest interval'),
});

/** C118.2, C118.5: the public trigger body's file values, and the two lists a route takes. */
export const WORKFLOW_TRIGGER_LIMITS = Object.freeze({
  'file-bytes': stated(10 * KIB * KIB, 'provisional', 'C118.2: as an attachment (C135)'),
  'body-bytes': stated(14 * KIB * KIB, 'provisional', 'C118.2: this route alone'),
  'manual-run-objects': stated(1_000, 'provisional', 'C118.5'),
  'manual-run-csv-characters': stated(64 * KIB, 'provisional', 'C118.5: 1,000 ids and a header'),
});

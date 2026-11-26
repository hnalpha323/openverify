/**
 * The engine's limits (plan C117.7, C114.3, C115.2) and the public type of each code (C120.2).
 *
 * Every constant states its basis, as the check registry's do: `public` where the public product
 * states the value (behaviour note 1.8), `provisional` where the number is ours. None is tuned on
 * test data. `docs/workflows/limits.md` publishes them, and each is enforced with a code.
 */
import { WORKFLOW_DEFINITION_LIMITS, type WorkflowErrorType } from '@openverify/core';
import { WORKFLOW_ACTION_ERROR_TYPES } from '../actions/errors.js';

export interface StatedLimit {
  readonly value: number;
  readonly basis: 'public' | 'provisional';
  readonly source: string;
}

const KIB = 1024;
const DAY_SECONDS = 86_400;

const stated = (value: number, basis: StatedLimit['basis'], source: string): StatedLimit =>
  Object.freeze({ value, basis, source });

const provisional = (value: number, source: string): StatedLimit =>
  stated(value, 'provisional', source);

/** C117.7 (decision 11): the public values where public, else ours. */
export const WORKFLOW_RUN_LIMITS = Object.freeze({
  'wait-seconds': WORKFLOW_DEFINITION_LIMITS['wait-seconds'],
  'loop-items': stated(100, 'public', 'C117.7; phase8-behaviour.md 1.3: a longer list errors'),
  'step-executions': provisional(5_000, 'C117.7: loops and retries included'),
  'run-duration-seconds': provisional(90 * DAY_SECONDS, 'C117.7: the default event retention'),
  'run-depth': provisional(5, 'C117.7: Run Workflow and Schedule Workflow'),
  'event-fanout': provisional(50, 'C117.7: workflows started by one event'),
  subjects: provisional(1_000, 'C117.7, C120.9: past it the run is marked overflowed'),
  'trigger-depth': provisional(8, 'C117.7, C118.8: causality depth'),
  'trigger-snapshot-bytes': provisional(256 * KIB, 'C117.7: an event document with its included'),
  'step-output-bytes': provisional(64 * KIB, 'C117.7: a step output journaled'),
  'variables-bytes': provisional(KIB * KIB, 'C115.4, C117.7: all of a run'),
  'step-claims': provisional(10, 'C117.4: the C74.1 crash-loop cap'),
  'redactions-per-run': provisional(100, 'C127.8 (decision 42)'),
} satisfies Readonly<Record<string, StatedLimit>>);

/** C114.3: exceeding one is `expression_limit_exceeded`, never a truthy or falsy answer. */
export const EXPRESSION_LIMITS = Object.freeze({
  'condition-bytes': provisional(16 * KIB, 'C114.3: serialised'),
  depth: provisional(32, 'C114.3'),
  nodes: provisional(1_000, 'C114.3'),
  evaluations: provisional(10_000, 'C114.3: iteration operators count each element'),
  'array-elements': provisional(1_000, 'C114.3'),
  'string-characters': provisional(10_000, 'C114.3'),
} satisfies Readonly<Record<string, StatedLimit>>);

/** C115.2: a sink may hold a rendered value to less. */
export const TEMPLATE_LIMITS = Object.freeze({
  'template-bytes': provisional(32 * KIB, 'C115.2'),
  'rendered-bytes': provisional(KIB * KIB, 'C115.2'),
} satisfies Readonly<Record<string, StatedLimit>>);

/** C117.7: the code each limit is enforced with. */
export const WORKFLOW_LIMIT_CODES = Object.freeze({
  'wait-seconds': 'definition_invalid',
  'loop-items': 'loop_limit_exceeded',
  'step-executions': 'step_limit_exceeded',
  'run-duration-seconds': 'run_deadline_exceeded',
  'run-depth': 'run_depth_exceeded',
  'event-fanout': 'publish_trigger_fanout_exceeded',
  subjects: 'subjects_overflow',
  'trigger-depth': 'trigger_depth_exceeded',
  'trigger-snapshot-bytes': 'payload_too_large',
  'step-output-bytes': 'payload_too_large',
  'variables-bytes': 'payload_too_large',
  'step-claims': 'execution_error',
  'redactions-per-run': 'redaction_limit_exceeded',
} satisfies Readonly<Record<keyof typeof WORKFLOW_RUN_LIMITS, string>>);

/**
 * C120.2: the step and run errors of the pure engine, each with the public type it is served as. A
 * type carries `message` only for configuration and input errors, so these are codes, never text.
 */
export const ENGINE_ERROR_TYPES = Object.freeze({
  expression_limit_exceeded: 'configuration-error',
  expression_type_mismatch: 'configuration-error',
  expression_clock_missing: 'configuration-error',
  template_type_mismatch: 'configuration-error',
  secret_placement_refused: 'configuration-error',
  variable_type_mismatch: 'configuration-error',
  run_depth_exceeded: 'configuration-error',
  expression_arithmetic_error: 'invalid-input-error',
  expression_conversion_failed: 'invalid-input-error',
  template_value_refused: 'invalid-input-error',
  loop_limit_exceeded: 'invalid-input-error',
  loop_items_invalid: 'invalid-input-error',
  condition_input_null: 'missing-input-error',
  template_variable_missing: 'missing-input-error',
  variable_unset: 'missing-input-error',
  wait_timed_out: 'resource-error',
  payload_too_large: 'resource-error',
  step_limit_exceeded: 'run-failure',
  run_deadline_exceeded: 'run-failure',
  execution_error: 'unknown-error',
  expression_evaluation_failed: 'unknown-error',
} satisfies Readonly<Record<string, WorkflowErrorType>>);

export type EngineErrorCode = keyof typeof ENGINE_ERROR_TYPES;

const ERROR_TYPES: Readonly<Record<string, WorkflowErrorType>> = Object.freeze({
  ...WORKFLOW_ACTION_ERROR_TYPES,
  ...ENGINE_ERROR_TYPES,
});

/** C120.2: the public type of an engine or action code; any other is an unknown error. */
export function workflowErrorTypeOf(code: string): WorkflowErrorType {
  return (Object.hasOwn(ERROR_TYPES, code) ? ERROR_TYPES[code] : undefined) ?? 'unknown-error';
}

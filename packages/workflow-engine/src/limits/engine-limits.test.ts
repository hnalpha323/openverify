/** C117.7, C114.3, C115.2, C120.2: every limit is a constant with its basis, and every code has a type. */
import { WORKFLOW_DEFINITION_LIMITS, WORKFLOW_ERROR_TYPES } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  ENGINE_ERROR_TYPES,
  EXPRESSION_LIMITS,
  TEMPLATE_LIMITS,
  WORKFLOW_LIMIT_CODES,
  WORKFLOW_RUN_LIMITS,
  workflowErrorTypeOf,
  type StatedLimit,
} from './engine-limits.js';

const KIB = 1024;

const read = (limits: Readonly<Record<string, StatedLimit>>, name: string) => limits[name];

describe('the run limits (C117.7)', () => {
  it.each([
    ['loop-items', 100, 'public'],
    ['step-executions', 5_000, 'provisional'],
    ['run-duration-seconds', 7_776_000, 'provisional'],
    ['run-depth', 5, 'provisional'],
    ['event-fanout', 50, 'provisional'],
    ['subjects', 1_000, 'provisional'],
    ['trigger-depth', 8, 'provisional'],
    ['trigger-snapshot-bytes', 256 * KIB, 'provisional'],
    ['step-output-bytes', 64 * KIB, 'provisional'],
    ['variables-bytes', KIB * KIB, 'provisional'],
    ['step-claims', 10, 'provisional'],
    ['redactions-per-run', 100, 'provisional'],
  ])('%s is %d on a %s basis', (name, value, basis) => {
    expect(read(WORKFLOW_RUN_LIMITS, name)).toMatchObject({ value, basis });
  });

  it('shares the wait cap with the definition schema', () => {
    expect(WORKFLOW_RUN_LIMITS['wait-seconds']).toBe(WORKFLOW_DEFINITION_LIMITS['wait-seconds']);
  });

  it('says where each constant comes from', () => {
    for (const limit of [
      ...Object.values(WORKFLOW_RUN_LIMITS),
      ...Object.values(EXPRESSION_LIMITS),
      ...Object.values(TEMPLATE_LIMITS),
    ]) {
      expect(limit.source.length).toBeGreaterThan(0);
    }
  });

  it('names the code each limit is enforced with', () => {
    expect(WORKFLOW_LIMIT_CODES).toMatchObject({
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
    });
  });
});

describe('the expression and template limits (C114.3, C115.2)', () => {
  it.each([
    ['condition-bytes', 16 * KIB],
    ['depth', 32],
    ['nodes', 1_000],
    ['evaluations', 10_000],
    ['array-elements', 1_000],
    ['string-characters', 10_000],
  ])('an expression holds %s to %d', (name, value) => {
    expect(read(EXPRESSION_LIMITS, name)).toMatchObject({ value, basis: 'provisional' });
  });

  it.each([
    ['template-bytes', 32 * KIB],
    ['rendered-bytes', KIB * KIB],
  ])('a template holds %s to %d', (name, value) => {
    expect(read(TEMPLATE_LIMITS, name)).toMatchObject({ value, basis: 'provisional' });
  });
});

describe('the error types (C120.2)', () => {
  it('maps every engine code to one of the six public types', () => {
    expect(Object.keys(ENGINE_ERROR_TYPES).length).toBeGreaterThan(0);
    for (const type of Object.values(ENGINE_ERROR_TYPES)) {
      expect(WORKFLOW_ERROR_TYPES).toContain(type);
    }
  });

  it.each([
    ['run_deadline_exceeded', 'run-failure'],
    ['step_limit_exceeded', 'run-failure'],
    ['expression_limit_exceeded', 'configuration-error'],
    ['template_variable_missing', 'missing-input-error'],
    ['variable_unset', 'missing-input-error'],
    ['condition_input_null', 'missing-input-error'],
    ['loop_limit_exceeded', 'invalid-input-error'],
    ['wait_timed_out', 'resource-error'],
    ['payload_too_large', 'resource-error'],
    ['execution_error', 'unknown-error'],
  ])('%s is a %s', (code, type) => {
    expect(workflowErrorTypeOf(code)).toBe(type);
  });

  it.each([
    ['subject_redacted', 'resource-error'],
    ['publisher_revoked', 'configuration-error'],
    ['report_errored', 'resource-error'],
    ['timeout', 'unknown-error'],
    ['type_mismatch', 'configuration-error'],
    ['object_not_found', 'resource-error'],
    ['verification_step_missing', 'resource-error'],
    ['report_input_missing', 'missing-input-error'],
    ['action_input_invalid', 'invalid-input-error'],
    ['list_kind_mismatch', 'invalid-input-error'],
    ['tag_limit_exceeded', 'resource-error'],
    ['redaction_limit_exceeded', 'configuration-error'],
    ['biometric_list_not_bulk', 'configuration-error'],
    ['action_refused', 'resource-error'],
    ['workflow_not_running', 'configuration-error'],
    ['workflow_trigger_mismatch', 'configuration-error'],
    ['schedule_base_invalid', 'invalid-input-error'],
    ['unknown_effect', 'unknown-error'],
    ['sandbox_sink_unavailable', 'resource-error'],
    ['smtp_unavailable', 'resource-error'],
    ['smtp_rejected', 'resource-error'],
    ['slack_rate_limited', 'resource-error'],
    ['slack_unreachable', 'resource-error'],
    ['slack_rejected', 'resource-error'],
    ['twilio_rejected', 'resource-error'],
    ['graph_index_failed', 'resource-error'],
  ])('reads an action code %s as a %s', (code, type) => {
    expect(workflowErrorTypeOf(code)).toBe(type);
  });

  it.each(['constructor', 'toString', 'no_such_code'])(
    'reads an unknown code %s as an unknown error, never off the prototype',
    (code) => {
      expect(workflowErrorTypeOf(code)).toBe('unknown-error');
    },
  );
});

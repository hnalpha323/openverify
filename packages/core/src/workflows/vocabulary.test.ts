import { describe, expect, it } from 'vitest';
import {
  ACTION_ADVERSE,
  ACTION_DELIVERIES,
  ACTION_KINDS,
  ACTION_STAGES,
  WORKFLOW_ACKNOWLEDGEMENT_KINDS,
  WORKFLOW_DEFINITION_LIMITS,
  WORKFLOW_DELIVERY_STATUSES,
  WORKFLOW_DEPLOYMENT_STATUSES,
  WORKFLOW_EFFECT_STATUSES,
  WORKFLOW_ERROR_TYPES,
  WORKFLOW_KINDS,
  WORKFLOW_NODE_TYPES,
  WORKFLOW_OBJECT_TYPES,
  WORKFLOW_PREDICATE_ON_NULL,
  WORKFLOW_ROLLOUT_LABELS,
  WORKFLOW_RUN_CREATOR_TYPES,
  WORKFLOW_RUN_STATUSES,
  WORKFLOW_RUN_WAITING_ON,
  WORKFLOW_STATUSES,
  WORKFLOW_STEP_STATUSES,
  WORKFLOW_TRIGGER_LIMITS,
  WORKFLOW_TRIGGER_ON_NULL,
  WORKFLOW_TRIGGER_TYPES,
  WORKFLOW_VERSION_STATUSES,
  WORKFLOW_WAIT_ON_NULL,
  WORKFLOW_WHILE_ON_NULL,
  actionAdverseSchema,
  actionServesTrigger,
  isWorkflowTriggerType,
  workflowRunStatusSchema,
  workflowTriggerTypeSchema,
} from '../index.js';

describe('the workflow vocabularies (C112, C113, C117, C120, C122)', () => {
  it('holds the public statuses and our additions', () => {
    expect(WORKFLOW_STATUSES).toEqual(['paused', 'running', 'archived']);
    expect(WORKFLOW_KINDS).toEqual(['workflow', 'module']);
    expect(WORKFLOW_VERSION_STATUSES).toEqual(['draft', 'published', 'archived']);
    expect(WORKFLOW_ROLLOUT_LABELS).toEqual(['treatment', 'control']);
    expect(WORKFLOW_DEPLOYMENT_STATUSES).toEqual(['active', 'inactive']);
    expect(WORKFLOW_RUN_STATUSES).toEqual(['in_progress', 'completed', 'errored', 'canceled']);
    expect(WORKFLOW_RUN_WAITING_ON).toEqual([
      'event',
      'time',
      'earlier-run',
      'child-run',
      'admission',
    ]);
  });

  it('holds the nine trigger types, trigger-flow last, and the object types a recurring trigger walks', () => {
    expect(WORKFLOW_TRIGGER_TYPES).toHaveLength(9);
    // C152.2 (Phase 9): a ninth type, ours, started only by a flow's run_workflow action.
    expect(WORKFLOW_TRIGGER_TYPES.at(-1)).toBe('trigger-flow');
    expect(workflowTriggerTypeSchema.safeParse('trigger-verification').success).toBe(true);
    expect(workflowTriggerTypeSchema.safeParse('trigger-import').success).toBe(false);
    expect(WORKFLOW_OBJECT_TYPES).toEqual(['account', 'case', 'inquiry', 'report', 'transaction']);
  });

  it('holds every node type of C113.2', () => {
    expect(WORKFLOW_NODE_TYPES).toEqual([
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
    ]);
  });

  it('gives each condition position its own answers to a null, with no default (C114.6)', () => {
    expect(WORKFLOW_TRIGGER_ON_NULL).toEqual(['error', 'admit', 'skip']);
    expect(WORKFLOW_WAIT_ON_NULL).toEqual(['error', 'keep-waiting', 'accept']);
    expect(WORKFLOW_WHILE_ON_NULL).toEqual(['error', 'stop']);
    expect(WORKFLOW_PREDICATE_ON_NULL).toEqual(['error', 'include', 'exclude']);
  });

  it('holds the step, effect and delivery statuses the tables pin (C117.2)', () => {
    expect(WORKFLOW_STEP_STATUSES).toEqual([
      'pending',
      'ready',
      'running',
      'waiting',
      'succeeded',
      'failed',
      'skipped',
      'canceled',
      'timed_out',
    ]);
    expect(WORKFLOW_EFFECT_STATUSES).toEqual(['claimed', 'done', 'unknown']);
    expect(WORKFLOW_DELIVERY_STATUSES).toEqual([
      'pending',
      'run_created',
      'filtered',
      'refused',
      'expired',
    ]);
  });

  it('holds the public creators and ours, the case action among them (C120.1, C140.1)', () => {
    expect(WORKFLOW_RUN_CREATOR_TYPES).toEqual([
      'user',
      'api-key',
      'event',
      'scheduled-run',
      'workflow-run',
      'account-action',
      'case-action',
      // C152.2 (Phase 9): a flow's run_workflow action, named by the inquiry's id.
      'inquiry-flow',
    ]);
  });

  it('serves trigger-flow only through an action that lists it (C152.2, Stage 1a amendment 3)', () => {
    for (const trigger of WORKFLOW_TRIGGER_TYPES) {
      expect(actionServesTrigger(null, trigger), trigger).toBe(
        (trigger as string) !== 'trigger-flow',
      );
      expect(actionServesTrigger([trigger], trigger), trigger).toBe(true);
    }
    expect(actionServesTrigger(['trigger-api'], 'trigger-event')).toBe(false);
    expect(isWorkflowTriggerType('trigger-flow')).toBe(true);
    expect(isWorkflowTriggerType('trigger-import')).toBe(false);
    expect(isWorkflowTriggerType(9)).toBe(false);
  });

  it('names the six public error types (C120.2)', () => {
    expect(WORKFLOW_ERROR_TYPES).toEqual([
      'missing-input-error',
      'invalid-input-error',
      'configuration-error',
      'resource-error',
      'unknown-error',
      'run-failure',
    ]);
  });

  it('names what a publish can acknowledge (C116.4)', () => {
    expect(WORKFLOW_ACKNOWLEDGEMENT_KINDS).toEqual([
      'egress',
      'irreversible',
      'heuristic',
      'override-failed',
      'unconfirmed',
    ]);
  });

  it('holds the registry vocabularies (C122.1)', () => {
    expect(ACTION_KINDS).toEqual(['internal', 'egress', 'compute', 'control']);
    expect(ACTION_DELIVERIES).toEqual([
      'exactly-once',
      'at-least-once',
      'at-most-once',
      'pure',
      'control',
    ]);
    expect(ACTION_ADVERSE).toEqual(['always', 'by-config', 'never']);
    expect(ACTION_STAGES).toEqual(['ga', 'beta']);
    expect(actionAdverseSchema.safeParse('sometimes').success).toBe(false);
  });

  it('refuses a status outside the list', () => {
    expect(workflowRunStatusSchema.safeParse('waiting').success).toBe(false);
    expect(workflowRunStatusSchema.safeParse('canceled').success).toBe(true);
  });

  it('states every limit with its basis and source (C113.4, C117.7)', () => {
    const limits: Record<string, { value: number; basis: string; source: string }> = {
      ...WORKFLOW_DEFINITION_LIMITS,
      ...WORKFLOW_TRIGGER_LIMITS,
    };
    for (const [name, limit] of Object.entries(limits)) {
      expect(limit.value, name).toBeGreaterThan(0);
      expect(['public', 'provisional'], name).toContain(limit.basis);
      expect(limit.source.length, name).toBeGreaterThan(0);
    }
    expect(WORKFLOW_DEFINITION_LIMITS.nodes.value).toBe(200);
    expect(WORKFLOW_DEFINITION_LIMITS.edges.value).toBe(400);
    expect(WORKFLOW_DEFINITION_LIMITS['definition-bytes'].value).toBe(262_144);
    expect(WORKFLOW_DEFINITION_LIMITS['wait-seconds']).toMatchObject({
      value: 2_592_000,
      basis: 'public',
    });
    expect(WORKFLOW_DEFINITION_LIMITS['loop-iterations']).toMatchObject({
      value: 100,
      basis: 'public',
    });
    expect(WORKFLOW_TRIGGER_LIMITS['file-bytes'].value).toBe(10_485_760);
    expect(WORKFLOW_TRIGGER_LIMITS['body-bytes'].value).toBe(14_680_064);
  });
});

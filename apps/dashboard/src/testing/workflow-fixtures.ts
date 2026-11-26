/**
 * Synthetic fixtures of `dashboard-workflows` (C128, C141; Workflow 8C): decision records,
 * workflows, versions, runs, secrets and account actions, each parsed by its contract so a fixture
 * can never drift from what the API serves. Every id, address and value is synthetic.
 */
import {
  workflowActionResourceSchema,
  type WorkflowActionResource,
  accountAvailableActionListDocumentSchema,
  decisionResourceSchema,
  workflowRecipeResourceSchema,
  workflowResourceSchema,
  workflowRunResourceSchema,
  workflowRunStepResourceSchema,
  workflowVersionResourceSchema,
  workflowSecretResourceSchema,
  workflowTriggerDeliveryResourceSchema,
  type WorkflowTriggerDeliveryResource,
  type WorkflowSecretResource,
  type WorkflowRecipeResource,
  type WorkflowResource,
  type WorkflowRunResource,
  type WorkflowRunStepResource,
  type WorkflowVersionResource,
  type AccountAvailableActionListDocument,
  type DecisionResource,
} from '@openverify/contracts';
import { LIFECYCLE_IDS } from './lifecycle-fixtures';

/** A fixed instant, and the ones after it, for records that order by time. */
export const W0 = '2026-11-01T09:00:00.000Z';
export const W1 = '2026-11-01T09:05:00.000Z';
export const W2 = '2026-11-01T09:10:00.000Z';

export const WORKFLOW_IDS = {
  inquiry: LIFECYCLE_IDS.inquiry,
  account: LIFECYCLE_IDS.account,
  workflow: 'wfl_01MB0000000000000000000001',
  version: 'wfv_01MB0000000000000000000001',
  previousVersion: 'wfv_01MB0000000000000000000002',
  draft: 'wfv_01MB0000000000000000000003',
  run: 'wfr_01MB0000000000000000000001',
  otherRun: 'wfr_01MB0000000000000000000002',
  decline: 'idec_01MB0000000000000000000001',
  reopen: 'idec_01MB0000000000000000000002',
  approve: 'idec_01MB0000000000000000000003',
  user: 'usr_01MB0000000000000000000001',
  apiKey: 'key_01MB0000000000000000000001',
  event: 'evt_01MB0000000000000000000001',
  report: 'rep_01MB0000000000000000000001',
  match: 'rpm_01MB0000000000000000000001',
  caseTemplate: 'ctmpl_01MB0000000000000000000001',
  secret: 'wsec_01MB0000000000000000000001',
  accountAction: 'accac_01MB0000000000000000000001',
} as const;

type DecisionAttributes = DecisionResource['attributes'];

/** A decision record on the synthetic inquiry; a run's decline unless `attributes` says otherwise. */
export function decision(
  attributes: Partial<DecisionAttributes> = {},
  id: string = WORKFLOW_IDS.decline,
  subjectId: string = WORKFLOW_IDS.inquiry,
): DecisionResource {
  return decisionResourceSchema.parse({
    type: 'decision',
    id,
    attributes: {
      kind: 'decline',
      actor: { type: 'workflow-run', id: WORKFLOW_IDS.run },
      run: {
        'workflow-id': WORKFLOW_IDS.workflow,
        'workflow-version-id': WORKFLOW_IDS.version,
        'node-id': 'decline_inquiry',
        routes: [{ 'node-id': 'route_on_resolution', 'route-key': 'declined' }],
        'condition-sha256': ['a'.repeat(64)],
        'code-sha256': [],
      },
      // C150.7 (Workflow 9A): only a flow failure has a flow.
      flow: null,
      'solely-automated': false,
      'human-step': {
        kind: 'case-resolution',
        'actor-id': WORKFLOW_IDS.user,
        'event-id': WORKFLOW_IDS.event,
        'resolved-via': 'single',
        'node-id': 'wait_for_case',
      },
      evidence: [
        {
          kind: 'report-match',
          id: WORKFLOW_IDS.match,
          name: null,
          status: 'matched',
          tier: 'H',
          stage: 'beta',
          confidence: 0.82,
        },
        {
          kind: 'check',
          id: null,
          name: 'id_barcode_detected',
          status: 'passed',
          tier: 'R',
          stage: 'ga',
          confidence: null,
        },
      ],
      'pending-evidence': [{ kind: 'report', id: WORKFLOW_IDS.report, name: null }],
      'decision-basis': 'contract',
      'contest-route': { url: 'https://help.example.com/contest', contact: 'appeals@example.com' },
      'biometric-basis': null,
      comment: 'Synthetic reviewer note',
      'needs-review': false,
      'human-review-pending': false,
      'error-code': null,
      'test-run-id': null,
      'created-at': W0,
      ...attributes,
    },
    relationships: { subject: { data: { type: 'inquiry', id: subjectId } } },
  });
}

/** A user's reopen of the decline, human review still pending (C128.6). */
export function reopenDecision(attributes: Partial<DecisionAttributes> = {}): DecisionResource {
  return decision(
    {
      kind: 'reopen',
      actor: { type: 'user', id: WORKFLOW_IDS.user },
      run: null,
      'solely-automated': null,
      'human-step': null,
      evidence: [],
      'pending-evidence': [],
      'decision-basis': null,
      'contest-route': null,
      comment: 'Synthetic reopen comment',
      'human-review-pending': true,
      'created-at': W1,
      ...attributes,
    },
    WORKFLOW_IDS.reopen,
  );
}

export function page<Resource>(data: readonly Resource[], next: string | null = null) {
  return { data, links: { next } };
}

type AvailableAction = AccountAvailableActionListDocument['data'][number];

/** One account action the viewer may run, with its parameter form (C118.7). */
export function availableAccountAction(
  form: AvailableAction['attributes']['form'] = [
    { name: 'reason', type: 'string', required: true, 'prefilled-value': null },
    { name: 'priority', type: 'integer', required: false, 'prefilled-value': 3 },
    { name: 'email', type: 'string', required: false, 'prefilled-value': 'synthetic@example.com' },
  ],
  label = 'Re-screen this account',
  id: string = WORKFLOW_IDS.accountAction,
): AvailableAction {
  const [action] = accountAvailableActionListDocumentSchema.parse({
    data: [
      {
        type: 'account-action',
        id,
        attributes: { label, form },
        relationships: { workflow: { data: { type: 'workflow', id: WORKFLOW_IDS.workflow } } },
      },
    ],
    links: { next: null },
  }).data;
  if (action === undefined) {
    throw new Error('the fixture holds one action');
  }
  return action;
}

/** A running workflow with a published version and no draft. */
export function workflow(
  attributes: Partial<WorkflowResource['attributes']> = {},
  id: string = WORKFLOW_IDS.workflow,
): WorkflowResource {
  return workflowResourceSchema.parse({
    type: 'workflow',
    id,
    attributes: {
      name: 'Review on report match',
      description: 'Synthetic workflow',
      status: 'running',
      kind: 'workflow',
      'paused-reason': null,
      'created-at': W0,
      'updated-at': W1,
      'archived-at': null,
      ...attributes,
    },
    relationships: {
      'latest-published-version': { data: { type: 'workflow-version', id: WORKFLOW_IDS.version } },
      'active-deployment': { data: null },
      'draft-version': { data: null },
    },
  });
}

/** A published version of the synthetic workflow, with no definition (as an event serves it). */
export function workflowVersion(
  attributes: Partial<WorkflowVersionResource['attributes']> = {},
  id: string = WORKFLOW_IDS.version,
): WorkflowVersionResource {
  return workflowVersionResourceSchema.parse({
    type: 'workflow-version',
    id,
    attributes: {
      status: 'published',
      'trigger-type': 'trigger-event',
      live: true,
      'rollout-label': null,
      'rollout-percentage': null,
      'last-updater': WORKFLOW_IDS.user,
      inputs: [],
      outputs: [],
      description: 'First version',
      'published-at': W1,
      'created-at': W0,
      'updated-at': W1,
      'version-number': 1,
      'schema-version': 1,
      'lock-version': 1,
      definition: null,
      'definition-sha256': 'b'.repeat(64),
      grant: null,
      egress: [],
      acknowledgements: [],
      warnings: [],
      'promoted-from': null,
      ...attributes,
    },
    relationships: { workflow: { data: { type: 'workflow', id: WORKFLOW_IDS.workflow } } },
  });
}

const NO_OUTCOMES = {
  succeeded: 3,
  'failed-continued': 0,
  'timed-out': 0,
  'unknown-effect': 0,
  skipped: 0,
};

/** A completed run of the synthetic workflow, its values as a viewer with pii:view reads them. */
export function workflowRun(
  attributes: Partial<WorkflowRunResource['attributes']> = {},
  id: string = WORKFLOW_IDS.run,
): WorkflowRunResource {
  return workflowRunResourceSchema.parse({
    type: 'workflow-run',
    id,
    attributes: {
      status: 'completed',
      'created-at': W0,
      'completed-at': W1,
      'updated-at': W1,
      'waiting-on': null,
      'rollout-label': null,
      'trigger-type': 'trigger-event',
      error: null,
      'errored-step': null,
      'subject-ids': [WORKFLOW_IDS.inquiry],
      'step-outcomes': NO_OUTCOMES,
      'test-run-id': null,
      'overridden-steps': [],
      'redacted-at': null,
      'values-purged-at': null,
      inputs: {},
      variables: { risk: 2 },
      outputs: { decision: 'Synthetic output value' },
      'trigger-snapshot': { status: 'completed' },
      ...attributes,
    },
    relationships: {
      workflow: { data: { type: 'workflow', id: WORKFLOW_IDS.workflow } },
      'workflow-version': { data: { type: 'workflow-version', id: WORKFLOW_IDS.version } },
      creator: { data: { type: 'event', id: WORKFLOW_IDS.event } },
      'rerun-of': { data: null },
    },
    meta: { 'processing-time-seconds': 300 },
  });
}

/** One step of the synthetic run. */
export function workflowRunStep(
  attributes: Partial<WorkflowRunStepResource['attributes']> = {},
  id = 'wfst_01MB0000000000000000000001',
): WorkflowRunStepResource {
  return workflowRunStepResourceSchema.parse({
    type: 'workflow-run-step',
    id,
    attributes: {
      'node-id': 'send_slack',
      'iteration-path': '',
      'node-type': 'action',
      'action-key': 'send_slack_message',
      'action-version': 1,
      status: 'succeeded',
      attempt: 1,
      'due-at': null,
      'started-at': W0,
      'completed-at': W1,
      'error-type': null,
      'error-code': null,
      'effect-status': 'done',
      simulated: false,
      overridden: false,
      input: { text: 'Synthetic step input' },
      output: { delivery: 'recorded' },
      console: null,
      ...attributes,
    },
  });
}

/** The two recipes since Workflow 8B (C140.5), each naming what it still needs. */
export function recipes(): WorkflowRecipeResource[] {
  return [
    workflowRecipeResourceSchema.parse({
      type: 'workflow-recipe',
      id: 'rescreen-on-account-field-change',
      attributes: {
        name: 'Re-screen on account field change',
        description: 'Runs a report again when a screened field changes.',
        'trigger-type': 'trigger-event',
        'needs-configuration': ['report-template-id'],
      },
    }),
    workflowRecipeResourceSchema.parse({
      type: 'workflow-recipe',
      id: 'review-on-report-match',
      attributes: {
        name: 'Review on report match',
        description: 'Marks the inquiry for review and opens a case.',
        'trigger-type': 'trigger-event',
        'needs-configuration': ['case-template-id', 'decision-basis', 'contest-route'],
      },
    }),
  ];
}

/** The sandbox environment of the synthetic session (`testing/api-mock.ts`). */
export const SECRET_ENVIRONMENT_ID = 'env_01J9ZK3M5Q7R8S9T0V1W2X3Y51';

/** A workflow secret (C125) with a value in the session's environment unless `value` is `null`. */
export function workflowSecret(
  attributes: Partial<WorkflowSecretResource['attributes']> = {},
  id: string = WORKFLOW_IDS.secret,
): WorkflowSecretResource {
  return workflowSecretResourceSchema.parse({
    type: 'workflow-secret',
    id,
    attributes: {
      key: 'slack_token',
      description: 'Synthetic token',
      'allowed-hosts': ['hooks.example.com'],
      'allowed-placements': { headers: ['authorization'], 'body-pointers': [] },
      'created-by': WORKFLOW_IDS.user,
      'environment-value': {
        'environment-id': SECRET_ENVIRONMENT_ID,
        last4: 'k9Zq',
        version: 2,
        'rotated-by': WORKFLOW_IDS.user,
        'rotated-at': W1,
        'previous-expires-at': null,
      },
      'created-at': W0,
      'updated-at': W1,
      ...attributes,
    },
  });
}

/** A small valid definition: the API trigger, one Slack step and the output (C113.1). */
export function workflowDefinition(): Record<string, unknown> {
  return {
    'schema-version': 1,
    trigger: { type: 'trigger-api', config: {} },
    inputs: [],
    variables: [],
    steps: [
      {
        id: 'send_slack',
        name: 'Tell the team',
        type: 'action',
        'action-key': 'send_slack_message',
        'action-version': 1,
        config: { text: 'Synthetic message' },
      },
      { id: 'output', name: 'Output', type: 'output', mappings: {} },
    ],
    edges: [
      { id: 'edge_0', from: 'trigger', 'from-port': 'next', to: 'send_slack' },
      { id: 'edge_1', from: 'send_slack', 'from-port': 'next', to: 'output' },
    ],
    outputs: [],
    layout: {},
  };
}

/** The synthetic workflow's draft, holding `workflowDefinition()` at lock version 3. */
export function workflowDraft(
  attributes: Partial<WorkflowVersionResource['attributes']> = {},
): WorkflowVersionResource {
  return workflowVersion(
    {
      status: 'draft',
      live: false,
      'published-at': null,
      description: null,
      'version-number': 2,
      'lock-version': 3,
      definition: workflowDefinition() as WorkflowVersionResource['attributes']['definition'],
      ...attributes,
    },
    WORKFLOW_IDS.draft,
  );
}

/** A trigger delivery of the synthetic workflow (C118.1), refused unless `attributes` says otherwise. */
export function triggerDelivery(
  attributes: Partial<WorkflowTriggerDeliveryResource['attributes']> = {},
  id = 'wftd_01MB0000000000000000000001',
  runId: string | null = null,
): WorkflowTriggerDeliveryResource {
  return workflowTriggerDeliveryResourceSchema.parse({
    type: 'workflow-trigger-delivery',
    id,
    attributes: {
      status: 'refused',
      'reason-code': 'subject_rate_limited',
      'event-name': 'inquiry.completed',
      'not-before': null,
      'created-at': W0,
      'updated-at': W1,
      ...attributes,
    },
    relationships: {
      workflow: { data: { type: 'workflow', id: WORKFLOW_IDS.workflow } },
      event: { data: { type: 'event', id: WORKFLOW_IDS.event } },
      'workflow-run': { data: runId === null ? null : { type: 'workflow-run', id: runId } },
    },
  });
}

/** One row of the action catalogue (C122.4), available unless `attributes` says otherwise. */
export function workflowAction(
  key: string,
  attributes: Partial<WorkflowActionResource['attributes']> = {},
): WorkflowActionResource {
  return workflowActionResourceSchema.parse({
    type: 'workflow-action',
    id: `${key}@1`,
    attributes: {
      key,
      version: 1,
      kind: 'internal',
      stage: 'ga',
      delivery: 'exactly-once',
      adverse: 'never',
      'config-schema': {},
      'output-schema': {},
      grant: { scopes: [], pii: false },
      'grant-depends-on-config': false,
      emits: [],
      triggers: null,
      available: true,
      reason: null,
      ...attributes,
    },
  });
}

/** A test-run definition: an Evaluate Code step, a Slack step and a decline (C120.7). */
export function testRunDefinition(): Record<string, unknown> {
  const step = (id: string, name: string, key: string, config: Record<string, unknown>) => ({
    id,
    name,
    type: 'action',
    'action-key': key,
    'action-version': 1,
    config,
  });
  return {
    'schema-version': 1,
    trigger: { type: 'trigger-event', config: { events: ['inquiry.completed'] } },
    inputs: [],
    variables: [],
    steps: [
      step('score', 'Score the inquiry', 'evaluate_code', {
        source: 'export default function () { return 1; }',
        properties: {},
        'return-type': 'number',
      }),
      step('send_slack', 'Tell the team', 'send_slack_message', { text: 'Synthetic message' }),
      step('decline', 'Decline the inquiry', 'decline_inquiry', {
        'inquiry-id': '{{ trigger.id }}',
      }),
      { id: 'output', name: 'Output', type: 'output', mappings: {} },
    ],
    edges: [
      { id: 'edge_0', from: 'trigger', 'from-port': 'next', to: 'score' },
      { id: 'edge_1', from: 'score', 'from-port': 'next', to: 'send_slack' },
      { id: 'edge_2', from: 'send_slack', 'from-port': 'next', to: 'decline' },
      { id: 'edge_3', from: 'decline', 'from-port': 'next', to: 'output' },
    ],
    outputs: [],
    layout: {},
  };
}

/** The catalogue rows `testRunDefinition()` uses. */
export function testRunCatalogue(): WorkflowActionResource[] {
  return [
    workflowAction('evaluate_code', { kind: 'compute', delivery: 'pure' }),
    workflowAction('send_slack_message', { kind: 'egress', delivery: 'at-most-once' }),
    workflowAction('decline_inquiry', { adverse: 'always' }),
  ];
}

/** A recorded sandbox email (C126.4) of `runId`, with synthetic text. */
export function sandboxEmail(runId: string, stepId = 'send_email', subject = 'Synthetic subject') {
  return {
    'message-ref': `ref-${runId}-${stepId}`,
    'workflow-run-id': runId,
    'step-id': stepId,
    'recorded-at': W1,
    'message-subject': subject,
    'message-text': 'Synthetic message body',
    'message-html': null,
  };
}

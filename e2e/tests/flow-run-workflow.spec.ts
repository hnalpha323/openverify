/**
 * C178.4, C152.2 (Workflow 9A): a flow's `run_workflow` step on the full stack, whose workflow's
 * output picks the route. Budget: 90 s.
 *
 * The workflow is a `trigger-flow` workflow with one non-PII output, `score` (90), published and
 * running. The template's flow: consent, a government ID (a version needs a verification step),
 * `score_run` (run_workflow, pinned to the published version, 60 s timeout), then a branch whose
 * `high` route reads `workflows.score_run.outputs.score > 50` (`onNull: else`). The run is started
 * by the flow with creator `inquiry-flow` and the inquiry's id (C120.1 amended); the session
 * waits while it runs, the engine advances once the run completes, and the `high` route takes
 * the inquiry to its completion. Every value is synthetic.
 */
import { randomUUID } from 'node:crypto';
import { defaultInquiryTemplateAttributes } from '@openverify/contracts';
import { expect, test } from '@playwright/test';
import { FIXTURES } from '../src/paths.js';
import { readStackInfo } from '../src/stack-info.js';
import {
  consentStep,
  pathOf,
  pollSession,
  publishV2,
  settledInquiry,
  startV2Inquiry,
  stepRecord,
  v2Flow,
} from './support/flow-v2.js';
import { flowApi, settledFlowVerification, submitGovernmentId } from './support/platform.js';
import { adminClient, runningWorkflow } from './support/workflows.js';

const edge = (id: string, from: string, port: string, to: string) => ({ id, from, port, to });

/** A `trigger-flow` workflow whose run outputs `score: 90`, and nothing else. */
const SCORE_DEFINITION = {
  'schema-version': 1,
  trigger: { type: 'trigger-flow', config: {} },
  inputs: [],
  variables: [],
  steps: [{ id: 'output', type: 'output', name: 'Output', mappings: { score: 90 } }],
  edges: [{ id: 'edge_0', from: 'trigger', 'from-port': 'next', to: 'output' }],
  outputs: [{ name: 'score', pii: false }],
  layout: {},
};

test('a run_workflow step waits for its run, and the run’s output picks the route (C152.2)', async () => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const admin = await adminClient(stack);
  const run = randomUUID().slice(0, 8);
  const workflowId = await runningWorkflow(
    admin,
    `e2e flow score ${run}`,
    SCORE_DEFINITION as never,
  );
  const { data: workflow } = await admin.workflows.retrieve(workflowId);
  const versionId = workflow.relationships['latest-published-version'].data?.id ?? '';
  expect(versionId).toMatch(/^wfv_/);

  const defaults = defaultInquiryTemplateAttributes();
  const governmentId = defaults.flow.steps.find((step) => step.type === 'government_id');
  const template = await publishV2(
    stack,
    admin,
    `e2e run workflow ${run}`,
    {
      metadata: { specVersion: 2, id: `e2e-run-${run}`, version: 1, name: 'Run workflow' },
      entry: 'consent',
      steps: [
        consentStep(),
        { ...governmentId, id: 'id_card', maxAttempts: 1, captureMethods: ['upload'] },
        {
          id: 'score_run',
          type: 'action',
          action: { kind: 'run_workflow', workflowId, version: versionId, timeoutSeconds: 60 },
        },
        {
          id: 'score_route',
          type: 'branch',
          routes: [
            {
              key: 'high',
              label: 'Score above 50',
              condition: { '>': [{ var: 'workflows.score_run.outputs.score' }, 50] },
              onNull: 'else',
            },
          ],
        },
        { id: 'done_high', type: 'completion' },
        { id: 'done_other', type: 'completion' },
      ],
      edges: [
        edge('e1', 'consent', 'next', 'id_card'),
        edge('e2', 'id_card', 'next', 'score_run'),
        edge('e3', 'score_run', 'next', 'score_route'),
        edge('e4', 'score_run', 'error', 'done_other'),
        edge('e5', 'score_route', 'route:high', 'done_high'),
        edge('e6', 'score_route', 'else', 'done_other'),
      ],
    },
    {
      'verification-config': { 'government-id': defaults['verification-config']['government-id'] },
    },
  );

  const started = await startV2Inquiry(stack, template.templateId, `e2e-run-${randomUUID()}`);
  const flow = v2Flow(stack, started.sessionToken);
  await flow.consent();
  const idApi = flowApi(stack.apiUrl, started.sessionToken);
  const verificationId = await submitGovernmentId(idApi, {
    front: FIXTURES.idFront,
    back: FIXTURES.idBack,
  });
  expect((await settledFlowVerification(idApi, verificationId, 60_000)).attributes.status).toBe(
    'passed',
  );
  // The session waits on the run (C151.5) and its poll settles it once the run completed (C152.2).
  const ended = await pollSession(flow, (session) => session.position?.state === 'ended', 60_000);
  expect(ended.position?.['step-id']).toBe('done_high');

  await settledInquiry(stack, started.inquiryId, ['completed']);
  expect(pathOf(await stepRecord(stack, started.inquiryId))).toEqual([
    ['consent', 'next'],
    ['id_card', 'next'],
    ['score_run', 'next'],
    ['score_route', 'route:high'],
    ['done_high', null],
  ]);
  // The flow started the run as the inquiry's flow (C120.1 amended), on the pinned version.
  const { data: runs } = await admin.workflowRuns.list({ filter: { 'workflow-id': workflowId } });
  expect(runs).toHaveLength(1);
  expect(runs[0]?.attributes.status).toBe('completed');
  expect(runs[0]?.relationships.creator.data).toEqual({
    type: 'inquiry-flow',
    id: started.inquiryId,
  });
});

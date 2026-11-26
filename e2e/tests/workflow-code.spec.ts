/**
 * C123, C120.2, C146.3 (Workflow 8A): an Evaluate Code step that never returns. Budget: 90 s.
 *
 * The guest is stopped at its limit and the run ends `errored`, never with a value: the run names the
 * step and a fixed error, and the guest's source reaches no event or error text.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { recordingClient } from './support/platform.js';
import {
  actionStep,
  adminClient,
  chainDefinition,
  runningWorkflow,
  waitForRunEnd,
} from './support/workflows.js';

test('an Evaluate Code step that times out errors the run with its step named (C123.6, C146.3)', async () => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const admin = await adminClient(stack);
  const workflowId = await runningWorkflow(
    admin,
    `e2e-code-${randomUUID().slice(0, 8)}`,
    chainDefinition({ type: 'trigger-api', config: {} }, [
      actionStep('spin', 'evaluate_code', {
        source: 'export default function () { for (;;) {} }',
        properties: {},
        'return-type': 'number',
        limits: { 'time-ms': 100 },
      }),
    ]),
  );

  const { data: started } = await client.workflows.trigger(workflowId, {});
  const run = await waitForRunEnd(client, started.id);

  expect(run.attributes).toMatchObject({
    status: 'errored',
    error: { type: 'unknown-error' },
    'errored-step': { key: 'spin', type: 'action', 'action-key': 'evaluate_code' },
  });
  const { data: steps } = await client.workflowRuns.steps(started.id);
  expect(
    steps.find(({ attributes }) => attributes['node-id'] === 'spin')?.attributes,
  ).toMatchObject({ status: 'failed', 'error-code': 'timeout' });
});

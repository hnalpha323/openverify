/**
 * C126.3, C126.4, C146.3 (Workflow 8A): a Slack step in a sandbox environment. Budget: 90 s.
 *
 * Nothing is posted: the sandbox provider records the message in the environment's own list, which
 * `POST /sandbox/slack-messages/search` reads by the secret's id, and the step says `recorded`, never
 * "sent". The record holds no webhook URL, and an end user's `<!channel>` pings nobody.
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
  specKey,
  waitForRunEnd,
} from './support/workflows.js';

const WEBHOOK = `https://hooks.slack.com/services/T0SYNTHETIC/B0SYNTHETIC/${randomUUID().replaceAll('-', '')}`;

test('a Slack step is recorded in the sandbox sink, escaped, and reads recorded (C126.3, C126.4, C146.3)', async () => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const admin = await adminClient(stack);
  const key = specKey('e2e_slack');
  const { data: secret } = await client.workflowSecrets.create({
    key,
    'allowed-hosts': ['hooks.slack.com'],
    'allowed-placements': { headers: [], 'body-pointers': [] },
  });
  await client.workflowSecrets.putValue(key, stack.environments.sandbox, WEBHOOK);
  const workflowId = await runningWorkflow(
    admin,
    `e2e-slack-${randomUUID().slice(0, 8)}`,
    chainDefinition(
      { type: 'trigger-api', config: {} },
      [
        actionStep('notify', 'send_slack_message', {
          'webhook-secret': `{{secrets.${key}}}`,
          text: 'Case {{ inputs.reference }} is ready.',
        }),
      ],
      { inputs: [{ name: 'reference', type: 'string', required: true }] },
    ),
  );

  const { data: started } = await client.workflows.trigger(workflowId, {
    reference: '<!channel>',
  });
  const run = await waitForRunEnd(client, started.id);
  expect(run.attributes.status).toBe('completed');

  const { data: steps } = await client.workflowRuns.steps(started.id);
  expect(
    steps.find(({ attributes }) => attributes['node-id'] === 'notify')?.attributes.output,
  ).toMatchObject({ delivery: 'recorded', sandbox: true });
  const { data: records } = await client.sandboxSlackMessages.search(secret.id);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    'secret-id': secret.id,
    'workflow-run-id': started.id,
    'message-text': 'Case &lt;!channel&gt; is ready.',
  });
  expect(JSON.stringify(records)).not.toContain(WEBHOOK);
});

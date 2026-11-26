/**
 * C124, C125, C146.3 (Workflow 8A): an API-triggered workflow calls a customer's endpoint. Budget: 90 s.
 *
 * A workflow secret signs the request. The receiver is local, on loopback, which only a sandbox
 * environment of a stack with `OPENVERIFY_WORKFLOW_HTTP_ALLOW_LOOPBACK` reaches, and its throwaway
 * certificate is trusted by the worker alone. It verifies the signature the way a customer does, with
 * `verifyWorkflowRequestSignature` from `@openverify/node`, and a webhook verifier refuses the same
 * request even with the same secret value (C124.6). The secret's value is in no step.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  OPENVERIFY_REQUEST_SIGNATURE_HEADER,
  verifyWebhookSignature,
  verifyWorkflowRequestSignature,
} from '@openverify/node';
import { expect, test } from '@playwright/test';
import { RECEIVER_TLS } from '../src/paths.js';
import { readStackInfo } from '../src/stack-info.js';
import { startWebhookReceiver } from '../src/webhook-receiver.js';
import { dashboardRequest, recordingClient, signInToApi } from './support/platform.js';
import {
  actionStep,
  chainDefinition,
  runningWorkflow,
  specKey,
  waitForRunEnd,
} from './support/workflows.js';

const SIGNING_VALUE = `change-me-synthetic-signing-value-${randomUUID()}`;

test('a signed HTTPS step reaches a local receiver, which verifies it with the workflow verifier and never with webhook code (C124.6, C125, C146.3)', async () => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const token = await signInToApi(stack, stack.operators.admin);
  const admin = recordingClient(stack.apiUrl, token).client;
  const receiver = await startWebhookReceiver({
    tls: {
      certificate: await readFile(RECEIVER_TLS.certificate),
      key: await readFile(RECEIVER_TLS.key),
    },
  });
  try {
    const target = new URL(receiver.url);
    const settings = await dashboardRequest(stack, 'PATCH', '/settings', {
      token,
      body: { 'workflow-http-ports': [Number(target.port)] },
    });
    expect(settings.status).toBe(200);
    const key = specKey('e2e_signing');
    await client.workflowSecrets.create({
      key,
      'allowed-hosts': ['localhost'],
      'allowed-placements': { headers: [], 'body-pointers': [] },
    });
    await client.workflowSecrets.putValue(key, stack.environments.sandbox, SIGNING_VALUE);

    const workflowId = await runningWorkflow(
      admin,
      `e2e-https-${randomUUID().slice(0, 8)}`,
      chainDefinition(
        { type: 'trigger-api', config: {} },
        [
          actionStep('call', 'make_https_request', {
            method: 'POST',
            url: receiver.url,
            body: { reference: '{{ inputs.reference }}' },
            signing: { secret: `{{secrets.${key}}}` },
          }),
        ],
        { inputs: [{ name: 'reference', type: 'string', required: true }] },
      ),
    );

    const { data: started } = await client.workflows.trigger(workflowId, {
      reference: 'synthetic-reference',
    });
    expect(started.attributes.status).toBe('in_progress');
    const run = await waitForRunEnd(client, started.id);
    expect(run.attributes).toMatchObject({ status: 'completed', 'trigger-type': 'trigger-api' });

    const request = await receiver.waitFor(() => true, { timeoutMs: 5_000 });
    expect(JSON.parse(request.body)).toEqual({ reference: 'synthetic-reference' });
    expect(request.headers['openverify-workflow-run']).toBe(started.id);
    expect(request.headers['idempotency-key']).toContain(started.id);
    const header = request.headers[OPENVERIFY_REQUEST_SIGNATURE_HEADER];
    expect(
      verifyWorkflowRequestSignature({
        secrets: SIGNING_VALUE,
        header,
        method: request.method,
        target: request.path,
        body: request.body,
      }).timestamp,
    ).toBeGreaterThan(0);
    // C124.6: the same bytes and the same value never pass as a webhook.
    expect(() =>
      verifyWebhookSignature({
        secrets: SIGNING_VALUE,
        header,
        body: request.body,
      }),
    ).toThrow();

    const { data: steps } = await client.workflowRuns.steps(started.id);
    expect(JSON.stringify(steps)).not.toContain(SIGNING_VALUE);
  } finally {
    await receiver.close();
  }
});

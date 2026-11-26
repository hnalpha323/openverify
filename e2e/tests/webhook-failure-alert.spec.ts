/**
 * C178.4 (Workflow 9B, integration-9b): a webhook failure alert on the full stack (C169.6, C169.7),
 * driven by a local receiver that fails. Budget: 90 s.
 *
 * A webhook with an alert at one failed first attempt in 5 minutes points at a receiver answering
 * 500. One event's first attempt fails; within the next sweep (every 60 s) the admin, who holds
 * `webhooks:read`, gets one `webhook-failure` notification about that webhook, and a second pass
 * within the window adds none. The alert counts failed first attempts and says so (rule 10).
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { startWebhookReceiver } from '../src/webhook-receiver.js';
import { expectStatus, pollUntil, serverRequest } from './support/platform-9b.js';
import { dashboardRequest, recordingClient } from './support/platform.js';
import { sessionTokenAs } from './support/ui.js';

interface Notifications {
  data: {
    id: string;
    attributes: { kind: string; 'subject-type'?: string };
    relationships?: { webhook?: { data: { id: string } | null } };
  }[];
}

test('a failing webhook alerts its readers once in its window (C169.6, C169.7)', async () => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const receiver = await startWebhookReceiver({ status: 500 });
  try {
    const webhook = expectStatus(
      await serverRequest(stack, stack.apiKey, 'POST', '/webhooks', {
        data: {
          type: 'webhook',
          attributes: {
            url: receiver.url,
            'enabled-events': ['inquiry.created'],
            name: `e2e failing ${randomUUID().slice(0, 8)}`,
            'failure-alert': { enabled: true, threshold: 1, 'window-minutes': 5 },
          },
        },
      }),
      201,
      'the webhook',
    ).body as { data: { id: string } };
    const { client } = recordingClient(stack.apiUrl, stack.apiKey);
    await client.inquiries.create({
      'inquiry-template-id': stack.defaultTemplateId,
      'reference-id': `e2e-alert-${randomUUID()}`,
    });
    const admin = await sessionTokenAs(stack, 'admin');
    const alertsFor = async () =>
      (
        (await dashboardRequest(stack, 'GET', '/notifications?page[size]=100', { token: admin }))
          .body as Notifications
      ).data.filter(
        (row) =>
          row.attributes.kind === 'webhook-failure' &&
          row.relationships?.webhook?.data?.id === webhook.data.id,
      );

    const alerts = await pollUntil(alertsFor, (rows) => rows.length > 0, 80_000, 'the alert');
    expect(receiver.requests.length).toBeGreaterThan(0);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.attributes['subject-type']).toBe('webhook');
    await client.webhooks.disable(webhook.data.id);
  } finally {
    await receiver.close();
  }
});

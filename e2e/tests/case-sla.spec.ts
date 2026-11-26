/**
 * C133.1, C133.6, C146.3 (Workflow 8B): a case created with `sla-expires-in-seconds: 5` fires
 * `case.sla-expired` once to a webhook. Budget: 120 s.
 *
 * The public deadline runs on the 24x7 calendar; the `case-sla` sweep (every 30 s) expires it in its
 * epoch and stages the event in the same transaction, so the webhook receives it once, within a
 * sweep period of the deadline. The spec then waits one more sweep period and counts again: the
 * case is `expired` now, and no sweeper takes it a second time (decision 60). The webhook filters
 * on the spec's own case template, so another spec's case never reaches it (C143.4).
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { startWebhookReceiver } from '../src/webhook-receiver.js';
import { publishedCaseTemplate } from './support/cases.js';
import { recordingClient } from './support/platform.js';
import { eventNamesFor, waitForEvent } from './support/webhooks.js';
import { adminClient } from './support/workflows.js';

/** C133.6: the sweep's period (`CASE_SLA_INTERVAL_MS`), and a margin for its batch. */
const SWEEP_MS = 30_000;

test('a case with sla-expires-in-seconds: 5 fires case.sla-expired once to a webhook (C133.6, C146.3)', async () => {
  test.setTimeout(120_000);
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const admin = await adminClient(stack);
  const run = randomUUID().slice(0, 8);
  const template = await publishedCaseTemplate(admin, `e2e-case-sla-${run}`);
  const receiver = await startWebhookReceiver();
  const { data: webhook } = await client.webhooks.create({
    url: receiver.url,
    'enabled-events': ['case.sla-expired'],
    filters: { 'case-template-ids': [template.id] },
  });
  try {
    const { data: made } = await admin.cases.create(
      { 'case-template-id': template.id },
      { 'sla-expires-in-seconds': 5 },
    );
    expect(made.attributes['sla-state']).toBe('running');
    const deadline = made.attributes['sla-expires-at'] ?? '';
    // Five seconds from the request's own clock, at or after the case's creation instant.
    const lead = Date.parse(deadline) - Date.parse(made.attributes['created-at']);
    expect(lead).toBeGreaterThanOrEqual(5_000);
    expect(lead).toBeLessThan(6_000);

    const delivery = await waitForEvent(
      receiver,
      'case.sla-expired',
      made.id,
      5_000 + 2 * SWEEP_MS,
    );
    // Consumers read the deadline from the payload, not the delivery time (C133.6).
    expect(delivery.event.attributes.payload.data.attributes).toMatchObject({
      'sla-state': 'expired',
      'sla-expires-at': deadline,
    });
    expect(Date.parse(delivery.event.attributes['created-at'])).toBeGreaterThanOrEqual(
      Date.parse(deadline),
    );

    // One more sweep period: the case is expired, and nothing fires it again.
    await new Promise((resolve) => setTimeout(resolve, SWEEP_MS + 5_000));
    expect(eventNamesFor(receiver, made.id)).toEqual(['case.sla-expired']);
    expect((await admin.cases.retrieve(made.id)).data.attributes['sla-state']).toBe('expired');
  } finally {
    await client.webhooks.disable(webhook.id);
    await receiver.close();
  }
});

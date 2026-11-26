/**
 * Phase 2, C14: webhook secret rotation signs every delivery with both secrets during the
 * overlap, so a receiver holding either secret verifies it; simulated events are delivered to
 * one webhook, flagged `simulated`; and a replay delivers a past event again.
 */
import { randomUUID } from 'node:crypto';
import { OPENVERIFY_SIGNATURE_HEADER, verifyWebhookSignature } from '@openverify/node';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { startWebhookReceiver } from '../src/webhook-receiver.js';
import { recordingClient } from './support/platform.js';
import { waitForEvent, type Delivery } from './support/webhooks.js';

const verifiesWith = (delivery: Delivery, secret: string) =>
  verifyWebhookSignature({
    body: delivery.request.body,
    header: delivery.request.headers[OPENVERIFY_SIGNATURE_HEADER],
    secrets: secret,
  }).timestamp;

test('during a secret rotation both secrets verify every delivery', async () => {
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const receiver = await startWebhookReceiver();
  const { data: webhook } = await client.webhooks.create({
    url: receiver.url,
    'enabled-events': ['inquiry.created'],
  });
  try {
    const previousSecret = webhook.attributes.secret;
    const rotated = await client.webhooks.rotateSecret(webhook.id, {
      'previous-secret-expires-in-seconds': 3600,
    });
    const newSecret = rotated.data.attributes.secret;
    expect(newSecret).not.toBe(previousSecret);
    expect(Date.parse(rotated.meta['previous-secret-expires-at'])).toBeGreaterThan(Date.now());

    const { data: inquiry } = await client.inquiries.create({
      'inquiry-template-id': stack.defaultTemplateId,
      'reference-id': `e2e-rotation-${randomUUID()}`,
    });
    const delivery = await waitForEvent(receiver, 'inquiry.created', inquiry.id);

    const header = String(delivery.request.headers[OPENVERIFY_SIGNATURE_HEADER]);
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64} v1=[0-9a-f]{64}$/);
    expect(verifiesWith(delivery, newSecret)).toBeGreaterThan(0);
    expect(verifiesWith(delivery, previousSecret)).toBeGreaterThan(0);
    expect(() => verifiesWith(delivery, `wbhsec_${'0'.repeat(43)}`)).toThrow();
  } finally {
    await client.webhooks.disable(webhook.id);
    await receiver.close();
  }
});

test('a simulated event and a replayed event are delivered to the webhook', async () => {
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const receiver = await startWebhookReceiver();
  const { data: webhook } = await client.webhooks.create({
    url: receiver.url,
    'enabled-events': ['inquiry.created', 'inquiry.approved'],
  });
  const secret = webhook.attributes.secret;
  try {
    // Simulate: a sample event from the golden fixtures, flagged and signed like any other.
    const since = new Date(Date.now() - 1_000);
    const simulated = await client.webhooks.simulate(webhook.id, {
      'event-name': 'inquiry.approved',
    });
    const eventId = simulated.meta['event-id'];
    const sample = await receiver.waitFor(
      (request) => request.headers['openverify-event-id'] === eventId,
      { timeoutMs: 60_000, description: `simulated event ${eventId}` },
    );
    const sampleEvent = (
      JSON.parse(sample.body) as { data: { attributes: Record<string, unknown> } }
    ).data;
    expect(sampleEvent.attributes).toMatchObject({ name: 'inquiry.approved', simulated: true });
    expect(
      verifyWebhookSignature({
        body: sample.body,
        header: sample.headers[OPENVERIFY_SIGNATURE_HEADER],
        secrets: secret,
      }).timestamp,
    ).toBeGreaterThan(0);
    // Simulated events stay out of the default event list (C12 `filter[simulated]`).
    const listed = async (simulatedOnly: boolean) =>
      (
        await client.events.list({
          filter: {
            name: 'inquiry.approved',
            'created-at-start': since,
            ...(simulatedOnly ? { simulated: true } : {}),
          },
        })
      ).data.map((event) => event.id);
    expect(await listed(false)).not.toContain(eventId);
    expect(await listed(true)).toContain(eventId);

    // Replay: a real event already delivered is delivered again, as a new delivery.
    const { data: inquiry } = await client.inquiries.create({
      'inquiry-template-id': stack.defaultTemplateId,
      'reference-id': `e2e-replay-${randomUUID()}`,
    });
    const original = await waitForEvent(receiver, 'inquiry.created', inquiry.id);
    const replay = await client.webhooks.replay(webhook.id, { 'event-ids': [original.event.id] });
    expect(replay.meta['replayed-count']).toBe(1);
    await expect
      .poll(
        () =>
          receiver.requests.filter(
            (request) => request.headers['openverify-event-id'] === original.event.id,
          ).length,
        { timeout: 60_000 },
      )
      .toBe(2);
    const deliveries = await client.webhookDeliveries.list({
      filter: { 'webhook-id': webhook.id, 'event-id': original.event.id },
    });
    expect(deliveries.data).toHaveLength(2);
    await expect
      .poll(
        async () =>
          (
            await client.webhookDeliveries.list({
              filter: { 'webhook-id': webhook.id, 'event-id': original.event.id },
            })
          ).data.map((delivery) => delivery.attributes.status),
        { timeout: 30_000 },
      )
      .toEqual(['succeeded', 'succeeded']);
  } finally {
    await client.webhooks.disable(webhook.id);
    await receiver.close();
  }
});

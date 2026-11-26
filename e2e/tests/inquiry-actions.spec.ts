/**
 * Phase 2, C10 and C17: approving, declining and marking an inquiry for review emit their
 * events and `inquiry.transitioned` with `{ from, to }`, which reach a webhook signed; an
 * action the state machine refuses answers 409 `invalid-transition`.
 */
import { randomUUID } from 'node:crypto';
import { problemTypeUri } from '@openverify/contracts';
import { OpenVerifyApiError } from '@openverify/node';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { startWebhookReceiver } from '../src/webhook-receiver.js';
import { recordingClient } from './support/platform.js';
import { verifyDelivery, waitForEvent } from './support/webhooks.js';

test('approve, decline and mark-for-review emit their events', async () => {
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const receiver = await startWebhookReceiver();
  const { data: webhook } = await client.webhooks.create({
    url: receiver.url,
    'enabled-events': [
      'inquiry.approved',
      'inquiry.declined',
      'inquiry.marked-for-review',
      'inquiry.transitioned',
    ],
  });
  try {
    /** A sandbox inquiry the end user "completed" (C10 simulate actions). */
    const completedInquiry = async () => {
      const { data } = await client.inquiries.create({
        'inquiry-template-id': stack.defaultTemplateId,
        'reference-id': `e2e-actions-${randomUUID()}`,
      });
      const { data: completed } = await client.inquiries.performSimulateActions(data.id, {
        actions: [{ type: 'start_inquiry' }, { type: 'complete_inquiry' }],
      });
      expect(completed.attributes.status).toBe('completed');
      return completed.id;
    };

    const reviewed = await completedInquiry();
    const { data: needsReview } = await client.inquiries.markForReview(reviewed);
    expect(needsReview.attributes.status).toBe('needs_review');
    const { data: approved } = await client.inquiries.approve(reviewed);
    expect(approved.attributes.status).toBe('approved');
    expect(approved.attributes['decisioned-at']).not.toBeNull();

    const declinedId = await completedInquiry();
    const { data: declined } = await client.inquiries.decline(declinedId);
    expect(declined.attributes.status).toBe('declined');

    // A decided inquiry cannot be decided again.
    const refused = await client.inquiries.approve(declinedId).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(OpenVerifyApiError);
    expect(refused).toMatchObject({ status: 409, type: problemTypeUri('invalid-transition') });

    // The Events API lists them, with every transition's from and to.
    const eventsOf = async (inquiryId: string) =>
      (await client.events.list({ filter: { 'object-id': inquiryId } })).data;
    const reviewedEvents = await eventsOf(reviewed);
    expect(reviewedEvents.map((event) => event.attributes.name)).toEqual(
      expect.arrayContaining(['inquiry.marked-for-review', 'inquiry.approved']),
    );
    const transitions = reviewedEvents
      .filter((event) => event.attributes.name === 'inquiry.transitioned')
      .map(({ attributes: { payload } }) => ('meta' in payload ? payload.meta : undefined))
      .filter((meta) => meta !== undefined);
    expect(transitions).toEqual(
      expect.arrayContaining([
        { from: 'completed', to: 'needs_review' },
        { from: 'needs_review', to: 'approved' },
      ]),
    );
    expect((await eventsOf(declinedId)).map((event) => event.attributes.name)).toEqual(
      expect.arrayContaining(['inquiry.declined', 'inquiry.transitioned']),
    );

    // And the customer's endpoint receives them, signed.
    for (const [name, inquiryId] of [
      ['inquiry.marked-for-review', reviewed],
      ['inquiry.approved', reviewed],
      ['inquiry.declined', declinedId],
    ] as const) {
      const delivery = await waitForEvent(receiver, name, inquiryId);
      expect(verifyDelivery(delivery, webhook.attributes.secret)).toBeGreaterThan(0);
      expect(delivery.event.attributes.simulated).toBe(false);
    }
  } finally {
    await client.webhooks.disable(webhook.id);
    await receiver.close();
  }
});

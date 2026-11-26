import { describe, expect, it } from 'vitest';
import { AT, AT_ISO, IDS, LATER, LATER_ISO } from './test-support.js';
import {
  WEBHOOK_DELIVERY_STATUSES,
  buildWebhookDeliveryResource,
  listWebhookDeliveriesQuerySchema,
  webhookDeliveryDocumentSchema,
  webhookDeliveryListDocumentSchema,
  webhookDeliveryResourceSchema,
} from './webhook-deliveries.js';

const delivery = {
  type: 'webhook-delivery',
  id: IDS.webhookDelivery,
  attributes: {
    status: 'pending',
    'webhook-id': IDS.webhook,
    'event-id': IDS.event,
    'event-name': 'inquiry.completed',
    attempts: [
      {
        'attempted-at': AT_ISO,
        'response-status': 503,
        'duration-ms': 120,
        error: null,
      },
      {
        'attempted-at': LATER_ISO,
        'response-status': null,
        'duration-ms': null,
        error: 'The webhook destination did not answer in time',
      },
    ],
    'next-attempt-at': LATER_ISO,
    'created-at': AT_ISO,
  },
};

describe('webhook-delivery resource (C14)', () => {
  it('is pending, succeeded or failed', () => {
    expect(WEBHOOK_DELIVERY_STATUSES).toEqual(['pending', 'succeeded', 'failed']);
  });

  it('records every attempt', () => {
    expect(webhookDeliveryResourceSchema.parse(delivery)).toEqual(delivery);
    expect(webhookDeliveryDocumentSchema.safeParse({ data: delivery }).success).toBe(true);
    expect(
      webhookDeliveryListDocumentSchema.safeParse({ data: [delivery], links: { next: null } })
        .success,
    ).toBe(true);
  });

  it.each([
    [
      'nine attempts',
      { attempts: Array.from({ length: 9 }, () => delivery.attributes.attempts[0]) },
    ],
    ['an unknown event name', { 'event-name': 'inquiry.deleted' }],
    [
      'a request body in an attempt',
      { attempts: [{ ...delivery.attributes.attempts[0], body: '{}' }] },
    ],
    [
      'an out-of-range response status',
      { attempts: [{ ...delivery.attributes.attempts[0], 'response-status': 700 }] },
    ],
  ])('rejects %s', (_name, change) => {
    const value = { ...delivery, attributes: { ...delivery.attributes, ...change } };
    expect(webhookDeliveryResourceSchema.safeParse(value).success).toBe(false);
  });

  it('is built from a delivery record', () => {
    expect(
      buildWebhookDeliveryResource({
        id: IDS.webhookDelivery,
        status: 'pending',
        webhookId: IDS.webhook,
        eventId: IDS.event,
        eventName: 'inquiry.completed',
        attempts: [
          { attemptedAt: AT, responseStatus: 503, durationMs: 120, error: null },
          {
            attemptedAt: LATER,
            responseStatus: null,
            durationMs: null,
            error: 'The webhook destination did not answer in time',
          },
        ],
        nextAttemptAt: LATER,
        createdAt: AT,
      }),
    ).toEqual(delivery);
    expect(
      buildWebhookDeliveryResource({
        id: IDS.webhookDelivery,
        status: 'succeeded',
        webhookId: IDS.webhook,
        eventId: IDS.event,
        eventName: 'inquiry.completed',
        attempts: [],
        nextAttemptAt: null,
        createdAt: AT,
      }).attributes['next-attempt-at'],
    ).toBeNull();
  });
});

describe('GET /webhook-deliveries query (C14)', () => {
  it('filters by webhook, event and status', () => {
    const query = {
      'filter[webhook-id]': IDS.webhook,
      'filter[event-id]': IDS.event,
      'filter[status]': 'failed,pending',
    };
    expect(listWebhookDeliveriesQuerySchema.parse(query)).toEqual(query);
    expect(listWebhookDeliveriesQuerySchema.safeParse({ 'filter[status]': 'ok' }).success).toBe(
      false,
    );
  });
});

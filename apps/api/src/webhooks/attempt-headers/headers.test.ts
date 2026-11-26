/**
 * C169.5 (Workflow 9B, `api-keys-webhooks`; contracts B30): the three attempt headers of a webhook
 * delivery, unit by unit and on a real delivery through the dispatcher (two attempts of one delivery,
 * the receiver failing the first). The retry schedule itself is unchanged (decision 52).
 */
import {
  buildVerificationResource,
  newId,
  newWebhookSecret,
  WEBHOOK_ATTEMPTS_LEFT_HEADER,
  WEBHOOK_ATTEMPTS_MADE_HEADER,
  WEBHOOK_FIRST_ATTEMPTED_AT_HEADER,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_OFFSETS_SECONDS,
} from '@openverify/contracts';
import { createWebhook } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventPublisher } from '../../events/index.js';
import { createCapturingLogger, createRecordingQueue } from '../../jobs/testing.js';
import { createTestApi, type TestApi } from '../../test-support/harness.js';
import { DEFAULT_WEBHOOK_RETRY_POLICY, deliverWebhook } from '../dispatcher.js';
import type { WebhookHttpRequest, WebhookSender } from '../http-sender.js';
import { createWebhookDeliveryScheduler, type WebhookDeliveryJob } from '../queue.js';
import { deliveryAttemptHeaders } from './headers.js';

const FIRST = new Date('2026-11-06T12:00:00.000Z');

describe('deliveryAttemptHeaders (C169.5)', () => {
  it('names the attempts made with this one, those left, and when the first was made', () => {
    expect(deliveryAttemptHeaders({ attempt: 1, maxAttempts: 8, firstAttemptedAt: FIRST })).toEqual(
      {
        [WEBHOOK_ATTEMPTS_MADE_HEADER]: '1',
        [WEBHOOK_ATTEMPTS_LEFT_HEADER]: '7',
        [WEBHOOK_FIRST_ATTEMPTED_AT_HEADER]: '2026-11-06T12:00:00.000Z',
      },
    );
  });

  it('counts down to none left on the last attempt, and never below none', () => {
    const left = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(
      (attempt) =>
        deliveryAttemptHeaders({ attempt, maxAttempts: 8, firstAttemptedAt: FIRST })[
          WEBHOOK_ATTEMPTS_LEFT_HEADER
        ],
    );

    expect(left).toEqual(['7', '6', '5', '4', '3', '2', '1', '0', '0']);
  });

  it('follows a delivery capped below the schedule', () => {
    expect(
      deliveryAttemptHeaders({ attempt: 2, maxAttempts: 3, firstAttemptedAt: FIRST }),
    ).toMatchObject({ [WEBHOOK_ATTEMPTS_MADE_HEADER]: '2', [WEBHOOK_ATTEMPTS_LEFT_HEADER]: '1' });
  });

  it('keeps the retry schedule: 8 attempts over 24 hours (decision 52)', () => {
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(8);
    expect(WEBHOOK_RETRY_OFFSETS_SECONDS.at(-1)).toBe(86_400);
  });
});

describe('the attempt headers on a delivery (C169.5)', () => {
  let api: TestApi;

  beforeAll(async () => {
    api = await createTestApi();
  });

  afterAll(async () => {
    await api.close();
  });

  it('sends the headers on each attempt, with the first attempt’s time kept', async () => {
    const tenant = await api.newTenant();
    const db = api.database.db;
    await createWebhook(db, tenant.environmentId, {
      id: newId('wbh'),
      url: 'https://hooks.example.test/openverify',
      enabledEvents: ['*'],
      secret: newWebhookSecret(),
    });
    const publisher = createEventPublisher({
      db,
      deliveries: createWebhookDeliveryScheduler(createRecordingQueue<WebhookDeliveryJob>()),
    });
    const staged = await db.transaction((tx) =>
      publisher.stage(tx, {
        environmentId: tenant.environmentId,
        name: 'verification.passed',
        payload: {
          data: buildVerificationResource({
            id: newId('ver'),
            type: 'government_id',
            status: 'passed',
            inquiryId: newId('inq'),
            fileIds: [],
            checks: [],
            createdAt: FIRST,
            updatedAt: FIRST,
          }),
        },
      }),
    );
    const deliveryId = staged.deliveries[0]?.deliveryId ?? '';
    const requests: WebhookHttpRequest[] = [];
    const statuses = [503, 200];
    const sender: WebhookSender = {
      send(request) {
        requests.push(request);
        return Promise.resolve({ status: statuses.shift() ?? 200, durationMs: 3 });
      },
      close: () => Promise.resolve(),
    };
    const deps = (now: Date) => ({
      db,
      sender,
      scheduler: createWebhookDeliveryScheduler(createRecordingQueue<WebhookDeliveryJob>()),
      clock: { now: () => now },
      logger: createCapturingLogger(),
      retry: { ...DEFAULT_WEBHOOK_RETRY_POLICY, random: () => 0.5 },
    });

    const first = await deliverWebhook(
      { environmentId: tenant.environmentId, deliveryId, attempt: 1 },
      deps(FIRST),
    );
    const second = await deliverWebhook(
      { environmentId: tenant.environmentId, deliveryId, attempt: 2 },
      deps(new Date(FIRST.getTime() + 61_000)),
    );

    expect([first.outcome, second.outcome]).toEqual(['retry', 'succeeded']);
    const headers = requests.map((request) => ({
      made: request.headers[WEBHOOK_ATTEMPTS_MADE_HEADER],
      left: request.headers[WEBHOOK_ATTEMPTS_LEFT_HEADER],
      first: request.headers[WEBHOOK_FIRST_ATTEMPTED_AT_HEADER],
    }));
    expect(headers).toEqual([
      { made: '1', left: '7', first: FIRST.toISOString() },
      { made: '2', left: '6', first: FIRST.toISOString() },
    ]);
  });
});

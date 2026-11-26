import {
  WEBHOOK_USER_AGENT,
  buildInquiryResource,
  buildVerificationResource,
  eventDocumentSchema,
  newId,
  newWebhookSecret,
  type EventName,
  type EventPayload,
} from '@openverify/contracts';
import {
  createEvent,
  createWebhook,
  createWebhookDelivery,
  getEvent,
  getWebhookDelivery,
  recordWebhookDeliveryAttempt,
  rotateWebhookSecret,
  updateWebhook,
  type Db,
  type NewWebhookInput,
} from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import {
  WebhookSignatureError,
  signWebhookPayload,
  verifyWebhookSignature,
} from '@openverify/node';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createEventPublisher } from '../events/index.js';
import { createCapturingLogger, createRecordingQueue } from '../jobs/testing.js';
import {
  DEFAULT_WEBHOOK_RETRY_POLICY,
  deliverWebhook,
  sweepDueWebhookDeliveries,
  webhookAttemptDueAt,
  type DeliverWebhookDeps,
} from './dispatcher.js';
import {
  WebhookRequestError,
  type WebhookHttpRequest,
  type WebhookHttpResponse,
  type WebhookSender,
} from './http-sender.js';
import { createWebhookDeliveryScheduler, type WebhookDeliveryJob } from './queue.js';

const NOW = new Date('2026-10-20T12:00:00.000Z');
const URL = 'https://hooks.example.test/openverify?token=customer-secret-token';

let database: TestDatabase;
let db: Db;
let environmentId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  environmentId = (await createTestTenant(db)).environment.id;
}, 60_000);

afterAll(async () => {
  await database.close();
});

type Answer = WebhookHttpResponse | WebhookRequestError;

function fakeSender(answers: Answer[]): WebhookSender & { requests: WebhookHttpRequest[] } {
  const requests: WebhookHttpRequest[] = [];
  return {
    requests,
    send(request) {
      requests.push(request);
      const answer = answers.shift() ?? { status: 200, durationMs: 3 };
      return answer instanceof WebhookRequestError
        ? Promise.reject(answer)
        : Promise.resolve(answer);
    },
    close: () => Promise.resolve(),
  };
}

interface Fixture {
  secret: string;
  webhookId: string;
  eventId: string;
  deliveryId: string;
}

async function createDelivery(): Promise<Fixture> {
  const secret = newWebhookSecret();
  const webhook = await createWebhook(db, environmentId, {
    id: newId('wbh'),
    url: URL,
    enabledEvents: ['*'],
    secret,
  });
  const publisher = createEventPublisher({
    db,
    deliveries: createWebhookDeliveryScheduler(createRecordingQueue<WebhookDeliveryJob>()),
  });
  const staged = await db.transaction((tx) =>
    publisher.stage(tx, {
      environmentId,
      name: 'verification.passed',
      payload: {
        data: buildVerificationResource({
          id: newId('ver'),
          type: 'government_id',
          status: 'passed',
          inquiryId: newId('inq'),
          fileIds: [],
          checks: [],
          createdAt: NOW,
          updatedAt: NOW,
        }),
      },
    }),
  );
  // Each test starts without webhooks, so this one is the only subscriber.
  const [delivery] = staged.deliveries;
  if (delivery === undefined) throw new Error('no delivery staged');
  return {
    secret,
    webhookId: webhook.id,
    eventId: staged.eventId,
    deliveryId: delivery.deliveryId,
  };
}

function deps(sender: WebhookSender, overrides: Partial<DeliverWebhookDeps> = {}) {
  const queue = createRecordingQueue<WebhookDeliveryJob>();
  const logger = createCapturingLogger();
  const value: DeliverWebhookDeps = {
    db,
    sender,
    scheduler: createWebhookDeliveryScheduler(queue),
    clock: { now: () => NOW },
    logger,
    retry: { ...DEFAULT_WEBHOOK_RETRY_POLICY, random: () => 0.5 },
    ...overrides,
  };
  return { deps: value, queue, logger };
}

const job = (fixture: Fixture, attempt = 1): WebhookDeliveryJob => ({
  environmentId,
  deliveryId: fixture.deliveryId,
  attempt,
});

describe('deliverWebhook', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    await db.execute('delete from webhooks');
    fixture = await createDelivery();
  });

  it('POSTs the signed event document with the C5 headers and records the success', async () => {
    const sender = fakeSender([{ status: 200, durationMs: 12 }]);
    const { deps: context, queue } = deps(sender);
    const result = await deliverWebhook(job(fixture), context);

    expect(result).toEqual({ outcome: 'succeeded', attempt: 1, status: 200 });
    const [request] = sender.requests;
    expect(request?.url).toBe(URL);
    expect(request?.headers).toEqual({
      'content-type': 'application/json',
      'user-agent': WEBHOOK_USER_AGENT,
      'openverify-event-id': fixture.eventId,
      'openverify-signature': expect.stringMatching(/^t=\d+,v1=[0-9a-f]{64}$/) as unknown,
      'openverify-version': '2026-10-01',
      // C169.5 (Workflow 9B): the attempt headers.
      'openverify-webhook-attempts-made': '1',
      'openverify-webhook-attempts-left': '7',
      'openverify-webhook-first-attempted-at': NOW.toISOString(),
    });
    const document = eventDocumentSchema.parse(JSON.parse(request?.body ?? ''));
    expect(document.data).toMatchObject({
      type: 'event',
      id: fixture.eventId,
      attributes: { name: 'verification.passed' },
    });
    expect(
      verifyWebhookSignature({
        body: request?.body ?? '',
        header: request?.headers['openverify-signature'],
        secrets: fixture.secret,
        now: NOW,
      }),
    ).toEqual({ timestamp: NOW.getTime() / 1000 });

    expect(await getWebhookDelivery(db, environmentId, fixture.deliveryId)).toMatchObject({
      status: 'succeeded',
      attemptCount: 1,
      lastResponseStatus: 200,
      deliveredAt: NOW,
      nextAttemptAt: null,
      attempts: [
        {
          attempt: 1,
          attempted_at: NOW.toISOString(),
          response_status: 200,
          duration_ms: 12,
          error: null,
        },
      ],
    });
    expect(queue.jobs).toEqual([]);
  });

  it('schedules a retry with backoff after a non-2xx answer', async () => {
    const { deps: context, queue } = deps(fakeSender([{ status: 503, durationMs: 5 }]));
    const result = await deliverWebhook(job(fixture), context);

    const delay = 60_000;
    expect(result).toEqual({ outcome: 'retry', attempt: 1, status: 503, delayMs: delay });
    expect(await getWebhookDelivery(db, environmentId, fixture.deliveryId)).toMatchObject({
      status: 'pending',
      attemptCount: 1,
      lastResponseStatus: 503,
      nextAttemptAt: new Date(NOW.getTime() + delay),
    });
    expect(queue.jobs).toEqual([
      expect.objectContaining({
        data: { environmentId, deliveryId: fixture.deliveryId, attempt: 2 },
        options: expect.objectContaining({ jobId: `${fixture.deliveryId}-2`, delay }) as unknown,
      }),
    ]);
  });

  it('records a request error and retries it', async () => {
    const { deps: context } = deps(fakeSender([new WebhookRequestError('timeout')]));
    expect(await deliverWebhook(job(fixture), context)).toMatchObject({ outcome: 'retry' });
    expect(await getWebhookDelivery(db, environmentId, fixture.deliveryId)).toMatchObject({
      status: 'pending',
      lastResponseStatus: null,
      lastError: 'The webhook receiver did not answer in time',
    });
  });

  it('gives up at once on a blocked destination', async () => {
    const { deps: context, queue } = deps(fakeSender([new WebhookRequestError('blocked')]));
    expect(await deliverWebhook(job(fixture), context)).toMatchObject({ outcome: 'failed' });
    expect(await getWebhookDelivery(db, environmentId, fixture.deliveryId)).toMatchObject({
      status: 'failed',
      lastError: 'The webhook destination address is not allowed',
    });
    expect(queue.jobs).toEqual([]);
  });

  it('gives up after the eighth attempt, keeping every attempt', async () => {
    for (let attempt = 1; attempt <= 7; attempt += 1) {
      await recordWebhookDeliveryAttempt(db, environmentId, fixture.deliveryId, {
        outcome: 'retry',
        attemptedAt: NOW,
        responseStatus: 500,
        nextAttemptAt: NOW,
      });
    }
    const { deps: context, queue } = deps(fakeSender([{ status: 500, durationMs: 1 }]));
    expect(await deliverWebhook(job(fixture, 8), context)).toEqual({
      outcome: 'failed',
      attempt: 8,
      status: 500,
    });
    const stored = await getWebhookDelivery(db, environmentId, fixture.deliveryId);
    expect(stored).toMatchObject({ status: 'failed', attemptCount: 8, nextAttemptAt: null });
    expect(stored?.attempts.map((entry) => entry.attempt)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(queue.jobs).toEqual([]);
  });

  it('skips a job for an attempt that was already made', async () => {
    await recordWebhookDeliveryAttempt(db, environmentId, fixture.deliveryId, {
      outcome: 'retry',
      attemptedAt: NOW,
      responseStatus: 500,
      nextAttemptAt: NOW,
    });
    const sender = fakeSender([]);
    expect(await deliverWebhook(job(fixture, 1), deps(sender).deps)).toEqual({
      outcome: 'skipped',
      reason: 'stale_attempt',
    });
    expect(sender.requests).toEqual([]);
  });

  it('skips a delivery that is no longer pending or does not exist', async () => {
    const sender = fakeSender([]);
    await deliverWebhook(job(fixture), deps(sender).deps);
    expect(await deliverWebhook(job(fixture, 2), deps(sender).deps)).toEqual({
      outcome: 'skipped',
      reason: 'not_pending',
    });
    expect(
      await deliverWebhook(
        { environmentId, deliveryId: newId('whd'), attempt: 1 },
        deps(sender).deps,
      ),
    ).toEqual({ outcome: 'skipped', reason: 'not_found' });
    expect(sender.requests).toHaveLength(1);
  });

  it('fails without sending when the webhook was disabled', async () => {
    await updateWebhook(db, environmentId, fixture.webhookId, { status: 'disabled' });
    const sender = fakeSender([]);
    expect(await deliverWebhook(job(fixture), deps(sender).deps)).toMatchObject({
      outcome: 'failed',
    });
    expect(sender.requests).toEqual([]);
    expect(await getWebhookDelivery(db, environmentId, fixture.deliveryId)).toMatchObject({
      status: 'failed',
      lastError: 'The webhook is disabled',
    });
  });

  it('keeps the retry recorded when scheduling it fails', async () => {
    const queue = createRecordingQueue<WebhookDeliveryJob>();
    queue.fail = new Error('connection is closed');
    const { deps: context, logger } = deps(fakeSender([{ status: 500, durationMs: 1 }]), {
      scheduler: createWebhookDeliveryScheduler(queue),
    });
    expect(await deliverWebhook(job(fixture), context)).toMatchObject({ outcome: 'retry' });
    expect(logger.entries).toContainEqual(expect.objectContaining({ level: 'warn' }));
  });

  it('never logs the URL, the secret or the body', async () => {
    const sender = fakeSender([{ status: 500, durationMs: 1 }]);
    const { deps: context, logger } = deps(sender);
    await deliverWebhook(job(fixture), context);
    const logged = JSON.stringify(logger.entries);
    expect(logger.entries.length).toBeGreaterThan(0);
    expect(logged).not.toContain('customer-secret-token');
    expect(logged).not.toContain('hooks.example.test');
    expect(logged).not.toContain(fixture.secret);
    expect(logged).not.toContain(sender.requests[0]?.body ?? '<none>');
  });
});

describe('deliverWebhook edge cases', () => {
  beforeEach(async () => {
    await db.execute('delete from webhooks');
  });

  it('rethrows an unexpected sender failure without recording an attempt', async () => {
    const fixture = await createDelivery();
    const sender: WebhookSender = {
      send: () => Promise.reject(new Error('bug in the sender')),
      close: () => Promise.resolve(),
    };
    await expect(deliverWebhook(job(fixture), deps(sender).deps)).rejects.toThrow(
      'bug in the sender',
    );
    expect(await getWebhookDelivery(db, environmentId, fixture.deliveryId)).toMatchObject({
      status: 'pending',
      attemptCount: 0,
    });
  });

  it('records an attempt once when two workers run it, so retries are not burnt twice (2B F021)', async () => {
    const fixture = await createDelivery();
    const sender = fakeSender([
      { status: 500, durationMs: 3 },
      { status: 500, durationMs: 3 },
    ]);
    const { deps: shared } = deps(sender);

    const results = await Promise.all([
      deliverWebhook(job(fixture), shared),
      deliverWebhook(job(fixture), shared),
    ]);

    expect(results.map((result) => result.outcome).sort()).toEqual(['retry', 'skipped']);
    expect(await getWebhookDelivery(db, environmentId, fixture.deliveryId)).toMatchObject({
      status: 'pending',
      attemptCount: 1,
    });
  });

  it('fails a delivery whose event is not a Phase 1 event, without sending it', async () => {
    const webhook = await createWebhook(db, environmentId, {
      id: newId('wbh'),
      url: URL,
      enabledEvents: ['*'],
      secret: newWebhookSecret(),
    });
    const event = await createEvent(db, environmentId, {
      id: newId('evt'),
      name: 'inquiry.marked-for-review',
      payload: {},
    });
    const delivery = await createWebhookDelivery(db, environmentId, {
      id: newId('whd'),
      webhookId: webhook.id,
      eventId: event.id,
    });
    const sender = fakeSender([]);
    expect(
      await deliverWebhook(
        { environmentId, deliveryId: delivery?.id ?? '', attempt: 1 },
        deps(sender).deps,
      ),
    ).toMatchObject({ outcome: 'failed' });
    expect(sender.requests).toEqual([]);
    expect(await getWebhookDelivery(db, environmentId, delivery?.id ?? '')).toMatchObject({
      status: 'failed',
      lastError: 'The event is not available',
    });
  });
});

describe('webhookAttemptDueAt (C14 schedule)', () => {
  const FIRST = new Date('2026-10-20T08:00:00.000Z');
  const exact = { ...DEFAULT_WEBHOOK_RETRY_POLICY, random: () => 0.5 };

  it('uses the C14 offsets and ±10% jitter by default', () => {
    expect(DEFAULT_WEBHOOK_RETRY_POLICY).toEqual({
      offsetsSeconds: [0, 60, 300, 1800, 7200, 21_600, 43_200, 86_400],
      jitterRatio: 0.1,
      random: Math.random,
    });
  });

  it('puts attempt n at its offset after the first attempt', () => {
    const due = [1, 2, 3, 4, 5, 6, 7, 8].map(
      (attempt) => (webhookAttemptDueAt(FIRST, attempt, exact)?.getTime() ?? 0) - FIRST.getTime(),
    );
    expect(due).toEqual([0, 60, 300, 1800, 7200, 21_600, 43_200, 86_400].map((s) => s * 1000));
  });

  it('jitters each offset by at most 10% either way', () => {
    const low = { ...exact, random: () => 0 };
    const high = { ...exact, random: () => 0.999_999 };
    const offset = (policy: typeof exact, attempt: number) =>
      (webhookAttemptDueAt(FIRST, attempt, policy)?.getTime() ?? 0) - FIRST.getTime();

    expect(offset(low, 2)).toBe(54_000);
    expect(offset(high, 2)).toBeGreaterThan(65_990);
    expect(offset(high, 2)).toBeLessThanOrEqual(66_000);
    expect(offset(low, 8)).toBe(77_760_000);
    expect(offset(high, 8)).toBeLessThanOrEqual(95_040_000);
    expect(offset(low, 1)).toBe(0);
    expect(offset(high, 1)).toBe(0);
  });

  it('has no attempt after the last offset', () => {
    expect(webhookAttemptDueAt(FIRST, 9, exact)).toBeNull();
    expect(webhookAttemptDueAt(FIRST, 0, exact)).toBeNull();
  });
});

describe('deliverWebhook retry schedule (C14)', () => {
  beforeEach(async () => {
    await db.execute('delete from webhooks');
  });

  it('retries on the schedule measured from the first attempt, then gives up', async () => {
    const fixture = await createDelivery();
    let now = NOW;
    const offsets = [60, 300, 1800, 7200, 21_600, 43_200, 86_400];
    const scheduled: number[] = [];
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const { deps: context } = deps(fakeSender([{ status: 500, durationMs: 1 }]), {
        clock: { now: () => now },
      });
      const result = await deliverWebhook(job(fixture, attempt), context);
      if (attempt < 8) {
        expect(result).toMatchObject({ outcome: 'retry', attempt });
        const stored = await getWebhookDelivery(db, environmentId, fixture.deliveryId);
        const next = stored?.nextAttemptAt ?? NOW;
        scheduled.push((next.getTime() - NOW.getTime()) / 1000);
        now = next;
      } else {
        expect(result).toEqual({ outcome: 'failed', attempt: 8, status: 500 });
      }
    }
    expect(scheduled).toEqual(offsets);
  });

  it('keeps the schedule when an attempt runs late: an overdue retry is due at once', async () => {
    const fixture = await createDelivery();
    const first = new Date(NOW.getTime() - 10 * 60_000);
    await recordWebhookDeliveryAttempt(db, environmentId, fixture.deliveryId, {
      outcome: 'retry',
      attemptedAt: first,
      responseStatus: 500,
      nextAttemptAt: new Date(first.getTime() + 60_000),
    });
    const { deps: context, queue } = deps(fakeSender([{ status: 502, durationMs: 1 }]));

    // Attempt 2 runs 10 minutes after the first, past the 5-minute slot of attempt 3.
    const result = await deliverWebhook(job(fixture, 2), context);

    expect(result).toEqual({ outcome: 'retry', attempt: 2, status: 502, delayMs: 0 });
    expect(await getWebhookDelivery(db, environmentId, fixture.deliveryId)).toMatchObject({
      nextAttemptAt: NOW,
      firstAttemptedAt: first,
    });
    expect(queue.jobs.map((entry) => entry.options?.delay)).toEqual([0]);
  });

  it('stops at the delivery attempt limit when it is lower than the schedule', async () => {
    const fixture = await createDelivery();
    await db.execute(
      sql`update webhook_deliveries set max_attempts = 2 where id = ${fixture.deliveryId}`,
    );
    await recordWebhookDeliveryAttempt(db, environmentId, fixture.deliveryId, {
      outcome: 'retry',
      attemptedAt: NOW,
      responseStatus: 500,
      nextAttemptAt: NOW,
    });
    const { deps: context, queue } = deps(fakeSender([{ status: 500, durationMs: 1 }]));

    expect(await deliverWebhook(job(fixture, 2), context)).toEqual({
      outcome: 'failed',
      attempt: 2,
      status: 500,
    });
    expect(queue.jobs).toEqual([]);
  });
});

describe('deliverWebhook (C14 configuration)', () => {
  beforeEach(async () => {
    await db.execute('delete from webhooks');
  });

  const inquiryId = 'inq_01M5CJXHG07XPHF3HRM6NREDH7';

  function inquiryPayload(): EventPayload {
    const verificationId = newId('ver');
    return {
      data: buildInquiryResource({
        id: inquiryId,
        status: 'completed',
        referenceId: 'ref-synthetic-c14',
        fields: { name_first: 'Synthetic', name_last: 'Person' },
        inquiryTemplateId: newId('itmpl'),
        verifications: [{ id: verificationId, type: 'government_id' }],
        createdAt: NOW,
        updatedAt: NOW,
      }),
      included: [
        buildVerificationResource({
          id: verificationId,
          type: 'government_id',
          status: 'passed',
          inquiryId,
          fileIds: [],
          checks: [
            {
              name: 'id_blur_detection',
              status: 'passed',
              reasons: [],
              required: true,
              metadata: { blur_score: 120 },
            },
          ],
          createdAt: NOW,
          updatedAt: NOW,
        }),
      ],
    };
  }

  interface Setup {
    webhook?: Partial<NewWebhookInput>;
    name?: EventName;
    payload?: Record<string, unknown>;
    simulated?: boolean;
  }

  async function deliveryWith(setup: Setup = {}) {
    const secret = newWebhookSecret();
    const webhook = await createWebhook(db, environmentId, {
      id: newId('wbh'),
      url: URL,
      enabledEvents: ['*'],
      secret,
      ...setup.webhook,
    });
    const event = await createEvent(db, environmentId, {
      id: newId('evt'),
      name: setup.name ?? 'inquiry.completed',
      payload: setup.payload ?? inquiryPayload(),
      ...(setup.simulated === undefined ? {} : { simulated: setup.simulated }),
    });
    const delivery = await createWebhookDelivery(db, environmentId, {
      id: newId('whd'),
      webhookId: webhook.id,
      eventId: event.id,
    });
    if (delivery === null) throw new Error('no delivery created');
    return { secret, webhookId: webhook.id, eventId: event.id, deliveryId: delivery.id };
  }

  async function send(fixture: { deliveryId: string }, now: Date = NOW) {
    const sender = fakeSender([{ status: 204, durationMs: 2 }]);
    const { deps: context, logger } = deps(sender, { clock: { now: () => now } });
    const result = await deliverWebhook(
      { environmentId, deliveryId: fixture.deliveryId, attempt: 1 },
      context,
    );
    const [request] = sender.requests;
    return { result, request, logger };
  }

  it('signs with the new secret first and the previous one while it is still valid', async () => {
    const fixture = await deliveryWith();
    const rotated = newWebhookSecret();
    await rotateWebhookSecret(db, environmentId, fixture.webhookId, {
      secret: rotated,
      previousSecretExpiresAt: new Date(NOW.getTime() + 3_600_000),
    });

    const { request } = await send(fixture);

    const body = request?.body ?? '';
    const header = request?.headers['openverify-signature'];
    expect(header).toBe(signWebhookPayload(body, [rotated, fixture.secret], NOW.getTime() / 1000));
    for (const secrets of [rotated, fixture.secret]) {
      expect(verifyWebhookSignature({ body, header, secrets, now: NOW })).toEqual({
        timestamp: NOW.getTime() / 1000,
      });
    }
  });

  it('signs with the new secret only once the previous one expired', async () => {
    const fixture = await deliveryWith();
    const rotated = newWebhookSecret();
    await rotateWebhookSecret(db, environmentId, fixture.webhookId, {
      secret: rotated,
      previousSecretExpiresAt: new Date(NOW.getTime() - 1000),
    });

    const { request } = await send(fixture);

    const body = request?.body ?? '';
    const header = request?.headers['openverify-signature'];
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature({ body, header, secrets: rotated, now: NOW })).toBeDefined();
    expect(() =>
      verifyWebhookSignature({ body, header, secrets: fixture.secret, now: NOW }),
    ).toThrow(WebhookSignatureError);
  });

  it('sends the custom headers, which can never replace the headers the dispatcher sets', async () => {
    const fixture = await deliveryWith({
      webhook: {
        // Stored directly: the API refuses these names, the dispatcher must still ignore them.
        customHeaders: {
          'X-Customer-Auth': 'synthetic-header-value',
          'Content-Type': 'text/plain',
          'User-Agent': 'Forged/1',
          'OpenVerify-Signature': 't=1,v1=forged',
          'openverify-event-id': 'evt_forged',
          Host: 'internal.example.test',
          'Transfer-Encoding': 'chunked',
          'X-Injected': 'value\r\nX-Evil: 1',
        },
      },
    });

    const { request, logger } = await send(fixture);

    const headers = request?.headers ?? {};
    expect(headers).toEqual({
      'X-Customer-Auth': 'synthetic-header-value',
      'content-type': 'application/json',
      'user-agent': WEBHOOK_USER_AGENT,
      'openverify-event-id': fixture.eventId,
      'openverify-signature': expect.stringMatching(/^t=\d+,v1=[0-9a-f]{64}$/) as unknown,
      'openverify-version': '2026-10-01',
      // C169.5 (Workflow 9B): the attempt headers.
      'openverify-webhook-attempts-made': '1',
      'openverify-webhook-attempts-left': '7',
      'openverify-webhook-first-attempted-at': NOW.toISOString(),
    });
    expect(
      verifyWebhookSignature({
        body: request?.body ?? '',
        header: headers['openverify-signature'],
        secrets: fixture.secret,
        now: NOW,
      }),
    ).toBeDefined();
    expect(JSON.stringify(logger.entries)).not.toContain('synthetic-header-value');
  });

  it('removes blocked attributes from every resource of the payload before signing', async () => {
    const fixture = await deliveryWith({
      webhook: { attributeBlocklist: ['fields', 'reference-id', 'metadata'] },
    });

    const { request } = await send(fixture);

    // Not parsed with the event schema: blocking removes attributes the contract requires.
    const body = request?.body ?? '';
    const sent = JSON.parse(body) as {
      data: { id: string; attributes: { payload: { data: Record<string, unknown> } } };
    };
    expect(sent.data.id).toBe(fixture.eventId);
    expect(body).not.toContain('Synthetic');
    expect(body).not.toContain('ref-synthetic-c14');
    expect(body).not.toContain('blur_score');
    expect(body).toContain('id_blur_detection');
    expect(sent.data.attributes.payload.data).toMatchObject({
      type: 'inquiry',
      id: inquiryId,
      attributes: { status: 'completed' },
      relationships: { 'inquiry-template': {} },
    });
    expect(
      verifyWebhookSignature({
        body,
        header: request?.headers['openverify-signature'],
        secrets: fixture.secret,
        now: NOW,
      }),
    ).toBeDefined();
    // The stored event keeps its full payload.
    expect(JSON.stringify((await getEvent(db, environmentId, fixture.eventId))?.payload)).toContain(
      'ref-synthetic-c14',
    );
  });

  it('tells receivers whether the event was simulated', async () => {
    const simulated = await deliveryWith({ simulated: true });
    const real = await deliveryWith();

    const attributes = async (fixture: { deliveryId: string }) =>
      eventDocumentSchema.parse(JSON.parse((await send(fixture)).request?.body ?? '')).data
        .attributes;

    expect(await attributes(simulated)).toMatchObject({ simulated: true });
    expect(await attributes(real)).toMatchObject({ simulated: false });
  });

  it('delivers the stub of a redacted event', async () => {
    const fixture = await deliveryWith({
      payload: {
        data: {
          type: 'inquiry',
          id: inquiryId,
          attributes: { 'redacted-at': '2026-10-20T11:00:00.000Z' },
        },
      },
    });

    const { result, request } = await send(fixture);

    expect(result).toMatchObject({ outcome: 'succeeded' });
    expect(
      eventDocumentSchema.parse(JSON.parse(request?.body ?? '')).data.attributes,
    ).toMatchObject({
      name: 'inquiry.completed',
      payload: { data: { attributes: { 'redacted-at': '2026-10-20T11:00:00.000Z' } } },
    });
  });

  it('never delivers to an archived webhook', async () => {
    const fixture = await deliveryWith();
    await updateWebhook(db, environmentId, fixture.webhookId, { status: 'archived' });

    const { result, request } = await send(fixture);

    expect(result).toMatchObject({ outcome: 'failed' });
    expect(request).toBeUndefined();
    expect(await getWebhookDelivery(db, environmentId, fixture.deliveryId)).toMatchObject({
      status: 'failed',
      lastError: 'The webhook is archived',
    });
  });

  it('fails without sending when the stored payload does not fit the event name', async () => {
    const fixture = await deliveryWith({ name: 'account.created' });

    const { result, request } = await send(fixture);

    expect(result).toMatchObject({ outcome: 'failed' });
    expect(request).toBeUndefined();
  });
});

describe('sweepDueWebhookDeliveries', () => {
  beforeEach(async () => {
    await db.execute('delete from webhooks');
  });

  it('re-enqueues pending deliveries that are overdue by more than the grace period', async () => {
    const overdue = await createDelivery();
    const queue = createRecordingQueue<WebhookDeliveryJob>();
    const scheduler = createWebhookDeliveryScheduler(queue);
    const later = { now: () => new Date(Date.now() + 120_000) };

    const count = await sweepDueWebhookDeliveries({ db, scheduler, clock: later, graceMs: 60_000 });

    expect(count).toBe(1);
    expect(queue.jobs.map((entry) => entry.data)).toEqual([
      { environmentId, deliveryId: overdue.deliveryId, attempt: 1 },
    ]);
  });

  it('replaces the job an earlier run of the attempt left, which would block the add (2B F011)', async () => {
    const overdue = await createDelivery();
    const queue = createRecordingQueue<WebhookDeliveryJob>();
    const later = { now: () => new Date(Date.now() + 120_000) };

    await sweepDueWebhookDeliveries({
      db,
      scheduler: createWebhookDeliveryScheduler(queue),
      clock: later,
      graceMs: 60_000,
    });

    expect(queue.removed).toEqual([`${overdue.deliveryId}-1`]);
    expect(queue.jobs.map((entry) => entry.options?.jobId)).toEqual([`${overdue.deliveryId}-1`]);
  });

  it('leaves deliveries that are not overdue yet', async () => {
    await createDelivery();
    const queue = createRecordingQueue<WebhookDeliveryJob>();
    const count = await sweepDueWebhookDeliveries({
      db,
      scheduler: createWebhookDeliveryScheduler(queue),
      clock: { now: () => new Date() },
      graceMs: 60_000,
    });
    expect(count).toBe(0);
    expect(queue.jobs).toEqual([]);
  });
});

/**
 * C14 webhooks end to end on Postgres 17 (Testcontainers): the server API routes, the event
 * publisher, the dispatcher and the SSRF-guarded sender delivering to a local receiver
 * (private networks are allowed here, as in development and test mode). The clock is fake, so
 * the retry schedule and the rotation overlap are checked to the millisecond.
 */
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  API_SCOPES,
  buildInquiryResource,
  createdWebhookDocumentSchema,
  newId,
  replayWebhookDocumentSchema,
  rotateWebhookSecretDocumentSchema,
  webhookDeliveryDocumentSchema,
  webhookDeliveryListDocumentSchema,
} from '@openverify/contracts';
import {
  createApiKey,
  createDatabase,
  createKeyring,
  generateApiKey,
  runMigrations,
  setDefaultKeyring,
  type Database,
} from '@openverify/db';
import {
  createIntegrationPool,
  createTestTenant,
  startIntegrationPostgres,
} from '@openverify/db/testing';
import {
  computeWebhookSignature,
  verifyWebhookSignature,
  WebhookSignatureError,
} from '@openverify/node';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createDbApiKeyAuthenticator } from '../auth/api-key-lookup.js';
import { createEventPublisher } from '../events/index.js';
import { createCapturingLogger, createRecordingQueue } from '../jobs/testing.js';
import { ulidIdGenerator } from '../ports.js';
import { createInMemoryFileStorage } from '../storage/index.js';
import {
  createAllowAllRateLimiter,
  createCapturingMailer,
  createFakeAccountsService,
  createRecordingAuditLogger,
  createRecordingQueue as createRecordingVerificationQueue,
  createRecordingRedactionService,
  fixedClock,
  phase5TestDependencies,
} from '../test-support/fakes.js';
import { DEFAULT_WEBHOOK_RETRY_POLICY, deliverWebhook } from './dispatcher.js';
import { createGuardedWebhookSender, type WebhookSender } from './http-sender.js';
import { createWebhookDeliveryScheduler, type WebhookDeliveryJob } from './queue.js';

const PEPPER = randomBytes(32);
const T0 = new Date('2026-10-20T12:00:00.000Z');
const keyring = createKeyring(randomBytes(32));
const clock = fixedClock(T0);
const queue = createRecordingQueue<WebhookDeliveryJob>();
const scheduler = createWebhookDeliveryScheduler(queue);
const logger = createCapturingLogger();

let postgres: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let db: Database;
let environmentId: string;
let token: string;
let app: ReturnType<typeof buildApp> | undefined;
let sender: WebhookSender | undefined;
let receiver: Server | undefined;
let receiverUrl: string;

interface Received {
  headers: IncomingMessage['headers'];
  body: string;
}
const received: Received[] = [];
/** Statuses the receiver answers with, in order; 204 once they run out. */
const answers: number[] = [];

function startReceiver(): Server {
  return createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received.push({ headers: request.headers, body: Buffer.concat(chunks).toString('utf8') });
      response.writeHead(answers.shift() ?? 204);
      response.end();
    });
  });
}

beforeAll(async () => {
  setDefaultKeyring(keyring);
  postgres = await startIntegrationPostgres();
  pool = createIntegrationPool(postgres.getConnectionUri());
  db = createDatabase(pool);
  await runMigrations(db);
  environmentId = (await createTestTenant(db)).environment.id;
  const generated = generateApiKey('sandbox', PEPPER);
  await createApiKey(db, environmentId, {
    id: newId('key'),
    name: 'Integration key',
    prefix: generated.prefix,
    secretHash: generated.secretHash,
    scopes: API_SCOPES,
  });
  token = generated.token;

  receiver = startReceiver();
  await new Promise<void>((resolve) => receiver?.listen(0, '127.0.0.1', resolve));
  receiverUrl = `http://127.0.0.1:${String((receiver.address() as AddressInfo).port)}/hooks`;
  sender = createGuardedWebhookSender({ policy: { allowPrivateNetworks: true } });

  const authenticator = createDbApiKeyAuthenticator({ db, pepper: PEPPER, clock });
  app = buildApp({
    lookupApiKey: authenticator.lookup,
    now: () => clock.now(),
    logger: false,
    mode: 'test',
    api: {
      db,
      keyring,
      storage: createInMemoryFileStorage(),
      events: createEventPublisher({ db, deliveries: scheduler }),
      queue: createRecordingVerificationQueue(),
      clock,
      ids: ulidIdGenerator,
      flowPublicUrl: 'https://flow.example.test',
      flowCorsOrigins: ['https://flow.example.test'],
      accounts: createFakeAccountsService(),
      redaction: createRecordingRedactionService(clock),
      audit: createRecordingAuditLogger(),
      rateLimiter: createAllowAllRateLimiter(clock),
      mailer: createCapturingMailer(),
      ...phase5TestDependencies(clock),
    },
  });
  await app.ready();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await sender?.close();
  receiver?.close();
  await pool?.end();
  await postgres?.stop();
  setDefaultKeyring(undefined);
});

beforeEach(() => {
  queue.jobs.length = 0;
  received.length = 0;
  answers.length = 0;
});

/** The value, which the test needs to exist. */
function required<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) {
    throw new Error(`expected a ${what}`);
  }
  return value;
}

function server() {
  if (app === undefined) throw new Error('the app did not start');
  return app;
}

async function call(method: 'GET' | 'POST', url: string, payload?: unknown) {
  const response = await server().inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  if (response.statusCode >= 300) {
    throw new Error(`${method} ${url}: ${String(response.statusCode)} ${response.body}`);
  }
  return response.json<unknown>();
}

async function createWebhook() {
  const document = await call('POST', '/api/v1/webhooks', {
    data: { type: 'webhook', attributes: { url: receiverUrl, 'enabled-events': ['*'] } },
  });
  return createdWebhookDocumentSchema.parse(document).data;
}

/** Publishes an inquiry event and returns its id and the delivery jobs it enqueued. */
async function publish(): Promise<{ eventId: string; jobs: WebhookDeliveryJob[] }> {
  const before = queue.jobs.length;
  const eventId = await createEventPublisher({ db, deliveries: scheduler }).publish({
    environmentId,
    name: 'inquiry.completed',
    payload: {
      data: buildInquiryResource({
        id: newId('inq'),
        status: 'completed',
        referenceId: 'ref-synthetic-integration',
        fields: { name_first: 'Synthetic' },
        inquiryTemplateId: newId('itmpl'),
        verifications: [],
        createdAt: clock.now(),
        updatedAt: clock.now(),
      }),
    },
  });
  return { eventId, jobs: queue.jobs.slice(before).map((job) => job.data) };
}

async function deliver(job: WebhookDeliveryJob) {
  if (sender === undefined) throw new Error('the sender did not start');
  return deliverWebhook(job, {
    db,
    sender,
    scheduler,
    clock,
    logger,
    retry: { ...DEFAULT_WEBHOOK_RETRY_POLICY, random: () => 0.5 },
  });
}

/** The jobs for one webhook: deliveries carry no webhook id, so look each up. */
async function jobsFor(webhookId: string, jobs: readonly WebhookDeliveryJob[]) {
  const mine: WebhookDeliveryJob[] = [];
  for (const job of jobs) {
    const { rows } = await required(pool, 'pool').query<{ webhook_id: string }>(
      'select webhook_id from webhook_deliveries where id = $1',
      [job.deliveryId],
    );
    if (rows[0]?.webhook_id === webhookId) mine.push(job);
  }
  return mine;
}

describe('C14 webhooks with Postgres 17 and a real receiver', () => {
  it('signs with both secrets during the rotation overlap, the new one first, then only the new one', async () => {
    clock.set(T0);
    const webhook = await createWebhook();
    const previous = webhook.attributes.secret;
    const rotation = rotateWebhookSecretDocumentSchema.parse(
      await call('POST', `/api/v1/webhooks/${webhook.id}/rotate-secret`, {
        meta: { 'previous-secret-expires-in-seconds': 3600 },
      }),
    );
    const current = rotation.data.attributes.secret;

    const [during] = await jobsFor(webhook.id, (await publish()).jobs);
    expect(await deliver(required(during, 'job'))).toMatchObject({ outcome: 'succeeded' });
    const [overlap] = received.splice(0);
    const header = overlap?.headers['openverify-signature'];
    const body = overlap?.body ?? '';
    const timestamp = T0.getTime() / 1000;
    expect(header).toBe(
      `t=${String(timestamp)},v1=${computeWebhookSignature(body, current, timestamp)} v1=${computeWebhookSignature(body, previous, timestamp)}`,
    );
    for (const secrets of [current, previous]) {
      expect(verifyWebhookSignature({ body, header, secrets, now: T0 })).toEqual({ timestamp });
    }
    expect(overlap?.headers['openverify-version']).toBe('2026-10-01');

    clock.set(new Date(T0.getTime() + 3_600_001));
    const [after] = await jobsFor(webhook.id, (await publish()).jobs);
    expect(await deliver(required(after, 'job'))).toMatchObject({ outcome: 'succeeded' });
    const [single] = received.splice(0);
    const now = clock.now();
    expect(
      verifyWebhookSignature({
        body: single?.body ?? '',
        header: single?.headers['openverify-signature'],
        secrets: current,
        now,
      }),
    ).toBeDefined();
    expect(() =>
      verifyWebhookSignature({
        body: single?.body ?? '',
        header: single?.headers['openverify-signature'],
        secrets: previous,
        now,
      }),
    ).toThrow(WebhookSignatureError);
  });

  it('replays a delivered event as a new delivery that reaches the receiver again', async () => {
    clock.set(T0);
    const webhook = await createWebhook();
    const { eventId, jobs } = await publish();
    const [original] = await jobsFor(webhook.id, jobs);
    await deliver(required(original, 'job'));
    received.length = 0;
    queue.jobs.length = 0;

    const replay = replayWebhookDocumentSchema.parse(
      await call('POST', `/api/v1/webhooks/${webhook.id}/replay`, {
        meta: { 'event-ids': [eventId] },
      }),
    );

    expect(replay.meta['replayed-count']).toBe(1);
    const [job] = queue.jobs.map((entry) => entry.data);
    expect(job?.deliveryId).not.toBe(original?.deliveryId);
    const { rows } = await required(pool, 'pool').query<{ id: string; is_replay: boolean }>(
      'select id, is_replay from webhook_deliveries where webhook_id = $1 order by is_replay',
      [webhook.id],
    );
    expect(rows).toEqual([
      { id: original?.deliveryId, is_replay: false },
      { id: job?.deliveryId, is_replay: true },
    ]);
    expect(await deliver(required(job, 'job'))).toMatchObject({ outcome: 'succeeded' });
    expect(received.map((delivery) => delivery.headers['openverify-event-id'])).toEqual([eventId]);

    // Both deliveries, newest first, one page each: the C1 cursor on Postgres.
    const first = webhookDeliveryListDocumentSchema.parse(
      await call('GET', `/api/v1/webhook-deliveries?filter[webhook-id]=${webhook.id}&page[size]=1`),
    );
    expect(first.data.map((delivery) => delivery.id)).toEqual([job?.deliveryId]);
    const second = webhookDeliveryListDocumentSchema.parse(
      await call('GET', required(first.links.next, 'next link')),
    );
    expect(second.data.map((delivery) => delivery.id)).toEqual([original?.deliveryId]);
    expect(second.links.next).toBeNull();
    expect(
      verifyWebhookSignature({
        body: received[0]?.body ?? '',
        header: received[0]?.headers['openverify-signature'],
        secrets: webhook.attributes.secret,
        now: T0,
      }),
    ).toBeDefined();
  });

  it('retries a failing delivery on the C14 schedule, measured with a fake clock', async () => {
    clock.set(T0);
    const webhook = await createWebhook();
    answers.push(500, 503);
    const [first] = await jobsFor(webhook.id, (await publish()).jobs);
    queue.jobs.length = 0;

    expect(await deliver(required(first, 'job'))).toEqual({
      outcome: 'retry',
      attempt: 1,
      status: 500,
      delayMs: 60_000,
    });
    clock.advance(60_000);
    const second = queue.jobs.at(-1)?.data;
    expect(await deliver(required(second, 'job'))).toEqual({
      outcome: 'retry',
      attempt: 2,
      status: 503,
      delayMs: 240_000,
    });
    clock.advance(240_000);
    const third = queue.jobs.at(-1)?.data;
    expect(await deliver(required(third, 'job'))).toMatchObject({
      outcome: 'succeeded',
      attempt: 3,
      status: 204,
    });

    expect(queue.jobs.map((job) => [job.data.attempt, job.options?.delay])).toEqual([
      [2, 60_000],
      [3, 240_000],
    ]);
    const delivery = webhookDeliveryDocumentSchema.parse(
      await call('GET', `/api/v1/webhook-deliveries/${String(first?.deliveryId)}`),
    );
    expect(delivery.data.attributes).toMatchObject({
      status: 'succeeded',
      'next-attempt-at': null,
      attempts: [
        { 'attempted-at': T0.toISOString(), 'response-status': 500 },
        { 'attempted-at': new Date(T0.getTime() + 60_000).toISOString(), 'response-status': 503 },
        { 'attempted-at': new Date(T0.getTime() + 300_000).toISOString(), 'response-status': 204 },
      ],
    });
    expect(received).toHaveLength(3);

    // The C9 creation range and status filters on Postgres.
    const listed = webhookDeliveryListDocumentSchema.parse(
      await call(
        'GET',
        `/api/v1/webhook-deliveries?filter[webhook-id]=${webhook.id}&filter[status]=succeeded,failed` +
          '&filter[created-at-start]=2000-01-01T00:00:00Z&filter[created-at-end]=2999-01-01T00:00:00Z',
      ),
    );
    expect(listed.data.map((entry) => entry.id)).toEqual([first?.deliveryId]);
    const none = webhookDeliveryListDocumentSchema.parse(
      await call(
        'GET',
        `/api/v1/webhook-deliveries?filter[webhook-id]=${webhook.id}&filter[created-at-end]=2000-01-01T00:00:00Z`,
      ),
    );
    expect(none.data).toEqual([]);
  });
});

/**
 * The worker against real services: Postgres 17 + pgvector and Valkey 9.1 (Testcontainers),
 * a stub vision service answering with the C6 golden fixtures, and a local webhook receiver.
 * Submitted verifications go through the BullMQ queue, the worker decides them, the inquiry
 * moves on, events are written and signed webhooks are delivered (private networks are
 * allowed here, as in development and test mode).
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  defaultInquiryTemplateAttributes,
  eventDocumentSchema,
  newId,
  newWebhookSecret,
} from '@openverify/contracts';
import {
  createDatabase,
  createFile,
  createInquiry,
  createInquirySession,
  createInquiryTemplate,
  createKeyring,
  createVerification,
  createWebhook,
  encryptBytes,
  faceTemplates,
  getInquiry,
  getSelfieCapture,
  getVerification,
  listEvents,
  recordInquirySessionConsent,
  runMigrations,
  setDefaultKeyring,
  setVerificationStatus,
  transitionInquiryStatus,
  writeFaceData,
  type Database,
  type FileKind,
} from '@openverify/db';
import { eq } from 'drizzle-orm';
import {
  createIntegrationPool,
  createTestTenant,
  startIntegrationPostgres,
} from '@openverify/db/testing';
import { verifyWebhookSignature } from '@openverify/node';
import type { Pool } from 'pg';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createVerificationQueue, type ClosableVerificationQueue } from './jobs/index.js';
import {
  WEBCAM_DEVICE,
  seedSubmittedCapture,
  threePoseAnalysis,
  unitVector,
} from './jobs/selfie-testing.js';
import {
  createCapturingLogger,
  createMemoryStorage,
  phase3SelfieTemplate,
} from './jobs/testing.js';
import { createVisionClient } from './vision/index.js';
import { createGuardedWebhookSender, type WebhookSender } from './webhooks/http-sender.js';
import { startWorkers, type RunningWorkers } from './worker.js';
import { VALKEY_TEST_IMAGE } from './test-support/integration-valkey.js';

const VALKEY_IMAGE = VALKEY_TEST_IMAGE;
const SERVICE_TOKEN = randomBytes(24).toString('hex');
// The centre-only passive selfie step with the three Phase 1 checks (the documented workaround
// for users who cannot turn their head); the C45.1 default has its own test below.
const defaults = phase3SelfieTemplate(defaultInquiryTemplateAttributes());
const keyring = createKeyring(randomBytes(32));
const storage = createMemoryStorage();
const logger = createCapturingLogger();

let postgres: StartedPostgreSqlContainer | undefined;
let valkey: StartedTestContainer | undefined;
let pool: Pool | undefined;
let db: Database;
let environmentId: string;
let workers: RunningWorkers | undefined;
let queue: ClosableVerificationQueue | undefined;
let sender: WebhookSender | undefined;
let vision: Server | undefined;
let receiver: Server | undefined;
let receiverUrl: string;
let webhookSecret: string;

// Stub vision service ----------------------------------------------------------

function fixtureText(name: string): string {
  const url = new URL(`../../../contracts/fixtures/vision/${name}.json`, import.meta.url);
  return readFileSync(url, 'utf8');
}

/** `match` answers with the fixture selfie (similarity 0.72); `mismatch` with another face. */
let selfieFace: 'match' | 'mismatch' = 'match';
/** `three-poses` answers a C45.1 three-pose capture (`threePoseAnalysis`). */
let selfieShape: 'golden' | 'three-poses' = 'golden';
/** `unreadable` answers the ID analysis as vision does for bytes it cannot decode (415). */
let governmentIdImage: 'readable' | 'unreadable' = 'readable';
const visionRequests: { path: string; fields: string[] }[] = [];

function selfieAnswer(): string {
  if (selfieShape === 'three-poses') {
    return JSON.stringify(threePoseAnalysis());
  }
  const analysis = JSON.parse(fixtureText('analyze-selfie')) as {
    poses: { center: { face: { embedding: number[] } } };
  };
  if (selfieFace === 'mismatch') {
    const other = JSON.parse(fixtureText('embed-face')) as { face: { embedding: number[] } };
    analysis.poses.center.face.embedding = other.face.embedding;
  }
  return JSON.stringify(analysis);
}

/**
 * C30.4: a stored ID front is re-embedded with `/v1/embed/face`. The recorded answer is the C32
 * golden ID portrait, as a re-embedding of that front gives.
 */
function embedAnswer(): string {
  const recorded = JSON.parse(fixtureText('embed-face')) as Record<string, unknown>;
  const governmentId = JSON.parse(fixtureText('analyze-government-id')) as {
    sides: { front: { portrait: unknown } };
  };
  return JSON.stringify({ ...recorded, face: governmentId.sides.front.portrait, face_count: 1 });
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}

function startVision(): Server {
  return createServer((request, response) => {
    void readBody(request).then((body) => {
      const fields = [...body.toString('latin1').matchAll(/name="([a-z0-9_-]+)"/g)].map(
        (match) => match[1] ?? '',
      );
      visionRequests.push({ path: request.url ?? '', fields });
      const multipart = (request.headers['content-type'] ?? '').startsWith('multipart/form-data');
      if (request.headers['x-service-token'] !== SERVICE_TOKEN || !multipart) {
        response.writeHead(401, { 'content-type': 'application/problem+json' });
        response.end('{"type":"about:blank","title":"Unauthorized","status":401}');
        return;
      }
      if (request.url === '/v1/analyze/government-id' && governmentIdImage === 'unreadable') {
        response.writeHead(415, { 'content-type': 'application/problem+json' });
        response.end('{"type":"about:blank","title":"Unsupported Media Type","status":415}');
        return;
      }
      const answer =
        request.url === '/v1/analyze/government-id'
          ? fixtureText('analyze-government-id')
          : request.url === '/v1/analyze/selfie'
            ? selfieAnswer()
            : request.url === '/v1/embed/face'
              ? embedAnswer()
              : request.url === '/v1/compare/background'
                ? JSON.stringify({
                    results: fields
                      .filter((field) => field.startsWith('candidate_'))
                      .map((_, index) => ({
                        index,
                        good_matches: 4,
                        inliers: 2,
                        inlier_ratio: 0.5,
                      })),
                  })
                : null;
      response.writeHead(answer === null ? 404 : 200, { 'content-type': 'application/json' });
      response.end(answer ?? '{}');
    });
  });
}

// Webhook receiver ---------------------------------------------------------------

interface Delivery {
  headers: IncomingMessage['headers'];
  body: string;
}
const deliveries: Delivery[] = [];

function startReceiver(): Server {
  return createServer((request, response) => {
    void readBody(request).then((body) => {
      deliveries.push({ headers: request.headers, body: body.toString('utf8') });
      response.writeHead(204);
      response.end();
    });
  });
}

// Setup ----------------------------------------------------------------------------

beforeAll(async () => {
  setDefaultKeyring(keyring);
  [postgres, valkey] = await Promise.all([
    startIntegrationPostgres(),
    new GenericContainer(VALKEY_IMAGE)
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start(),
  ]);
  pool = createIntegrationPool(postgres.getConnectionUri());
  db = createDatabase(pool);
  await runMigrations(db);
  environmentId = (await createTestTenant(db)).environment.id;

  vision = startVision();
  receiver = startReceiver();
  const visionUrl = await listen(vision);
  receiverUrl = `${await listen(receiver)}/hooks/openverify`;
  webhookSecret = newWebhookSecret();
  await createWebhook(db, environmentId, {
    id: newId('wbh'),
    url: receiverUrl,
    enabledEvents: ['*'],
    secret: webhookSecret,
  });

  const connection = { host: valkey.getHost(), port: valkey.getMappedPort(6379) };
  const prefix = `it-${randomBytes(4).toString('hex')}`;
  sender = createGuardedWebhookSender({ policy: { allowPrivateNetworks: true } });
  workers = startWorkers({
    connection,
    prefix,
    db,
    storage,
    keyring,
    vision: createVisionClient({ baseUrl: visionUrl, serviceToken: SERVICE_TOKEN }),
    sender,
    logger,
    concurrency: 4,
    sweepIntervalMs: 0,
  });
  queue = createVerificationQueue({ connection, prefix });
}, 180_000);

afterAll(async () => {
  await queue?.close();
  await workers?.close();
  await sender?.close();
  await pool?.end();
  vision?.close();
  receiver?.close();
  await Promise.all([postgres?.stop(), valkey?.stop()]);
  setDefaultKeyring(undefined);
});

// Data -----------------------------------------------------------------------------

async function pendingInquiry(
  attributes = defaults,
  referenceId = 'ref-synthetic-it',
): Promise<string> {
  const template = await createInquiryTemplate(db, environmentId, {
    id: newId('itmpl'),
    name: attributes.name,
    version: {
      id: newId('itmplv'),
      flow: attributes.flow,
      verificationConfig: attributes['verification-config'],
    },
  });
  const inquiry = await createInquiry(db, environmentId, {
    id: newId('inq'),
    inquiryTemplateId: template.id,
    inquiryTemplateVersionId: template.latestVersion.id,
    referenceId,
    fields: { name_first: 'Synthetic' },
  });
  await transitionInquiryStatus(db, environmentId, inquiry.id, { from: 'created', to: 'pending' });
  return inquiry.id;
}

/** A synthetic JPEG of `kind`, sealed and stored, for `verificationId`. */
async function submittedFile(verificationId: string, kind: FileKind): Promise<void> {
  const fileId = newId('file');
  const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...randomBytes(64)]);
  const sealed = encryptBytes(bytes, keyring, { context: fileId });
  const storageKey = `${environmentId}/${fileId}`;
  await storage.put(storageKey, sealed.ciphertext);
  await createFile(db, environmentId, {
    id: fileId,
    verificationId,
    kind,
    storageKey,
    mimeType: 'image/jpeg',
    byteSize: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    wrappedDek: sealed.wrappedDek,
  });
}

async function submitted(inquiryId: string, type: 'government_id' | 'selfie'): Promise<string> {
  const id = newId('ver');
  await createVerification(db, environmentId, { id, inquiryId, type });
  const kinds: FileKind[] = type === 'government_id' ? ['front', 'back'] : ['selfie-center'];
  for (const kind of kinds) {
    await submittedFile(id, kind);
  }
  await setVerificationStatus(db, environmentId, id, { to: 'submitted' });
  return id;
}

function producer(): ClosableVerificationQueue {
  if (queue === undefined) {
    throw new Error('the queue did not start');
  }
  return queue;
}

async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 45_000;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function eventNamesFor(resourceId: string): Promise<string[]> {
  const page = await listEvents(db, environmentId, { size: 100 });
  return page.items
    .filter((event) => (event.payload as { data: { id: string } }).data.id === resourceId)
    .map((event) => event.name)
    .sort();
}

/** Webhook deliveries of the events about `resourceId`, with verified signatures. */
function verifiedDeliveriesFor(resourceId: string) {
  return deliveries
    .map((delivery) => {
      verifyWebhookSignature({
        body: delivery.body,
        header: delivery.headers['openverify-signature'],
        secrets: webhookSecret,
      });
      return {
        headers: delivery.headers,
        document: eventDocumentSchema.parse(JSON.parse(delivery.body)),
      };
    })
    .filter(({ document }) => document.data.attributes.payload.data.id === resourceId);
}

// Tests ------------------------------------------------------------------------------

describe('worker with Postgres 17, Valkey 9.1 and a stub vision service', () => {
  it('passes both verifications, completes the inquiry and delivers signed webhooks', async () => {
    selfieFace = 'match';
    const inquiryId = await pendingInquiry();
    const governmentId = await submitted(inquiryId, 'government_id');
    const selfie = await submitted(inquiryId, 'selfie');

    await producer().enqueueProcessVerification({ environmentId, verificationId: governmentId });
    await producer().enqueueProcessVerification({ environmentId, verificationId: selfie });

    const inquiry = await eventually(
      () => getInquiry(db, environmentId, inquiryId),
      (value) => value?.status !== 'pending',
    );
    expect(inquiry?.status).toBe('completed');
    expect((await getVerification(db, environmentId, governmentId))?.status).toBe('passed');
    const selfieRow = await getVerification(db, environmentId, selfie);
    expect(selfieRow?.status).toBe('passed');
    expect(selfieRow?.checks.find((check) => check.name === 'selfie_id_comparison')).toMatchObject({
      status: 'passed',
      metadata: { similarity: 0.72, confidence_stage: 'beta' },
    });

    expect(await eventNamesFor(governmentId)).toEqual(['verification.passed']);
    expect(await eventNamesFor(selfie)).toEqual(['verification.passed']);
    expect((await eventNamesFor(inquiryId)).sort()).toEqual([
      'inquiry.completed',
      'inquiry.transitioned',
    ]);

    const delivered = await eventually(
      () => Promise.resolve(verifiedDeliveriesFor(inquiryId)),
      (value) => value.length >= 2,
    );
    expect(delivered.map((entry) => entry.document.data.attributes.name).sort()).toEqual([
      'inquiry.completed',
      'inquiry.transitioned',
    ]);
    const completed = delivered.find(
      (entry) => entry.document.data.attributes.name === 'inquiry.completed',
    );
    expect(completed?.headers).toMatchObject({
      'content-type': 'application/json',
      'user-agent': 'OpenVerify-Webhooks/1',
      'openverify-event-id': completed?.document.data.id,
    });
    expect(completed?.document.data.attributes).toMatchObject({
      name: 'inquiry.completed',
      payload: { data: { type: 'inquiry', id: inquiryId, attributes: { status: 'completed' } } },
    });
    const verificationDeliveries = await eventually(
      () =>
        Promise.resolve([...verifiedDeliveriesFor(governmentId), ...verifiedDeliveriesFor(selfie)]),
      (value) => value.length >= 2,
    );
    expect(verificationDeliveries).toHaveLength(2);

    // The receiver answers before the dispatcher records the attempt, so wait for the rows.
    const stored = await eventually(
      async () =>
        (
          await pool?.query<{ status: string; attempt_count: number }>(
            'select status, attempt_count from webhook_deliveries where environment_id = $1',
            [environmentId],
          )
        )?.rows ?? [],
      (rows) => rows.length === 4 && rows.every((row) => row.status !== 'pending'),
    );
    // Two verification.passed, inquiry.completed and inquiry.transitioned (C10).
    expect(stored).toEqual([
      { status: 'succeeded', attempt_count: 1 },
      { status: 'succeeded', attempt_count: 1 },
      { status: 'succeeded', attempt_count: 1 },
      { status: 'succeeded', attempt_count: 1 },
    ]);
    expect(visionRequests).toContainEqual({
      path: '/v1/analyze/government-id',
      fields: ['front', 'back'],
    });
    expect(visionRequests).toContainEqual({ path: '/v1/analyze/selfie', fields: ['center'] });
    // K101: the selfie job re-embeds the stored ID front as a document.
    expect(visionRequests).toContainEqual({ path: '/v1/embed/face', fields: ['image', 'subject'] });
  });

  it('fails the selfie of a different face and the inquiry, and says so by webhook', async () => {
    selfieFace = 'mismatch';
    const inquiryId = await pendingInquiry();
    const governmentId = await submitted(inquiryId, 'government_id');
    await producer().enqueueProcessVerification({ environmentId, verificationId: governmentId });
    await eventually(
      () => getVerification(db, environmentId, governmentId),
      (value) => value?.status === 'passed',
    );
    const selfie = await submitted(inquiryId, 'selfie');
    await producer().enqueueProcessVerification({ environmentId, verificationId: selfie });

    const inquiry = await eventually(
      () => getInquiry(db, environmentId, inquiryId),
      (value) => value?.status !== 'pending',
    );
    expect(inquiry?.status).toBe('failed');
    const selfieRow = await getVerification(db, environmentId, selfie);
    expect(selfieRow?.status).toBe('failed');
    expect(selfieRow?.checks.find((check) => check.name === 'selfie_id_comparison')).toMatchObject({
      status: 'failed',
      reasons: ['face_mismatch'],
    });
    const delivered = await eventually(
      () => Promise.resolve(verifiedDeliveriesFor(inquiryId)),
      (value) => value.length >= 2,
    );
    expect(delivered.map((entry) => entry.document.data.attributes.name).sort()).toEqual([
      'inquiry.failed',
      'inquiry.transitioned',
    ]);
  });

  it('processes a verification once however often it is enqueued', async () => {
    selfieFace = 'match';
    const inquiryId = await pendingInquiry();
    const governmentId = await submitted(inquiryId, 'government_id');
    const before = visionRequests.length;
    await Promise.all(
      [1, 2, 3].map(() =>
        producer().enqueueProcessVerification({ environmentId, verificationId: governmentId }),
      ),
    );
    await eventually(
      () => getVerification(db, environmentId, governmentId),
      (value) => value?.status === 'passed',
    );
    await producer().enqueueProcessVerification({ environmentId, verificationId: governmentId });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(visionRequests.length - before).toBe(1);
    expect(await eventNamesFor(governmentId)).toEqual(['verification.passed']);
  });

  it('fails an ID image vision cannot read with a retry hint and keeps the inquiry open', async () => {
    governmentIdImage = 'unreadable';
    try {
      const inquiryId = await pendingInquiry();
      const governmentId = await submitted(inquiryId, 'government_id');
      await producer().enqueueProcessVerification({ environmentId, verificationId: governmentId });

      const row = await eventually(
        () => getVerification(db, environmentId, governmentId),
        (value) => value?.status !== 'submitted',
      );
      expect(row?.status).toBe('failed');
      expect(row?.checks.find((check) => check.name === 'id_blur_detection')).toMatchObject({
        status: 'failed',
        type: 'user_behavior',
        reasons: ['image_unreadable'],
      });
      expect((await getInquiry(db, environmentId, inquiryId))?.status).toBe('pending');
      const delivered = await eventually(
        () => Promise.resolve(verifiedDeliveriesFor(governmentId)),
        (value) => value.length > 0,
      );
      expect(delivered.map((entry) => entry.document.data.attributes.name)).toEqual([
        'verification.failed',
      ]);
    } finally {
      governmentIdImage = 'readable';
    }
  });

  it('fails the verification and the inquiry when processing cannot finish', async () => {
    const inquiryId = await pendingInquiry();
    const governmentId = await submitted(inquiryId, 'government_id');
    for (const key of [...storage.objects.keys()]) {
      if (key.startsWith(`${environmentId}/`)) {
        storage.objects.delete(key);
      }
    }
    await producer().enqueueProcessVerification({ environmentId, verificationId: governmentId });

    const inquiry = await eventually(
      () => getInquiry(db, environmentId, inquiryId),
      (value) => value?.status !== 'pending',
    );
    expect(inquiry?.status).toBe('failed');
    expect(await getVerification(db, environmentId, governmentId)).toMatchObject({
      status: 'failed',
      checks: [],
    });
    expect(await eventNamesFor(governmentId)).toEqual(['verification.failed']);
    expect((await eventNamesFor(inquiryId)).sort()).toEqual([
      'inquiry.failed',
      'inquiry.transitioned',
    ]);
  });

  it('runs the C45.1 default: a three-pose capture through the vision client, a processed capture and a sealed template (C40.8, C42)', async () => {
    selfieShape = 'three-poses';
    try {
      const c451 = defaultInquiryTemplateAttributes();
      // Another account's selfie in the same room (another reference id, so another account), with
      // its template, for the background search.
      const elsewhere = await pendingInquiry(c451, 'ref-synthetic-it-other');
      const earlier = newId('ver');
      await createVerification(db, environmentId, {
        id: earlier,
        inquiryId: elsewhere,
        type: 'selfie',
      });
      await submittedFile(earlier, 'selfie-center');
      const layout = threePoseAnalysis().poses.center.background;
      await writeFaceData(db, environmentId, {
        verificationId: earlier,
        inquiryId: elsewhere,
        model: 'sface-2021dec',
        embedding: unitVector(77),
        background:
          layout === null
            ? null
            : { layout: layout.layout, validCells: layout.valid_cells, coverage: layout.coverage },
      });

      const inquiryId = await pendingInquiry(c451);
      const session = await createInquirySession(db, environmentId, {
        id: newId('iqse'),
        inquiryId,
        tokenHash: createHash('sha256').update(randomBytes(16)).digest('hex'),
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      await recordInquirySessionConsent(db, environmentId, session.id, {
        acceptedAt: new Date(Date.now() - 300_000),
        textKeys: ['consent.biometric', 'consent.processing'],
        optionalTextKeys: ['consent.biometric-matching'],
        locale: 'en',
        ip: null,
        userAgent: null,
      });
      const governmentId = await submitted(inquiryId, 'government_id');
      await setVerificationStatus(db, environmentId, governmentId, { to: 'passed' });
      const selfie = newId('ver');
      await createVerification(db, environmentId, { id: selfie, inquiryId, type: 'selfie' });
      const capture = await seedSubmittedCapture({ db, keyring, storage }, environmentId, {
        inquiryId,
        verificationId: selfie,
        createdAt: new Date(Date.now() - 60_000),
        device: WEBCAM_DEVICE,
      });
      await producer().enqueueProcessVerification({ environmentId, verificationId: selfie });

      const row = await eventually(
        () => getVerification(db, environmentId, selfie),
        (value) => value?.status !== 'submitted',
      );
      expect(row?.status).toBe('passed');
      expect(visionRequests).toContainEqual({
        path: '/v1/analyze/selfie',
        fields: ['center', 'left', 'right', 'source'],
      });
      expect(visionRequests).toContainEqual({
        path: '/v1/compare/background',
        fields: ['probe', 'candidate_0'],
      });
      expect(await getSelfieCapture(db, environmentId, capture.captureId)).toMatchObject({
        status: 'processed',
        hasDevice: false,
      });
      expect(await eventNamesFor(capture.captureId)).toEqual(['selfie.processed']);
      expect(
        await db
          .select({ id: faceTemplates.id })
          .from(faceTemplates)
          .where(eq(faceTemplates.verificationId, selfie)),
      ).toHaveLength(1);
    } finally {
      selfieShape = 'golden';
    }
  });

  it('never logged an embedding or an image', () => {
    const logged = JSON.stringify(logger.entries);
    expect(logged).not.toContain('embedding');
    const portrait = JSON.parse(fixtureText('analyze-government-id')) as {
      sides: { front: { portrait: { embedding: number[] } } };
    };
    expect(logged).not.toContain(String(portrait.sides.front.portrait.embedding[0]));
  });
});

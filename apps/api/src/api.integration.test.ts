/**
 * The Phase 1 HTTP path against real services: Postgres 17 + pgvector and RustFS (S3 API),
 * started with Testcontainers. The app is composed by `createContainer`, so the DB-backed API
 * key lookup, the S3 storage and the event publisher are the real ones; only the BullMQ queues
 * are recorded instead of sent to Valkey. Every value is synthetic.
 */
import { CreateBucketCommand, GetObjectCommand, NoSuchKey, S3Client } from '@aws-sdk/client-s3';
import {
  API_SCOPES,
  defaultInquiryTemplateAttributes,
  newId,
  resumeInquiryDocumentSchema,
} from '@openverify/contracts';
import {
  createApiKey,
  createEnvironment,
  createOrganization,
  decryptBytes,
  generateApiKey,
  getVerification,
  listEvents,
  listVerificationFiles,
  lockInquiry,
  runMigrations,
  setDefaultKeyring,
} from '@openverify/db';
import { startIntegrationPostgres, ifSet } from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
// The Phase 1-3 selfie step: one centre pose (C45.1 asks for three once the Phase 4 flow lands).
import { phase3SelfieTemplate } from './jobs/testing.js';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { advanceFlowInTx } from './flow-engine/advance.js';
import { createContainer, type Container } from './container.js';
import { createRecordingQueue } from './test-support/fakes.js';
import { syntheticEnv } from './test-support/env.js';
import { bearer, expectStatus, IMAGES, multipart } from './test-support/harness.js';
import {
  startIntegrationRustfs,
  type StartedIntegrationRustfs,
} from './test-support/integration-rustfs.js';

const S3 = {
  bucket: 'openverify-integration',
  accessKeyId: 'synthetic-integration-key',
  secretAccessKey: 'synthetic-integration-secret',
};
const PEPPER = 'synthetic-pepper-for-tests-0123456789abcdef';

let postgres: StartedPostgreSqlContainer;
let rustfs: StartedIntegrationRustfs;
let s3: S3Client;
let container: Container;
let app: ReturnType<Container['buildApp']>;
const queue = { ...createRecordingQueue(), close: () => Promise.resolve() };
const deliveries: { deliveryId: string }[] = [];

async function newTenant(): Promise<{ environmentId: string; token: string }> {
  const organization = await createOrganization(container.db, {
    id: newId('org'),
    name: 'Integration Test Org',
  });
  const environment = await createEnvironment(container.db, {
    id: newId('env'),
    organizationId: organization.id,
    kind: 'sandbox',
  });
  const key = generateApiKey('sandbox', new TextEncoder().encode(PEPPER));
  await createApiKey(container.db, environment.id, {
    id: newId('key'),
    name: 'Integration key',
    prefix: key.prefix,
    secretHash: key.secretHash,
    scopes: API_SCOPES,
  });
  return { environmentId: environment.id, token: key.token };
}

beforeAll(async () => {
  [postgres, rustfs] = await Promise.all([startIntegrationPostgres(), startIntegrationRustfs(S3)]);
  const { endpoint } = rustfs;
  s3 = new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: S3.accessKeyId, secretAccessKey: S3.secretAccessKey },
  });
  await s3.send(new CreateBucketCommand({ Bucket: S3.bucket }));

  const config = loadConfig(
    syntheticEnv({
      DATABASE_URL: postgres.getConnectionUri(),
      S3_ENDPOINT: endpoint,
      S3_BUCKET: S3.bucket,
      S3_ACCESS_KEY_ID: S3.accessKeyId,
      S3_SECRET_ACCESS_KEY: S3.secretAccessKey,
      OPENVERIFY_API_KEY_PEPPER: PEPPER,
      OPENVERIFY_BLIND_INDEX_KEY: Buffer.alloc(32, 9).toString('base64'),
    }),
  );
  container = createContainer(config, {
    verificationQueue: queue,
    webhookDeliveries: {
      scheduleDelivery: (job) => {
        deliveries.push(job);
        return Promise.resolve();
      },
      close: () => Promise.resolve(),
    },
  });
  await runMigrations(container.db);
  app = container.buildApp();
});

afterAll(async () => {
  await ifSet(app)?.close();
  await ifSet(container)?.close();
  ifSet(s3)?.destroy();
  await Promise.all([ifSet(postgres)?.stop(), ifSet(rustfs)?.stop()]);
  setDefaultKeyring(undefined);
});

/** A new tenant with a default-template inquiry, resumed and consented: the flow's headers. */
async function consentedFlowSession() {
  const { environmentId, token } = await newTenant();
  const server = bearer(token);
  const template = expectStatus(
    await app.inject({
      method: 'POST',
      url: '/api/v1/inquiry-templates',
      headers: server,
      payload: { data: { attributes: phase3SelfieTemplate(defaultInquiryTemplateAttributes()) } },
    }),
    201,
  );
  const inquiry = expectStatus(
    await app.inject({
      method: 'POST',
      url: '/api/v1/inquiries',
      headers: server,
      payload: { data: { attributes: { 'inquiry-template-id': template.data.id } } },
    }),
    201,
  );
  const resumed = resumeInquiryDocumentSchema.parse(
    expectStatus(
      await app.inject({
        method: 'POST',
        url: `/api/v1/inquiries/${inquiry.data.id}/resume`,
        headers: server,
      }),
      200,
    ),
  );
  const flow = bearer(resumed.meta['session-token']);
  expectStatus(
    await app.inject({
      method: 'POST',
      url: '/api/v1/flow/consent',
      headers: flow,
      payload: {
        accepted: true,
        'text-keys': ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
        locale: 'en',
      },
    }),
    201,
  );
  return { environmentId, inquiryId: inquiry.data.id, flow };
}

describe('Phase 1 HTTP path on Postgres 17 and RustFS', () => {
  it('creates an inquiry, resumes it, uploads both ID sides and a selfie, and submits', async () => {
    const { environmentId, token } = await newTenant();
    const server = bearer(token);

    const webhook = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      headers: server,
      payload: {
        data: {
          attributes: { url: 'https://hooks.example.test/openverify', 'enabled-events': ['*'] },
        },
      },
    });
    expectStatus(webhook, 201);

    const template = expectStatus(
      await app.inject({
        method: 'POST',
        url: '/api/v1/inquiry-templates',
        headers: server,
        payload: { data: { attributes: phase3SelfieTemplate(defaultInquiryTemplateAttributes()) } },
      }),
      201,
    );
    const inquiry = expectStatus(
      await app.inject({
        method: 'POST',
        url: '/api/v1/inquiries',
        headers: server,
        payload: {
          data: {
            attributes: {
              'inquiry-template-id': template.data.id,
              'reference-id': 'integration-user-1',
              fields: { name_first: 'Synthetic' },
            },
          },
        },
      }),
      201,
    );
    const inquiryId = inquiry.data.id;
    const resumed = resumeInquiryDocumentSchema.parse(
      expectStatus(
        await app.inject({
          method: 'POST',
          url: `/api/v1/inquiries/${inquiryId}/resume`,
          headers: server,
        }),
        200,
      ),
    );
    const flow = bearer(resumed.meta['session-token']);

    const session = await app.inject({ url: '/api/v1/flow/session', headers: flow });
    expect(session.json()).toMatchObject({ inquiry: { id: inquiryId, status: 'pending' } });
    expectStatus(
      await app.inject({
        method: 'POST',
        url: '/api/v1/flow/consent',
        headers: { ...flow, 'user-agent': 'SyntheticBrowser/1.0' },
        payload: {
          accepted: true,
          'text-keys': ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
          locale: 'en',
        },
      }),
      201,
    );

    const uploads: Record<string, Uint8Array> = {};
    async function verify(type: 'government-id' | 'selfie', files: Record<string, Uint8Array>) {
      const created = expectStatus(
        await app.inject({
          method: 'POST',
          url: '/api/v1/flow/verifications',
          headers: flow,
          payload: { type },
        }),
        201,
      );
      // C40.7: a selfie names its capture with every pose and at submit.
      const capture =
        type === 'selfie'
          ? expectStatus(
              await app.inject({
                method: 'POST',
                url: `/api/v1/flow/verifications/${created.data.id}/selfies`,
                headers: flow,
                payload: { method: 'camera' },
              }),
              201,
            ).data
          : null;
      const captureFields: Record<string, string> =
        capture === null
          ? {}
          : {
              'capture-id': capture.id,
              nonce: String(capture.attributes.nonce),
              'client-elapsed-ms': '1200',
            };
      for (const [kind, bytes] of Object.entries(files)) {
        const body = await multipart({
          kind,
          ...captureFields,
          file: { bytes, filename: 'capture.jpg' },
        });
        const file = expectStatus(
          await app.inject({
            method: 'POST',
            url: `/api/v1/flow/verifications/${created.data.id}/files`,
            headers: { ...flow, ...body.headers },
            payload: body.payload,
          }),
          201,
        );
        uploads[file.data.id] = bytes;
      }
      const submitted = expectStatus(
        await app.inject({
          method: 'POST',
          url: `/api/v1/flow/verifications/${created.data.id}/submit`,
          headers: flow,
          ...(capture === null
            ? {}
            : {
                payload: {
                  capture: { id: capture.id, nonce: String(capture.attributes.nonce) },
                },
              }),
        }),
        202,
      );
      expect(submitted.data.attributes.status).toBe('submitted');
      return created.data.id;
    }

    const governmentId = await verify('government-id', { front: IMAGES.jpeg, back: IMAGES.png });
    // C151.4 (Workflow 9A): the selfie step is current once the ID is decided; the worker's
    // decision is played here as it commits it (its status, and the flow's exit in its transaction).
    const advanced = await container.db.transaction(async (tx) => {
      await lockInquiry(tx, environmentId, inquiryId);
      await tx.execute(sql`update verifications set status = 'passed' where id = ${governmentId}`);
      return advanceFlowInTx(
        tx,
        { events: container.events, clock: container.clock },
        { environmentId, inquiryId },
        {
          kind: 'verification-decided',
          verificationId: governmentId,
          verificationType: 'government_id',
          status: 'passed',
          origin: 'flow',
        },
      );
    });
    await container.events.dispatch(advanced.staged);
    const selfie = await verify('selfie', { 'selfie-center': IMAGES.webp });

    expect(queue.jobs).toEqual([
      { environmentId, verificationId: governmentId },
      { environmentId, verificationId: selfie },
    ]);
    expect((await getVerification(container.db, environmentId, governmentId))?.status).toBe(
      'passed',
    );
    expect((await getVerification(container.db, environmentId, selfie))?.status).toBe('submitted');

    // Every image is in RustFS as ciphertext under a random key, and decrypts to the upload.
    const files = await listVerificationFiles(container.db, environmentId, [governmentId, selfie]);
    expect(files).toHaveLength(3);
    for (const file of files) {
      expect(file.storageKey.startsWith(`${environmentId}/`)).toBe(true);
      const object = await s3.send(
        new GetObjectCommand({ Bucket: S3.bucket, Key: file.storageKey }),
      );
      const ciphertext = await object.Body?.transformToByteArray();
      const plaintext = uploads[file.id] ?? new Uint8Array();
      expect(Buffer.from(ciphertext ?? []).includes(Buffer.from(plaintext))).toBe(false);
      const decrypted = decryptBytes(
        { wrappedDek: file.wrappedDek, ciphertext: ciphertext ?? new Uint8Array() },
        container.config.keyring,
        { context: file.id },
      );
      expect(new Uint8Array(decrypted)).toEqual(plaintext);
    }

    // The real publisher wrote each event and queued a delivery to the webhook. Phase 2 adds
    // the inquiry's new account (C13), the session's first call and the status change (C10);
    // Phase 4 the selfie capture's (C40.8).
    const events = await listEvents(container.db, environmentId, { size: 100 });
    expect(events.items.map((event) => event.name).sort()).toEqual([
      'account.created',
      'inquiry-session.started',
      'inquiry.created',
      'inquiry.started',
      'inquiry.transitioned',
      'selfie.created',
      'selfie.submitted',
      'verification.created',
      'verification.created',
      'verification.submitted',
      'verification.submitted',
    ]);
    // `account.created` is staged in the inquiry's transaction through the AccountsService port,
    // which has no after-commit hook: the worker's sweep enqueues its delivery (the C5 outbox).
    const enqueuedAtOnce = events.items.filter((event) => event.name !== 'account.created');
    expect(deliveries.length).toBeGreaterThanOrEqual(enqueuedAtOnce.length);

    const read = await app.inject({
      url: `/api/v1/inquiries/${inquiryId}?include=verifications`,
      headers: server,
    });
    expect(expectStatus(read, 200).included).toHaveLength(2);
  });

  it('replaces a re-uploaded kind and deletes the replaced object from RustFS', async () => {
    // K001: after a reload the flow uploads a kind again to the same initiated verification.
    const { environmentId, flow } = await consentedFlowSession();
    const verificationId = expectStatus(
      await app.inject({
        method: 'POST',
        url: '/api/v1/flow/verifications',
        headers: flow,
        payload: { type: 'government-id' },
      }),
      201,
    ).data.id;
    const uploadFront = async (bytes: Uint8Array) => {
      const body = await multipart({ kind: 'front', file: { bytes, filename: 'front.jpg' } });
      return app.inject({
        method: 'POST',
        url: `/api/v1/flow/verifications/${verificationId}/files`,
        headers: { ...flow, ...body.headers },
        payload: body.payload,
      });
    };

    const first = expectStatus(await uploadFront(IMAGES.jpeg), 201).data.id;
    const [firstFile] = await listVerificationFiles(container.db, environmentId, [verificationId]);
    const second = expectStatus(await uploadFront(IMAGES.png), 201).data.id;

    const files = await listVerificationFiles(container.db, environmentId, [verificationId]);
    expect(files.map((file) => [file.id, file.kind])).toEqual([[second, 'front']]);
    expect(first).not.toBe(second);
    await expect(
      s3.send(new GetObjectCommand({ Bucket: S3.bucket, Key: firstFile?.storageKey ?? '' })),
    ).rejects.toBeInstanceOf(NoSuchKey);
    const object = await s3.send(
      new GetObjectCommand({ Bucket: S3.bucket, Key: files[0]?.storageKey ?? '' }),
    );
    const decrypted = decryptBytes(
      {
        wrappedDek: files[0]?.wrappedDek ?? '',
        ciphertext: (await object.Body?.transformToByteArray()) ?? new Uint8Array(),
      },
      container.config.keyring,
      { context: second },
    );
    expect(new Uint8Array(decrypted)).toEqual(IMAGES.png);
  });

  it('starts one verification for parallel creates on the real database (F002, F012)', async () => {
    const { environmentId, inquiryId, flow } = await consentedFlowSession();

    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        app.inject({
          method: 'POST',
          url: '/api/v1/flow/verifications',
          headers: flow,
          // C151.4 (Workflow 9A): the current step's type, the ID after consent.
          payload: { type: 'government-id' },
        }),
      ),
    );

    const ids = responses.map((response) => expectStatus(response, 201).data.id);
    expect(new Set(ids).size).toBe(1);
    const stored = await getVerification(container.db, environmentId, ids[0] ?? '');
    expect(stored).toMatchObject({ inquiryId, type: 'government_id', status: 'initiated' });
    const created = (await listEvents(container.db, environmentId, { size: 100 })).items.filter(
      (event) => event.name === 'verification.created',
    );
    expect(created).toHaveLength(1);
  });

  it('keeps environments apart on the real database', async () => {
    const mine = await newTenant();
    const other = await newTenant();
    const template = expectStatus(
      await app.inject({
        method: 'POST',
        url: '/api/v1/inquiry-templates',
        headers: bearer(other.token),
        payload: { data: { attributes: phase3SelfieTemplate(defaultInquiryTemplateAttributes()) } },
      }),
      201,
    );

    const response = await app.inject({
      url: `/api/v1/inquiry-templates/${template.data.id}`,
      headers: bearer(mine.token),
    });

    expect(response.statusCode).toBe(404);
  });
});

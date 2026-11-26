/**
 * C13 and C16 against real services, started with Testcontainers: Postgres 17 + pgvector,
 * RustFS (S3 API) and Valkey. The API is composed by `createContainer`, so the accounts and
 * redaction services, the DB-backed audit logger, the event publisher and the S3 storage are
 * the real ones; only the verification and delivery queues are recorded. Every value is
 * synthetic.
 */
import { randomBytes } from 'node:crypto';
import {
  CreateBucketCommand,
  HeadObjectCommand,
  S3Client,
  type S3ServiceException,
} from '@aws-sdk/client-s3';
import {
  accountDocumentSchema,
  accountRelationListDocumentSchema,
  API_SCOPES,
  newId,
} from '@openverify/contracts';
import {
  accounts as accountsTable,
  addAccountRelation,
  auditLogs,
  createApiKey,
  createApiLog,
  createEnvironment,
  createInquiry,
  createInquiryTemplate,
  createOrganization,
  generateApiKey,
  getAccount,
  getApiLog,
  getInquiry,
  getInquirySession,
  inquiries,
  listEvents,
  runMigrations,
  setDefaultKeyring,
  transitionInquiryStatus,
  updateEnvironmentSettings,
} from '@openverify/db';
import { startIntegrationPostgres, ifSet } from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Queue } from 'bullmq';
import { and, asc, eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, type ApiConfig } from '../config.js';
import { createContainer, type Container } from '../container.js';
import { RETENTION_QUEUE, RETENTION_SCHEDULER_ID, startRetentionJob } from '../jobs/retention.js';
import { createRecordingQueue } from '../test-support/fakes.js';
import { syntheticEnv } from '../test-support/env.js';
import { bearer, expectStatus } from '../test-support/harness.js';
import {
  startIntegrationRustfs,
  type StartedIntegrationRustfs,
} from '../test-support/integration-rustfs.js';
import { createAccountsService } from './accounts.js';
import { isInquiryRedacted } from './redaction.js';
import { PII_MARKER, seedPiiSubject } from './redaction.test-support.js';
import { VALKEY_TEST_IMAGE } from '../test-support/integration-valkey.js';

const S3 = {
  bucket: 'openverify-lifecycle',
  accessKeyId: 'synthetic-integration-key',
  secretAccessKey: 'synthetic-integration-secret',
};
const PEPPER = 'synthetic-pepper-for-tests-0123456789abcdef';

let postgres: StartedPostgreSqlContainer;
let rustfs: StartedIntegrationRustfs;
let valkey: StartedTestContainer;
let s3: S3Client;
let config: ApiConfig;
let container: Container;
let app: ReturnType<Container['buildApp']>;

beforeAll(async () => {
  [postgres, rustfs, valkey] = await Promise.all([
    startIntegrationPostgres(),
    startIntegrationRustfs(S3),
    new GenericContainer(VALKEY_TEST_IMAGE)
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start(),
  ]);
  const { endpoint } = rustfs;
  s3 = new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: S3.accessKeyId, secretAccessKey: S3.secretAccessKey },
  });
  await s3.send(new CreateBucketCommand({ Bucket: S3.bucket }));
  config = loadConfig(
    syntheticEnv({
      DATABASE_URL: postgres.getConnectionUri(),
      REDIS_URL: `redis://${valkey.getHost()}:${String(valkey.getMappedPort(6379))}`,
      S3_ENDPOINT: endpoint,
      S3_BUCKET: S3.bucket,
      S3_ACCESS_KEY_ID: S3.accessKeyId,
      S3_SECRET_ACCESS_KEY: S3.secretAccessKey,
      OPENVERIFY_API_KEY_PEPPER: PEPPER,
      OPENVERIFY_BLIND_INDEX_KEY: Buffer.alloc(32, 9).toString('base64'),
    }),
  );
  container = createContainer(config, {
    verificationQueue: { ...createRecordingQueue(), close: () => Promise.resolve() },
    webhookDeliveries: {
      scheduleDelivery: () => Promise.resolve(),
      close: () => Promise.resolve(),
    },
  });
  await runMigrations(container.db);
  app = container.buildApp({ logger: false });
}, 180_000);

afterAll(async () => {
  await ifSet(app)?.close();
  await ifSet(container)?.close();
  ifSet(s3)?.destroy();
  await Promise.all([ifSet(postgres)?.stop(), ifSet(rustfs)?.stop(), ifSet(valkey)?.stop()]);
  setDefaultKeyring(undefined);
});

async function newTenant() {
  const organization = await createOrganization(container.db, {
    id: newId('org'),
    name: 'Lifecycle Test Org',
  });
  const environment = await createEnvironment(container.db, {
    id: newId('env'),
    organizationId: organization.id,
    kind: 'sandbox',
  });
  const key = generateApiKey('sandbox', new TextEncoder().encode(PEPPER));
  await createApiKey(container.db, environment.id, {
    id: newId('key'),
    name: 'Lifecycle key',
    prefix: key.prefix,
    secretHash: key.secretHash,
    scopes: API_SCOPES,
  });
  return { organizationId: organization.id, environmentId: environment.id, token: key.token };
}

async function newAccount(token: string, attributes: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/accounts',
    headers: bearer(token),
    payload: { data: { type: 'account', attributes } },
  });
  return accountDocumentSchema.parse(expectStatus(response, 201)).data;
}

async function seedInquiry(environmentId: string, accountId: string) {
  const template = await createInquiryTemplate(container.db, environmentId, {
    id: newId('itmpl'),
    name: 'Synthetic template',
    version: { id: newId('itmplv'), flow: {}, verificationConfig: {} },
  });
  return (
    await createInquiry(container.db, environmentId, {
      id: newId('inq'),
      inquiryTemplateId: template.id,
      inquiryTemplateVersionId: template.currentVersion.id,
      accountId,
    })
  ).id;
}

async function objectStatus(key: string): Promise<number> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: S3.bucket, Key: key }));
    return 200;
  } catch (error) {
    return (error as S3ServiceException).$metadata.httpStatusCode ?? 0;
  }
}

async function auditActions(environmentId: string, resourceId: string): Promise<string[]> {
  const rows = await container.db
    .select({ action: auditLogs.action })
    .from(auditLogs)
    .where(and(eq(auditLogs.environmentId, environmentId), eq(auditLogs.resourceId, resourceId)))
    .orderBy(asc(auditLogs.id));
  return rows.map((row) => row.action);
}

describe('accounts on Postgres 17 (C13)', () => {
  it('consolidates accounts in one transaction and records the audit entries', async () => {
    const { environmentId, token } = await newTenant();
    const target = await newAccount(token, { fields: { name_first: 'Jane' }, tags: ['vip'] });
    const source = await newAccount(token, {
      fields: { name_first: 'Janet', name_last: 'Sample' },
      tags: ['returning'],
    });
    const other = await newAccount(token);
    const moved = await seedInquiry(environmentId, source.id);
    await addAccountRelation(container.db, environmentId, {
      fromAccountId: source.id,
      toAccountId: other.id,
      relationType: 'spouse',
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/accounts/${target.id}/consolidate`,
      headers: bearer(token),
      payload: { meta: { 'source-account-ids': [source.id] } },
    });

    const merged = accountDocumentSchema.parse(expectStatus(response, 200)).data;
    expect(merged.attributes.fields).toEqual({ name_first: 'Jane', name_last: 'Sample' });
    expect(merged.attributes.tags).toEqual(['vip', 'returning']);
    expect((await getInquiry(container.db, environmentId, moved))?.accountId).toBe(target.id);
    expect(await getAccount(container.db, environmentId, source.id)).toMatchObject({
      status: 'archived',
      consolidatedInto: target.id,
    });
    const relations = accountRelationListDocumentSchema.parse(
      expectStatus(
        await app.inject({
          url: `/api/v1/accounts/${target.id}/relations`,
          headers: bearer(token),
        }),
        200,
      ),
    ).data;
    expect(relations.map((relation) => relation['related-account'].id)).toEqual([other.id]);
    expect(await auditActions(environmentId, target.id)).toEqual([
      'account.created',
      'account.consolidated',
    ]);
    expect(await auditActions(environmentId, source.id)).toEqual([
      'account.created',
      'account.consolidated-with',
    ]);
    const events = await listEvents(container.db, environmentId, {
      name: ['account.consolidated', 'account.consolidated-with'],
    });
    expect(events.items.map((event) => event.objectId).sort()).toEqual(
      [target.id, source.id].sort(),
    );
  });

  it.each(['account-id', 'reference-id'] as const)(
    'waits for an in-flight consolidation and resolves the %s to the absorbing account (2B F012, F020)',
    async (by) => {
      const { organizationId, environmentId, token } = await newTenant();
      const referenceId = `ref-${newId('acc')}`;
      const source = await newAccount(token, { 'reference-id': referenceId });
      const target = await newAccount(token);
      const accounts = createAccountsService({ events: container.events });
      const ctx = { organizationId, environmentId };
      let resolving: Promise<string> | undefined;

      // A consolidation of the source into the target that has locked and changed the source
      // but not committed yet, as consolidateAccounts does in its transaction.
      await container.db.transaction(async (consolidation) => {
        await consolidation
          .select({ id: accountsTable.id })
          .from(accountsTable)
          .where(eq(accountsTable.id, source.id))
          .for('update');
        await consolidation
          .update(accountsTable)
          .set({ status: 'archived', consolidatedInto: target.id })
          .where(eq(accountsTable.id, source.id));
        resolving = container.db.transaction((tx) =>
          accounts.resolveForInquiry(
            tx,
            ctx,
            by === 'account-id' ? { accountId: source.id } : { referenceId },
          ),
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
      });

      expect(await resolving).toBe(target.id);
    },
  );

  it('locks both accounts of add-relation, so it cannot relate to an account consolidated meanwhile (2B F013)', async () => {
    const { token } = await newTenant();
    const [account, related, target] = [
      await newAccount(token),
      await newAccount(token),
      await newAccount(token),
    ];
    let adding: Promise<Awaited<ReturnType<typeof app.inject>>> | undefined;

    await container.db.transaction(async (consolidation) => {
      await consolidation
        .select({ id: accountsTable.id })
        .from(accountsTable)
        .where(eq(accountsTable.id, related.id))
        .for('update');
      await consolidation
        .update(accountsTable)
        .set({ status: 'archived', consolidatedInto: target.id })
        .where(eq(accountsTable.id, related.id));
      adding = Promise.resolve(
        app.inject({
          method: 'POST',
          url: `/api/v1/accounts/${account.id}/add-relation`,
          headers: bearer(token),
          payload: { meta: { 'related-account-id': related.id, 'relation-type': 'spouse' } },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    const response = await adding;
    expect(response?.statusCode, response?.body).toBe(409);
  });

  it('resolves concurrent inquiries with one reference id to one account', async () => {
    const { organizationId, environmentId } = await newTenant();
    const accounts = createAccountsService({ events: container.events });
    const ctx = { organizationId, environmentId };

    const resolved = await Promise.all(
      Array.from({ length: 8 }, () =>
        container.db.transaction((tx) =>
          accounts.resolveForInquiry(tx, ctx, { referenceId: 'ref-race' }),
        ),
      ),
    );

    expect(new Set(resolved).size).toBe(1);
    const created = await listEvents(container.db, environmentId, { name: 'account.created' });
    expect(created.items.map((event) => event.objectId)).toEqual([resolved[0]]);
  });
});

describe('redaction against RustFS (C16)', () => {
  it('deletes the stored files and every copy of the PII when an account is redacted', async () => {
    const { environmentId, token } = await newTenant();
    const subject = await seedPiiSubject({
      db: container.db,
      storage: container.storage,
      keyring: config.keyring,
      environmentId,
    });
    for (const key of subject.storageKeys) {
      expect(await objectStatus(key)).toBe(200);
    }

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/accounts/${subject.accountId}/redact`,
      headers: bearer(token),
    });

    const redacted = accountDocumentSchema.parse(expectStatus(response, 200)).data;
    expect(redacted.attributes.fields).toEqual({});
    for (const key of subject.storageKeys) {
      expect(await objectStatus(key)).toBe(404);
    }
    const copies = JSON.stringify([
      await getAccount(container.db, environmentId, subject.accountId),
      await getInquiry(container.db, environmentId, subject.inquiryId),
      await getInquirySession(container.db, environmentId, subject.sessionId),
      (await listEvents(container.db, environmentId, { size: 100 })).items,
      await Promise.all(subject.apiLogIds.map((id) => getApiLog(container.db, environmentId, id))),
    ]);
    expect(copies).not.toContain(PII_MARKER);
    expect(await auditActions(environmentId, subject.accountId)).toEqual(['account.redacted']);
    expect(await auditActions(environmentId, subject.inquiryId)).toEqual(['inquiry.redacted']);
  });
});

describe('the retention job on Valkey (C16)', () => {
  it('redacts an old inquiry and deletes old API logs on schedule, with an injected clock', async () => {
    const { environmentId } = await newTenant();
    await updateEnvironmentSettings(container.db, environmentId, {
      'inquiry-retention-days': 1,
      'api-log-retention-days': 1,
    });
    const subject = await seedPiiSubject({
      db: container.db,
      storage: container.storage,
      keyring: config.keyring,
      environmentId,
    });
    await transitionInquiryStatus(container.db, environmentId, subject.inquiryId, {
      from: 'created',
      to: 'expired',
    });
    const log = await createApiLog(container.db, environmentId, {
      id: newId('alog'),
      method: 'GET',
      path: '/api/v1/inquiries',
      status: 200,
      durationMs: 1,
    });
    const logged: { message: string; object: Record<string, unknown> }[] = [];
    const record = (object: Record<string, unknown>, message: string) => {
      logged.push({ object, message });
    };
    const connection = { host: valkey.getHost(), port: valkey.getMappedPort(6379) };
    const prefix = `it-${randomBytes(4).toString('hex')}`;
    const later = new Date(Date.now() + 10 * 86_400_000);

    const job = startRetentionJob({
      connection,
      prefix,
      db: container.db,
      storage: container.storage,
      logger: { info: record, warn: record, error: record },
      clock: { now: () => later },
      schedule: { every: 1_000 },
    });
    await job.ready;
    try {
      const deadline = Date.now() + 60_000;
      while (!(await isInquiryRedacted(container.db, environmentId, subject.inquiryId))) {
        if (Date.now() > deadline) {
          throw new Error(`retention did not run: ${JSON.stringify(logged)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      for (const key of subject.storageKeys) {
        await expect.poll(() => objectStatus(key), { timeout: 30_000 }).toBe(404);
      }
      await expect
        .poll(() => getApiLog(container.db, environmentId, log.id), { timeout: 30_000 })
        .toBeNull();
      const inquiry = await container.db
        .select({ fields: inquiries.fields })
        .from(inquiries)
        .where(eq(inquiries.id, subject.inquiryId));
      expect(JSON.stringify(inquiry)).not.toContain(PII_MARKER);
      const queue = new Queue(RETENTION_QUEUE, { connection, prefix });
      try {
        expect(await queue.getJobScheduler(RETENTION_SCHEDULER_ID)).toMatchObject({
          key: RETENTION_SCHEDULER_ID,
          every: 1_000,
        });
      } finally {
        await queue.close();
      }
    } finally {
      await job.close();
    }
  });
});

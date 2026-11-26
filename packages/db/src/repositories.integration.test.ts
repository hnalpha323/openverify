/**
 * One round trip per repository against real Postgres 17 + pgvector (Testcontainers),
 * plus the behaviour PGlite cannot show: row locks seen from two connections.
 */
import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateApiKey } from './api-keys.js';
import { createDatabase, type Database } from './client.js';
import { createKeyring, decryptBytes, encryptBytes, setDefaultKeyring } from './crypto.js';
import { pgErrorCode } from './errors.js';
import { runMigrations } from './migrate.js';
import {
  appendAuditLog,
  createApiKey,
  createEnvironment,
  createEvent,
  createFile,
  createInquiry,
  createInquirySession,
  createInquiryTemplate,
  createInquiryTemplateVersion,
  createOrganization,
  createUser,
  createUserSession,
  createVerification,
  createWebhook,
  createWebhookDelivery,
  findActiveInquirySessionByTokenHash,
  findActiveUserSessionByTokenHash,
  findApiKeyBySecretHash,
  findUserByEmail,
  getEvent,
  getFile,
  getInquiry,
  getInquiryTemplate,
  getLatestInquiryConsent,
  getVerification,
  getWebhookSigningSecret,
  listAuditLogs,
  listDueWebhookDeliveries,
  listInquiries,
  listInquiryTemplates,
  listWebhooksForEvent,
  recordInquirySessionConsent,
  recordWebhookDeliveryAttempt,
  replaceVerificationChecks,
  replaceVerificationFile,
  resolveInquiryAccount,
  listVerificationFiles,
  revokeApiKey,
  setVerificationStatus,
  touchApiKeyLastUsed,
  transitionInquiryStatus,
} from './repositories/index.js';
import { auditLogs, inquiries, organizations } from './schema.js';
import { hashSessionToken } from './tokens.js';
import { createIntegrationPool, testId, startIntegrationPostgres } from './testing.js';

// Synthetic secrets generated per run.
const pepper = randomBytes(32);
const keyring = createKeyring(randomBytes(32));
const ARGON2 = '$argon2id$v=19$m=19456,t=2,p=1$c3ludGhldGljc2FsdA$c3ludGhldGljaGFzaA';

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let db: Database;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri());
  db = createDatabase(pool);
  await runMigrations(db);
  setDefaultKeyring(keyring);
});

afterAll(async () => {
  setDefaultKeyring(undefined);
  await pool?.end();
  await container?.stop();
});

async function tenant() {
  const organization = await createOrganization(db, { id: testId('org'), name: 'Example Org' });
  const environment = await createEnvironment(db, {
    id: testId('env'),
    organizationId: organization.id,
    kind: 'sandbox',
  });
  return { organization, environment };
}

async function inquiryIn(environmentId: string, fields: Record<string, unknown> = {}) {
  const template = await createInquiryTemplate(db, environmentId, {
    id: testId('itmpl'),
    name: 'KYC',
    version: { id: testId('itmplv'), flow: { steps: [] }, verificationConfig: {} },
  });
  const inquiry = await createInquiry(db, environmentId, {
    id: testId('inq'),
    inquiryTemplateId: template.id,
    inquiryTemplateVersionId: template.latestVersion.id,
    referenceId: 'customer-7',
    fields,
  });
  return { template, inquiry };
}

describe('repositories on Postgres 17', () => {
  it('migrates to schema v1 with pgvector installed', async () => {
    const extensions = await db.execute<{ extname: string }>(
      sql`select extname from pg_extension where extname = 'vector'`,
    );
    const version = await db.execute<{ server_version: string }>(sql`show server_version`);

    expect(extensions.rows).toEqual([{ extname: 'vector' }]);
    expect(version.rows[0]?.server_version).toMatch(/^17\./);
  });

  it('organizations, environments and API keys', async () => {
    const { environment } = await tenant();
    const generated = generateApiKey('sandbox', pepper);
    const apiKey = await createApiKey(db, environment.id, {
      id: testId('key'),
      name: 'Server',
      prefix: generated.prefix,
      secretHash: generated.secretHash,
      scopes: ['inquiries:write'],
      allowedIps: ['192.0.2.0/24'],
    });

    expect((await findApiKeyBySecretHash(db, generated.secretHash))?.apiKey).toEqual(apiKey);
    expect(await touchApiKeyLastUsed(db, environment.id, apiKey.id)).toBe(true);
    expect((await revokeApiKey(db, environment.id, apiKey.id))?.revokedAt).toBeInstanceOf(Date);
  });

  it('users and user sessions', async () => {
    const { organization, environment } = await tenant();
    const user = await createUser(db, {
      id: testId('usr'),
      organizationId: organization.id,
      email: 'Admin@Example.TEST',
      passwordHash: ARGON2,
    });
    const tokenHash = hashSessionToken(`ovu_${testId('uss')}`);
    const session = await createUserSession(db, {
      id: testId('uss'),
      organizationId: organization.id,
      userId: user.id,
      environmentId: environment.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    expect(await findUserByEmail(db, organization.id, 'admin@example.test')).toEqual(user);
    expect(await findActiveUserSessionByTokenHash(db, tokenHash)).toEqual({ session, user });
  });

  it('inquiry templates and versions', async () => {
    const { environment } = await tenant();
    const { template } = await inquiryIn(environment.id);
    const second = await createInquiryTemplateVersion(db, environment.id, template.id, {
      id: testId('itmplv'),
      flow: { steps: ['consent'] },
      verificationConfig: {},
    });

    expect((await getInquiryTemplate(db, environment.id, template.id))?.latestVersion).toEqual(
      second,
    );
    expect((await listInquiryTemplates(db, environment.id)).items).toHaveLength(1);
  });

  it('inquiries: encrypted fields, filters and optimistic transitions', async () => {
    const { environment } = await tenant();
    const { inquiry } = await inquiryIn(environment.id, { 'name-first': 'Jane' });
    const raw = await db.execute<{ fields: string }>(
      sql`select fields from inquiries where id = ${inquiry.id}`,
    );

    const started = await transitionInquiryStatus(db, environment.id, inquiry.id, {
      from: 'created',
      to: 'pending',
    });
    const stale = await transitionInquiryStatus(db, environment.id, inquiry.id, {
      from: 'created',
      to: 'pending',
    });

    expect(raw.rows[0]?.fields).toMatch(/^ov1\./);
    expect((await getInquiry(db, environment.id, inquiry.id))?.fields).toEqual({
      'name-first': 'Jane',
    });
    expect(started?.startedAt).toBeInstanceOf(Date);
    expect(stale).toBeNull();
    expect(
      (await listInquiries(db, environment.id, { status: 'pending', referenceId: 'customer-7' }))
        .items,
    ).toHaveLength(1);
  });

  it('inquiry sessions and consent', async () => {
    const { environment } = await tenant();
    const { inquiry } = await inquiryIn(environment.id);
    const tokenHash = hashSessionToken(`ovs_${testId('iqse')}`);
    const session = await createInquirySession(db, environment.id, {
      id: testId('iqse'),
      inquiryId: inquiry.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const consent = {
      acceptedAt: new Date('2026-10-20T10:00:00.000Z'),
      textKeys: ['consent.biometric'],
      locale: 'en',
      ip: '203.0.113.77',
      userAgent: 'SyntheticBrowser/3.0',
    };

    await recordInquirySessionConsent(db, environment.id, session.id, consent);
    const raw = await db.execute<{ consent: unknown }>(
      sql`select consent from inquiry_sessions where id = ${session.id}`,
    );

    expect((await findActiveInquirySessionByTokenHash(db, tokenHash))?.consent).toEqual(consent);
    expect(await getLatestInquiryConsent(db, environment.id, inquiry.id)).toEqual(consent);
    expect(JSON.stringify(raw.rows[0]?.consent)).not.toContain('203.0.113.77');
  });

  it('verifications, checks and files', async () => {
    const { environment } = await tenant();
    const { inquiry } = await inquiryIn(environment.id);
    const verification = await createVerification(db, environment.id, {
      id: testId('ver'),
      inquiryId: inquiry.id,
      type: 'government_id',
    });
    await replaceVerificationChecks(db, environment.id, verification.id, [
      {
        name: 'id_glare_detection',
        status: 'passed',
        type: 'user_behavior',
        requirement: 'required',
        metadata: { glare_ratio: 0.01 },
      },
    ]);
    await setVerificationStatus(db, environment.id, verification.id, { to: 'submitted' });
    const fileId = testId('file');
    const plaintext = randomBytes(64);
    const sealed = encryptBytes(plaintext, keyring, { context: fileId });
    await createFile(db, environment.id, {
      id: fileId,
      verificationId: verification.id,
      kind: 'front',
      storageKey: `${environment.id}/${fileId}`,
      mimeType: 'image/png',
      byteSize: plaintext.length,
      sha256: createHash('sha256').update(plaintext).digest('hex'),
      wrappedDek: sealed.wrappedDek,
    });

    const read = await getVerification(db, environment.id, verification.id);
    const file = await getFile(db, environment.id, fileId);

    expect(read?.status).toBe('submitted');
    expect(read?.checks.map((check) => check.metadata)).toEqual([{ glare_ratio: 0.01 }]);
    expect(
      decryptBytes({ wrappedDek: file?.wrappedDek ?? '', ciphertext: sealed.ciphertext }, keyring, {
        context: fileId,
      }).equals(plaintext),
    ).toBe(true);
  });

  it('serializes concurrent uploads of one kind and refuses them once submitted', async () => {
    const { environment } = await tenant();
    const { inquiry } = await inquiryIn(environment.id);
    const verification = await createVerification(db, environment.id, {
      id: testId('ver'),
      inquiryId: inquiry.id,
      type: 'government_id',
    });
    const front = () => {
      const id = testId('file');
      const plaintext = randomBytes(64);
      return {
        id,
        verificationId: verification.id,
        kind: 'front' as const,
        storageKey: `${environment.id}/${id}`,
        mimeType: 'image/jpeg',
        byteSize: plaintext.length,
        sha256: createHash('sha256').update(plaintext).digest('hex'),
        wrappedDek: encryptBytes(plaintext, keyring, { context: id }).wrappedDek,
      };
    };

    // Each call runs in its own transaction on its own pool connection.
    const results = await Promise.all(
      Array.from({ length: 6 }, () => replaceVerificationFile(db, environment.id, front())),
    );
    const stored = await listVerificationFiles(db, environment.id, [verification.id]);
    await setVerificationStatus(db, environment.id, verification.id, { to: 'submitted' });
    const late = await replaceVerificationFile(db, environment.id, front());

    expect(results.every((result) => result !== null)).toBe(true);
    expect(stored).toHaveLength(1);
    expect(results.flatMap((result) => result?.replaced ?? [])).toHaveLength(5);
    expect(late).toBeNull();
    expect(await listVerificationFiles(db, environment.id, [verification.id])).toEqual(stored);
  });

  it('events, webhooks and deliveries', async () => {
    const { environment } = await tenant();
    const event = await createEvent(db, environment.id, {
      id: testId('evt'),
      name: 'inquiry.completed',
      payload: { data: { type: 'inquiry' } },
    });
    const webhook = await createWebhook(db, environment.id, {
      id: testId('wbh'),
      url: 'https://hooks.example.test/a',
      enabledEvents: ['*'],
      secret: 'wbhsec_synthetic_secret_abcd',
    });
    const delivery = await createWebhookDelivery(db, environment.id, {
      id: testId('whd'),
      webhookId: webhook.id,
      eventId: event.id,
    });

    const recorded = await recordWebhookDeliveryAttempt(db, environment.id, delivery?.id ?? '', {
      outcome: 'succeeded',
      attemptedAt: new Date(),
      responseStatus: 200,
      durationMs: 15,
    });

    expect((await getEvent(db, environment.id, event.id))?.payload).toEqual({
      data: { type: 'inquiry' },
    });
    expect((await listWebhooksForEvent(db, environment.id, event.name)).map((w) => w.id)).toEqual([
      webhook.id,
    ]);
    expect(await getWebhookSigningSecret(db, environment.id, webhook.id)).toBe(
      'wbhsec_synthetic_secret_abcd',
    );
    expect(recorded).toMatchObject({ status: 'succeeded', attemptCount: 1 });
  });

  it('hands each due delivery to only one worker at a time (FOR UPDATE SKIP LOCKED)', async () => {
    const { environment } = await tenant();
    const webhook = await createWebhook(db, environment.id, {
      id: testId('wbh'),
      url: 'https://hooks.example.test/b',
      enabledEvents: ['*'],
      secret: 'wbhsec_synthetic_secret_efgh',
    });
    const ids: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const event = await createEvent(db, environment.id, {
        id: testId('evt'),
        name: 'inquiry.created',
        payload: {},
      });
      const delivery = await createWebhookDelivery(db, environment.id, {
        id: testId('whd'),
        webhookId: webhook.id,
        eventId: event.id,
        nextAttemptAt: new Date('2001-01-01T00:00:00.000Z'),
      });
      ids.push(delivery?.id ?? '');
    }
    const now = new Date('2001-01-02T00:00:00.000Z');

    const [claimedByFirst, claimedBySecond] = await db.transaction(async (first) => {
      const firstBatch = await listDueWebhookDeliveries(first, { now, lock: true, limit: 1000 });
      // A second connection, while the first transaction still holds its row locks.
      const secondBatch = await db.transaction((second) =>
        listDueWebhookDeliveries(second, { now, lock: true, limit: 1000 }),
      );
      return [firstBatch, secondBatch];
    });

    expect(claimedByFirst.map((delivery) => delivery.id)).toEqual(expect.arrayContaining(ids));
    expect(claimedBySecond.map((delivery) => delivery.id).filter((id) => ids.includes(id))).toEqual(
      [],
    );
  });

  it('audit logs: appended, listed, never updated', async () => {
    const { environment } = await tenant();
    const entry = await appendAuditLog(db, environment.id, {
      actorType: 'user',
      actorId: testId('usr'),
      action: 'file.viewed',
      resourceType: 'file',
      resourceId: testId('file'),
      ip: '198.51.100.9',
    });

    let updateError: unknown;
    try {
      await db.update(auditLogs).set({ action: 'file.changed' }).where(eq(auditLogs.id, entry.id));
    } catch (error) {
      updateError = error;
    }

    expect(await listAuditLogs(db, environment.id)).toEqual([entry]);
    expect(pgErrorCode(updateError)).toBe('P0001');
  });

  it('pages without gaps across rows that share created_at', async () => {
    const { environment } = await tenant();
    const { template } = await inquiryIn(environment.id);
    const ids = Array.from({ length: 7 }, () => testId('inq'));
    // Schema v2: direct inserts name the inquiry's account (C13).
    const accountId = (await resolveInquiryAccount(db, environment.id, {})) ?? '';
    // One transaction, so now() and therefore created_at are identical for every row.
    await db.transaction(async (tx) => {
      for (const id of ids) {
        await tx.insert(inquiries).values({
          id,
          environmentId: environment.id,
          inquiryTemplateId: template.id,
          inquiryTemplateVersionId: template.latestVersion.id,
          accountId,
          fields: {},
        });
      }
    });

    const seen: string[] = [];
    let after: string | undefined;
    do {
      const page = await listInquiries(db, environment.id, { size: 3, after });
      seen.push(...page.items.map((item) => item.id));
      after = page.next ?? undefined;
    } while (after !== undefined);

    const all = (await listInquiries(db, environment.id, { size: 100 })).items.map((i) => i.id);
    expect(seen).toEqual(all);
    expect(seen).toHaveLength(8);
    expect(new Set(seen).size).toBe(8);
  });

  it('bumps updated_at through the trigger', async () => {
    const { organization } = await tenant();
    await sleep(5);

    const [updated] = await db
      .update(organizations)
      .set({ name: 'Renamed' })
      .where(eq(organizations.id, organization.id))
      .returning();

    expect(updated?.updatedAt.getTime()).toBeGreaterThan(organization.updatedAt.getTime());
  });
});

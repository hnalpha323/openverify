/**
 * Database-level guarantees of schema v1, exercised on PGlite (Postgres 17.5). The
 * same migration runs on real Postgres 17 in `db.integration.test.ts`.
 */
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { pgErrorCode } from './errors.js';
import { resolveInquiryAccount } from './repositories/accounts.js';
import {
  auditLogs,
  environments,
  events,
  files,
  inquiries,
  inquirySessions,
  inquiryTemplateVersions,
  inquiryTemplates,
  organizations,
  userSessions,
  users,
  verificationChecks,
  verifications,
  webhookDeliveries,
  webhooks,
} from './schema.js';
import {
  createTestDatabase,
  createTestTenant,
  testId,
  wallClockStepsBack,
  type TestDatabase,
} from './testing.js';

const ARGON2 =
  '$argon2id$v=19$m=19456,t=2,p=1$c3ludGhldGljc2FsdA$c3ludGhldGljaGFzaHZhbHVlZm9ydGVzdHM';
const HASH = (char: string) => char.repeat(64);

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

/**
 * console-tests-6c follow-up: sets the row's `updated_at` an hour back without firing its triggers
 * (`session_replication_role = replica`, as `createdAtClock` does) and returns that instant, so a
 * test of the bump compares with a stamp it set, not with the wall clock.
 */
async function updatedAnHourAgo(table: string, id: string): Promise<Date> {
  const at = new Date(Date.now() - 3_600_000);
  await database.db.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role = replica`);
    await tx.execute(
      sql`update ${sql.identifier(table)} set updated_at = ${at.toISOString()}::timestamptz where id = ${id}`,
    );
  });
  const stamped = await database.db.execute(
    sql`select updated_at from ${sql.identifier(table)} where id = ${id}`,
  );
  const stored = (stamped.rows[0] as { updated_at: unknown }).updated_at;
  expect(stored instanceof Date ? stored : new Date(String(stored))).toEqual(at);
  return at;
}

async function sqlState(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return pgErrorCode(error) ?? `unexpected: ${String(error)}`;
  }
  return undefined;
}

async function template(environmentId: string) {
  const templateId = testId('itmpl');
  const versionId = testId('itmplv');
  await database.db.insert(inquiryTemplates).values({ id: templateId, environmentId, name: 'KYC' });
  await database.db.insert(inquiryTemplateVersions).values({
    id: versionId,
    environmentId,
    inquiryTemplateId: templateId,
    version: 1,
    flow: { steps: [] },
    verificationConfig: {},
  });
  return { templateId, versionId };
}

async function inquiry(environmentId: string) {
  const { templateId, versionId } = await template(environmentId);
  const id = testId('inq');
  await database.db.insert(inquiries).values({
    id,
    environmentId,
    inquiryTemplateId: templateId,
    inquiryTemplateVersionId: versionId,
    // Schema v2: every inquiry names its account (C13).
    accountId: await account(environmentId),
    fields: { 'name-first': 'Synthetic' },
  });
  return id;
}

async function account(environmentId: string): Promise<string> {
  return (await resolveInquiryAccount(database.db, environmentId, {})) ?? '';
}

describe('identifier format', () => {
  it.each([
    ['another prefix', () => testId('env')],
    ['lowercase base32', () => testId('org').toLowerCase().replace(/^org/, 'org')],
    ['letters outside Crockford base32', () => `org_${'U'.repeat(26)}`],
    ['a uuid', () => '0c5d6a7e-3f1b-4c1e-9a0d-1f2e3d4c5b6a'],
  ])('rejects %s', async (_label, makeId) => {
    expect(
      await sqlState(database.db.insert(organizations).values({ id: makeId(), name: 'x' })),
    ).toBe('23514');
  });
});

describe('tenant consistency', () => {
  it('rejects a template version that points at another environment’s template', async () => {
    const a = await createTestTenant(database.db);
    const b = await createTestTenant(database.db);
    const { templateId } = await template(a.environment.id);

    const insert = database.db.insert(inquiryTemplateVersions).values({
      id: testId('itmplv'),
      environmentId: b.environment.id,
      inquiryTemplateId: templateId,
      version: 2,
      flow: {},
      verificationConfig: {},
    });
    expect(await sqlState(insert)).toBe('23503');
  });

  it('rejects an inquiry whose version belongs to a different template', async () => {
    const { environment } = await createTestTenant(database.db);
    const first = await template(environment.id);
    const second = await template(environment.id);

    const insert = database.db.insert(inquiries).values({
      id: testId('inq'),
      environmentId: environment.id,
      inquiryTemplateId: first.templateId,
      inquiryTemplateVersionId: second.versionId,
      accountId: await account(environment.id),
      fields: {},
    });
    expect(await sqlState(insert)).toBe('23503');
  });

  it('rejects a verification for another environment’s inquiry', async () => {
    const a = await createTestTenant(database.db);
    const b = await createTestTenant(database.db);
    const inquiryId = await inquiry(a.environment.id);

    const insert = database.db.insert(verifications).values({
      id: testId('ver'),
      environmentId: b.environment.id,
      inquiryId,
      type: 'government_id',
    });
    expect(await sqlState(insert)).toBe('23503');
  });

  it('rejects a user session in an environment of another organization', async () => {
    const a = await createTestTenant(database.db);
    const b = await createTestTenant(database.db);
    const userId = testId('usr');
    await database.db.insert(users).values({
      id: userId,
      organizationId: a.organization.id,
      email: `${userId.toLowerCase()}@example.test`,
      passwordHash: ARGON2,
    });

    const insert = database.db.insert(userSessions).values({
      id: testId('uss'),
      organizationId: a.organization.id,
      userId,
      environmentId: b.environment.id,
      tokenHash: HASH('a'),
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await sqlState(insert)).toBe('23503');
  });

  it('deletes everything that belongs to an environment with it', async () => {
    const { environment } = await createTestTenant(database.db);
    const environmentId = environment.id;
    const inquiryId = await inquiry(environmentId);
    const verificationId = testId('ver');
    await database.db
      .insert(verifications)
      .values({ id: verificationId, environmentId, inquiryId, type: 'selfie' });
    await database.db.insert(verificationChecks).values({
      environmentId,
      verificationId,
      name: 'selfie_multiple_faces_detection',
      status: 'passed',
      type: 'fraud',
      requirement: 'required',
    });
    await database.db.insert(files).values({
      id: testId('file'),
      environmentId,
      verificationId,
      kind: 'selfie-center',
      storageKey: `test/${testId('file')}`,
      mimeType: 'image/jpeg',
      byteSize: 10,
      sha256: HASH('b'),
      wrappedDek: `ov1.AAAAAAAAAAA.${'A'.repeat(80)}`,
    });
    await database.db.insert(inquirySessions).values({
      id: testId('iqse'),
      environmentId,
      inquiryId,
      tokenHash: HASH('c'),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const eventId = testId('evt');
    const webhookId = testId('wbh');
    await database.db
      .insert(events)
      .values({ id: eventId, environmentId, name: 'inquiry.created', payload: { data: {} } });
    await database.db.insert(webhooks).values({
      id: webhookId,
      environmentId,
      url: 'https://hooks.example.test/openverify',
      enabledEvents: ['*'],
      secret: 'wbhsec_synthetic',
      secretLast4: 'etic',
    });
    await database.db
      .insert(webhookDeliveries)
      .values({ id: testId('whd'), environmentId, webhookId, eventId });
    await database.db
      .insert(auditLogs)
      .values({ environmentId, actorType: 'system', action: 'file.viewed' });

    await database.db.delete(environments).where(eq(environments.id, environmentId));

    for (const table of [
      inquiryTemplates,
      inquiryTemplateVersions,
      inquiries,
      inquirySessions,
      verifications,
      verificationChecks,
      files,
      events,
      webhooks,
      webhookDeliveries,
      auditLogs,
    ]) {
      expect(await database.db.$count(table, eq(table.environmentId, environmentId))).toBe(0);
    }
  });
});

describe('operator accounts', () => {
  it('requires lowercase emails, unique per organization only', async () => {
    const a = await createTestTenant(database.db);
    const b = await createTestTenant(database.db);
    const user = (organizationId: string, email: string) =>
      database.db
        .insert(users)
        .values({ id: testId('usr'), organizationId, email, passwordHash: ARGON2 });

    expect(await sqlState(user(a.organization.id, 'Ops@Example.test'))).toBe('23514');
    expect(await sqlState(user(a.organization.id, 'ops@example.test'))).toBeUndefined();
    expect(await sqlState(user(a.organization.id, 'ops@example.test'))).toBe('23505');
    expect(await sqlState(user(b.organization.id, 'ops@example.test'))).toBeUndefined();
  });

  it('only stores argon2id password hashes', async () => {
    const { organization } = await createTestTenant(database.db);

    const insert = database.db.insert(users).values({
      id: testId('usr'),
      organizationId: organization.id,
      email: 'bcrypt@example.test',
      passwordHash: '$2b$12$abcdefghijklmnopqrstuuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0',
    });
    expect(await sqlState(insert)).toBe('23514');
  });
});

describe('column constraints', () => {
  it('only stores SHA-256 hex digests as session token hashes', async () => {
    const { environment } = await createTestTenant(database.db);
    const inquiryId = await inquiry(environment.id);

    const insert = database.db.insert(inquirySessions).values({
      id: testId('iqse'),
      environmentId: environment.id,
      inquiryId,
      tokenHash: 'ovs_raw-token-must-never-be-stored',
      expiresAt: new Date(),
    });
    expect(await sqlState(insert)).toBe('23514');
  });

  it('requires at least one enabled event on a webhook', async () => {
    const { environment } = await createTestTenant(database.db);

    const insert = database.db.insert(webhooks).values({
      id: testId('wbh'),
      environmentId: environment.id,
      url: 'https://hooks.example.test/a',
      enabledEvents: [],
      secret: 'wbhsec_x',
      secretLast4: 'ec_x',
    });
    expect(await sqlState(insert)).toBe('23514');
  });

  it('requires a next attempt time while a delivery is pending', async () => {
    const { environment } = await createTestTenant(database.db);
    const eventId = testId('evt');
    const webhookId = testId('wbh');
    await database.db
      .insert(events)
      .values({ id: eventId, environmentId: environment.id, name: 'inquiry.created', payload: {} });
    await database.db.insert(webhooks).values({
      id: webhookId,
      environmentId: environment.id,
      url: 'https://hooks.example.test/b',
      enabledEvents: ['inquiry.created'],
      secret: 'wbhsec_y',
      secretLast4: 'ec_y',
    });

    const insert = database.db.insert(webhookDeliveries).values({
      id: testId('whd'),
      environmentId: environment.id,
      webhookId,
      eventId,
      nextAttemptAt: null,
    });
    expect(await sqlState(insert)).toBe('23514');
  });

  it('rejects a file whose wrapped DEK or digest is malformed', async () => {
    const { environment } = await createTestTenant(database.db);
    const inquiryId = await inquiry(environment.id);
    const verificationId = testId('ver');
    await database.db.insert(verifications).values({
      id: verificationId,
      environmentId: environment.id,
      inquiryId,
      type: 'government_id',
    });
    const file = (overrides: { wrappedDek?: string; sha256?: string }) =>
      database.db.insert(files).values({
        id: testId('file'),
        environmentId: environment.id,
        verificationId,
        kind: 'front',
        storageKey: `test/${testId('file')}`,
        mimeType: 'image/png',
        byteSize: 1,
        sha256: HASH('d'),
        wrappedDek: `ov1.AAAAAAAAAAA.${'A'.repeat(80)}`,
        ...overrides,
      });

    expect(await sqlState(file({ wrappedDek: 'raw-key-material' }))).toBe('23514');
    expect(await sqlState(file({ sha256: 'NOT-HEX' }))).toBe('23514');
    expect(await sqlState(file({}))).toBeUndefined();
  });

  it('keeps at most one file of each kind per verification', async () => {
    const { environment } = await createTestTenant(database.db);
    const inquiryId = await inquiry(environment.id);
    const insertVerification = async () => {
      const id = testId('ver');
      await database.db
        .insert(verifications)
        .values({ id, environmentId: environment.id, inquiryId, type: 'government_id' });
      return id;
    };
    const first = await insertVerification();
    const second = await insertVerification();
    const file = (verificationId: string, kind: 'front' | 'back') =>
      database.db.insert(files).values({
        id: testId('file'),
        environmentId: environment.id,
        verificationId,
        kind,
        storageKey: `test/${testId('file')}`,
        mimeType: 'image/png',
        byteSize: 1,
        sha256: HASH('e'),
        wrappedDek: `ov1.AAAAAAAAAAA.${'A'.repeat(80)}`,
      });

    expect(await sqlState(file(first, 'front'))).toBeUndefined();
    expect(await sqlState(file(first, 'back'))).toBeUndefined();
    expect(await sqlState(file(second, 'front'))).toBeUndefined();
    expect(await sqlState(file(first, 'front'))).toBe('23505');
  });
});

describe('dotted names', () => {
  it.each(['inquiry.created', 'inquiry.marked-for-review', 'report/watchlist.matched'])(
    'accepts the event name %s',
    async (name) => {
      const { environment } = await createTestTenant(database.db);

      const insert = database.db
        .insert(events)
        .values({ id: testId('evt'), environmentId: environment.id, name, payload: {} });
      expect(await sqlState(insert)).toBeUndefined();
    },
  );

  it.each(['Inquiry.created', 'inquiry', 'inquiry..created', '/inquiry.created'])(
    'rejects the event name %s',
    async (name) => {
      const { environment } = await createTestTenant(database.db);

      const insert = database.db
        .insert(events)
        .values({ id: testId('evt'), environmentId: environment.id, name, payload: {} });
      expect(await sqlState(insert)).toBe('23514');
    },
  );
});

describe('triggers', () => {
  it('bumps updated_at on every update', async () => {
    // console-tests-6c follow-up: the bump must not rest on the wall clock moving forward.
    onTestFinished(wallClockStepsBack());
    const { organization } = await createTestTenant(database.db);
    const anHourAgo = await updatedAnHourAgo('organizations', organization.id);

    const [updated] = await database.db
      .update(organizations)
      .set({ name: 'Renamed' })
      .where(eq(organizations.id, organization.id))
      .returning();

    expect(updated?.updatedAt.getTime()).toBeGreaterThan(anHourAgo.getTime());
    expect(updated?.createdAt).toEqual(organization.createdAt);
  });

  it('keeps an updated_at that the caller sets explicitly', async () => {
    const { organization } = await createTestTenant(database.db);
    const explicit = new Date('2030-01-01T00:00:00.000Z');

    const [updated] = await database.db
      .update(organizations)
      .set({ name: 'Explicit', updatedAt: explicit })
      .where(eq(organizations.id, organization.id))
      .returning();

    expect(updated?.updatedAt).toEqual(explicit);
  });

  it('keeps audit logs append-only but deletable for retention', async () => {
    const { environment } = await createTestTenant(database.db);
    const [entry] = await database.db
      .insert(auditLogs)
      .values({ environmentId: environment.id, actorType: 'system', action: 'file.viewed' })
      .returning();
    const id = entry?.id ?? -1;

    expect(
      await sqlState(
        database.db.update(auditLogs).set({ action: 'file.edited' }).where(eq(auditLogs.id, id)),
      ),
    ).toBe('P0001');
    await database.db.delete(auditLogs).where(eq(auditLogs.id, id));
    expect(await database.db.$count(auditLogs, eq(auditLogs.id, id))).toBe(0);
  });

  it('stores inquiry fields as ciphertext', async () => {
    const { environment } = await createTestTenant(database.db);
    const id = await inquiry(environment.id);

    const raw = await database.db.execute<{ fields: string }>(
      sql`select fields from inquiries where id = ${id}`,
    );

    expect(raw.rows[0]?.fields).toMatch(/^ov1\./);
    expect(raw.rows[0]?.fields).not.toContain('Synthetic');
  });
});

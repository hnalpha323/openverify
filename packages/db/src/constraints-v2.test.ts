/**
 * Database-level guarantees added by schema v2 (migration 0003), on PGlite (Postgres
 * 17.5). The same migration runs on real Postgres 17 in the integration suites.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { pgErrorCode } from './errors.js';
import {
  accountRelations,
  accountTypes,
  accounts,
  auditLogs,
  events,
  idempotencyKeys,
  inquiries,
  inquirySessions,
  inquiryTemplateVersions,
  inquiryTemplates,
  mfaFactors,
  oneTimeLinks,
  roles,
  userRoles,
  users,
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

async function userTypeId(environmentId: string): Promise<string> {
  const [row] = await database.db
    .select({ id: accountTypes.id })
    .from(accountTypes)
    .where(and(eq(accountTypes.environmentId, environmentId), eq(accountTypes.name, 'user')));
  if (!row) throw new Error('no user account type');
  return row.id;
}

async function account(environmentId: string, values: Partial<typeof accounts.$inferInsert> = {}) {
  const id = testId('acc');
  await database.db
    .insert(accounts)
    .values({ id, environmentId, accountTypeId: await userTypeId(environmentId), ...values });
  return id;
}

async function template(environmentId: string) {
  const templateId = testId('itmpl');
  await database.db.insert(inquiryTemplates).values({ id: templateId, environmentId, name: 'KYC' });
  return templateId;
}

async function version(
  environmentId: string,
  inquiryTemplateId: string,
  number: number,
  status: 'draft' | 'published' | 'superseded' = 'published',
) {
  const id = testId('itmplv');
  await database.db.insert(inquiryTemplateVersions).values({
    id,
    environmentId,
    inquiryTemplateId,
    version: number,
    flow: {},
    verificationConfig: {},
    status,
    publishedAt: status === 'draft' ? null : new Date(),
  });
  return id;
}

async function inquiry(environmentId: string, values: Partial<typeof inquiries.$inferInsert> = {}) {
  const templateId = await template(environmentId);
  const versionId = await version(environmentId, templateId, 1);
  const id = testId('inq');
  await database.db.insert(inquiries).values({
    id,
    environmentId,
    accountId: await account(environmentId),
    inquiryTemplateId: templateId,
    inquiryTemplateVersionId: versionId,
    fields: {},
    ...values,
  });
  return id;
}

async function user(organizationId: string, values: Partial<typeof users.$inferInsert> = {}) {
  const id = testId('usr');
  await database.db.insert(users).values({
    id,
    organizationId,
    email: `${id.toLowerCase()}@example.test`,
    passwordHash: ARGON2,
    ...values,
  });
  return id;
}

describe('ids generated in SQL', () => {
  it('openverify_new_id makes C1 ids that sort by the given time', async () => {
    const result = await database.client.query<{ early: string; late: string }>(
      `select openverify_new_id('acc', timestamptz '2026-01-01T00:00:00Z') as early,
              openverify_new_id('acc', timestamptz '2026-01-01T00:00:01Z') as late`,
    );
    const row = result.rows[0];

    expect(row?.early).toMatch(/^acc_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(row?.late).toMatch(/^acc_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect((row?.early ?? '') < (row?.late ?? '')).toBe(true);
  });
});

describe('account types', () => {
  it('seeds the type "user" in every new environment', async () => {
    const { environment } = await createTestTenant(database.db);

    const rows = await database.db
      .select()
      .from(accountTypes)
      .where(eq(accountTypes.environmentId, environment.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'user', fieldsSchema: {} });
    expect(rows[0]?.id).toMatch(/^acctp_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('keeps names unique per environment', async () => {
    const { environment } = await createTestTenant(database.db);
    const other = await createTestTenant(database.db);
    const insert = (environmentId: string) =>
      database.db
        .insert(accountTypes)
        .values({ id: testId('acctp'), environmentId, name: 'business' });
    await insert(environment.id);

    expect(await sqlState(insert(environment.id))).toBe('23505');
    expect(await sqlState(insert(other.environment.id))).toBeUndefined();
  });
});

describe('accounts', () => {
  it('keeps a reference id unique per environment, and allows many without one', async () => {
    const { environment } = await createTestTenant(database.db);
    const other = await createTestTenant(database.db);
    await account(environment.id, { referenceId: 'customer-1' });
    await account(environment.id);
    await account(environment.id);

    expect(await sqlState(account(environment.id, { referenceId: 'customer-1' }))).toBe('23505');
    expect(await sqlState(account(other.environment.id, { referenceId: 'customer-1' }))).toBe(
      undefined,
    );
  });

  it('refuses an account type from another environment', async () => {
    const { environment } = await createTestTenant(database.db);
    const other = await createTestTenant(database.db);

    const insert = database.db.insert(accounts).values({
      id: testId('acc'),
      environmentId: environment.id,
      accountTypeId: await userTypeId(other.environment.id),
    });
    expect(await sqlState(insert)).toBe('23503');
  });

  it('consolidates only into another archived-from account of the same environment', async () => {
    const { environment } = await createTestTenant(database.db);
    const other = await createTestTenant(database.db);
    const target = await account(environment.id);
    const foreign = await account(other.environment.id);
    const source = await account(environment.id);
    const consolidate = (into: string, status: 'active' | 'archived') =>
      database.db
        .update(accounts)
        .set({ consolidatedInto: into, status })
        .where(eq(accounts.id, source));

    expect(await sqlState(consolidate(source, 'archived'))).toBe('23514');
    expect(await sqlState(consolidate(target, 'active'))).toBe('23514');
    expect(await sqlState(consolidate(foreign, 'archived'))).toBe('23503');
    expect(await sqlState(consolidate(target, 'archived'))).toBeUndefined();
  });

  it('enforces the C9 tag rules: 50 at most, 1-64 characters, unique ignoring case', async () => {
    const { environment } = await createTestTenant(database.db);
    const id = await account(environment.id);
    const setTags = (tags: string[]) =>
      database.db.update(accounts).set({ tags }).where(eq(accounts.id, id));
    const fifty = Array.from({ length: 50 }, (_, index) => `tag-${String(index)}`);

    expect(await sqlState(setTags(fifty))).toBeUndefined();
    expect(await sqlState(setTags([...fifty, 'one-more']))).toBe('23514');
    expect(await sqlState(setTags(['VIP', 'vip']))).toBe('23514');
    expect(await sqlState(setTags(['  ']))).toBe('23514');
    expect(await sqlState(setTags(['x'.repeat(65)]))).toBe('23514');
    expect(await sqlState(setTags(['VIP', 'Risk: high']))).toBeUndefined();
  });
});

describe('account relations', () => {
  it('are directed, unique per (from, to, type), and never point at the same account', async () => {
    const { environment } = await createTestTenant(database.db);
    const from = await account(environment.id);
    const to = await account(environment.id);
    const relate = (target: string, relationType: string) =>
      database.db.insert(accountRelations).values({
        environmentId: environment.id,
        fromAccountId: from,
        toAccountId: target,
        relationType,
      });
    await relate(to, 'spouse');

    expect(await sqlState(relate(to, 'spouse'))).toBe('23505');
    expect(await sqlState(relate(to, 'business_owner'))).toBeUndefined();
    expect(await sqlState(relate(from, 'spouse'))).toBe('23514');
    expect(await sqlState(relate(to, 'Spouse'))).toBe('23514');
  });

  it('cannot link accounts of two environments', async () => {
    const { environment } = await createTestTenant(database.db);
    const other = await createTestTenant(database.db);

    const insert = database.db.insert(accountRelations).values({
      environmentId: environment.id,
      fromAccountId: await account(environment.id),
      toAccountId: await account(other.environment.id),
      relationType: 'spouse',
    });
    expect(await sqlState(insert)).toBe('23503');
  });
});

describe('inquiries', () => {
  it('belong to an account of their own environment', async () => {
    const { environment } = await createTestTenant(database.db);
    const other = await createTestTenant(database.db);

    expect(await sqlState(inquiry(environment.id))).toBeUndefined();
    expect(
      await sqlState(inquiry(environment.id, { accountId: await account(other.environment.id) })),
    ).toBe('23503');
  });

  it('default expires-at to one day after creation', async () => {
    const { environment } = await createTestTenant(database.db);
    const id = await inquiry(environment.id);

    const [row] = await database.db
      .select({ createdAt: inquiries.createdAt, expiresAt: inquiries.expiresAt })
      .from(inquiries)
      .where(eq(inquiries.id, id));

    expect((row?.expiresAt.getTime() ?? 0) - (row?.createdAt.getTime() ?? 0)).toBe(86_400_000);
  });

  it('apply the tag rules too', async () => {
    const { environment } = await createTestTenant(database.db);

    expect(await sqlState(inquiry(environment.id, { tags: ['a', 'A'] }))).toBe('23514');
  });
});

describe('template versions', () => {
  it('allow at most one published version per template', async () => {
    const { environment } = await createTestTenant(database.db);
    const templateId = await template(environment.id);
    await version(environment.id, templateId, 1, 'published');
    await version(environment.id, templateId, 2, 'superseded');
    await version(environment.id, templateId, 3, 'draft');

    expect(await sqlState(version(environment.id, templateId, 4, 'published'))).toBe('23505');
  });

  it('stamp published_at on every version that left draft, and only those', async () => {
    const { environment } = await createTestTenant(database.db);
    const templateId = await template(environment.id);
    const insert = (status: 'draft' | 'published', publishedAt: Date | null) =>
      database.db.insert(inquiryTemplateVersions).values({
        id: testId('itmplv'),
        environmentId: environment.id,
        inquiryTemplateId: templateId,
        version: 1,
        flow: {},
        verificationConfig: {},
        status,
        publishedAt,
      });

    expect(await sqlState(insert('draft', new Date()))).toBe('23514');
    expect(await sqlState(insert('published', null))).toBe('23514');
  });
});

describe('inquiry sessions and one-time links', () => {
  it('require the timestamp of an expired or canceled session', async () => {
    const { environment } = await createTestTenant(database.db);
    const id = testId('iqse');
    await database.db.insert(inquirySessions).values({
      id,
      environmentId: environment.id,
      inquiryId: await inquiry(environment.id),
      tokenHash: HASH('a'),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const set = (values: Partial<typeof inquirySessions.$inferInsert>) =>
      database.db.update(inquirySessions).set(values).where(eq(inquirySessions.id, id));

    expect(await sqlState(set({ status: 'expired' }))).toBe('23514');
    expect(await sqlState(set({ status: 'canceled' }))).toBe('23514');
    expect(await sqlState(set({ status: 'canceled', canceledAt: new Date() }))).toBeUndefined();
  });

  it('store one-time link tokens as unique SHA-256 digests, used or revoked but not both', async () => {
    const { environment } = await createTestTenant(database.db);
    const inquiryId = await inquiry(environment.id);
    const insert = (tokenHash: string, values: Partial<typeof oneTimeLinks.$inferInsert> = {}) =>
      database.db.insert(oneTimeLinks).values({
        environmentId: environment.id,
        inquiryId,
        tokenHash,
        expiresAt: new Date(Date.now() + 60_000),
        ...values,
      });
    await insert(HASH('b'));

    expect(await sqlState(insert(HASH('b')))).toBe('23505');
    expect(await sqlState(insert('ovo_plaintext'))).toBe('23514');
    expect(await sqlState(insert(HASH('c'), { usedAt: new Date(), revokedAt: new Date() }))).toBe(
      '23514',
    );
  });
});

describe('idempotency keys', () => {
  it('are unique per environment, principal and key, and 1-255 printable characters', async () => {
    const { environment } = await createTestTenant(database.db);
    const insert = (key: string, principalId = testId('key')) =>
      database.db.insert(idempotencyKeys).values({
        environmentId: environment.id,
        principalType: 'api_key',
        principalId,
        key,
        fingerprint: HASH('d'),
        expiresAt: new Date(Date.now() + 60_000),
      });
    const principal = testId('key');
    await insert('order-1', principal);

    expect(await sqlState(insert('order-1', principal))).toBe('23505');
    expect(await sqlState(insert('order-1'))).toBeUndefined();
    expect(await sqlState(insert(''))).toBe('23514');
    expect(await sqlState(insert('x'.repeat(256)))).toBe('23514');
    expect(await sqlState(insert('tab\there'))).toBe('23514');
  });
});

describe('users, roles and MFA', () => {
  it('require a password unless the user is invited', async () => {
    const { organization } = await createTestTenant(database.db);

    expect(await sqlState(user(organization.id, { passwordHash: null }))).toBe('23514');
    expect(
      await sqlState(
        user(organization.id, {
          passwordHash: null,
          status: 'invited',
          invitationTokenHash: HASH('e'),
          invitationExpiresAt: new Date(Date.now() + 60_000),
        }),
      ),
    ).toBeUndefined();
  });

  it('assign only roles of the user organization, and keep roles in use', async () => {
    const { organization } = await createTestTenant(database.db);
    const other = await createTestTenant(database.db);
    const userId = await user(organization.id);
    const role = (organizationId: string) => {
      const id = testId('role');
      return database.db
        .insert(roles)
        .values({ id, organizationId, name: `Custom ${id}`, permissions: ['inquiries:read'] })
        .then(() => id);
    };
    const own = await role(organization.id);
    const foreign = await role(other.organization.id);
    const assign = (roleId: string) =>
      database.db.insert(userRoles).values({ organizationId: organization.id, userId, roleId });

    expect(await sqlState(assign(foreign))).toBe('23503');
    expect(await sqlState(assign(own))).toBeUndefined();
    expect(await sqlState(database.db.delete(roles).where(eq(roles.id, own)))).toBe('23503');
  });

  it('make built-in roles carry a key, and keep role names unique per organization', async () => {
    const { organization } = await createTestTenant(database.db);
    const insert = (values: Partial<typeof roles.$inferInsert>) =>
      database.db.insert(roles).values({
        id: testId('role'),
        organizationId: organization.id,
        name: 'Reviewer',
        ...values,
      });
    await insert({ builtin: true, key: 'reviewer' });

    expect(await sqlState(insert({ name: 'reviewer' }))).toBe('23505');
    expect(await sqlState(insert({ name: 'No key', builtin: true }))).toBe('23514');
    expect(await sqlState(insert({ name: 'Other', builtin: true, key: 'reviewer' }))).toBe('23505');
  });

  it('require the secret of a TOTP factor and the credential of a WebAuthn factor', async () => {
    const { organization } = await createTestTenant(database.db);
    const userId = await user(organization.id);
    const insert = (values: Partial<typeof mfaFactors.$inferInsert>) =>
      database.db.insert(mfaFactors).values({
        id: testId('mfa'),
        organizationId: organization.id,
        userId,
        type: 'totp',
        name: 'Phone',
        ...values,
      });

    expect(await sqlState(insert({ type: 'totp' }))).toBe('23514');
    expect(await sqlState(insert({ type: 'webauthn' }))).toBe('23514');
    expect(
      await sqlState(
        insert({
          type: 'webauthn',
          webauthnCredentialId: 'Y3JlZGVudGlhbA',
          webauthnPublicKey: 'cHVibGljLWtleQ',
          webauthnCounter: 0,
        }),
      ),
    ).toBeUndefined();
  });
});

describe('webhook deliveries', () => {
  it('deliver an event once per webhook, except for replays', async () => {
    const { environment } = await createTestTenant(database.db);
    const webhookId = testId('wbh');
    const eventId = testId('evt');
    await database.db.insert(webhooks).values({
      id: webhookId,
      environmentId: environment.id,
      url: 'https://hooks.example.test/a',
      enabledEvents: ['*'],
      secret: 'wbhsec_synthetic_secret_abcd',
      secretLast4: 'abcd',
    });
    await database.db
      .insert(events)
      .values({ id: eventId, environmentId: environment.id, name: 'inquiry.created', payload: {} });
    const deliver = (isReplay: boolean) =>
      database.db.insert(webhookDeliveries).values({
        id: testId('whd'),
        environmentId: environment.id,
        webhookId,
        eventId,
        isReplay,
      });
    await deliver(false);

    expect(await sqlState(deliver(false))).toBe('23505');
    expect(await sqlState(deliver(true))).toBeUndefined();
    expect(await sqlState(deliver(true))).toBeUndefined();
  });
});

describe('maintenance updates (KEK rewrap)', () => {
  async function auditEntry(environmentId: string) {
    const [row] = await database.db
      .insert(auditLogs)
      .values({
        publicId: testId('aud'),
        environmentId,
        actorType: 'system',
        action: 'inquiry.approved',
      })
      .returning({ id: auditLogs.id });
    return row?.id ?? 0;
  }

  it('keeps audit logs append-only outside a rewrap', async () => {
    const { environment } = await createTestTenant(database.db);
    const id = await auditEntry(environment.id);

    expect(
      await sqlState(
        database.db.update(auditLogs).set({ ip: '198.51.100.1' }).where(eq(auditLogs.id, id)),
      ),
    ).toBe('P0001');
  });

  it('lets a rewrap change only the encrypted audit columns', async () => {
    const { environment } = await createTestTenant(database.db);
    const id = await auditEntry(environment.id);

    const changed = await database.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('openverify.kek_rewrap', 'on', true)`);
      await tx.update(auditLogs).set({ ip: '198.51.100.2' }).where(eq(auditLogs.id, id));
      return sqlState(
        tx.transaction((inner) =>
          inner.update(auditLogs).set({ action: 'inquiry.declined' }).where(eq(auditLogs.id, id)),
        ),
      );
    });
    const [row] = await database.db.select().from(auditLogs).where(eq(auditLogs.id, id));

    expect(changed).toBe('P0001');
    expect(row).toMatchObject({ ip: '198.51.100.2', action: 'inquiry.approved' });
  });

  it('leaves updated_at alone during a rewrap', async () => {
    const { environment } = await createTestTenant(database.db);
    const id = await inquiry(environment.id);
    const before = await database.db
      .select({ updatedAt: inquiries.updatedAt })
      .from(inquiries)
      .where(eq(inquiries.id, id));
    await sleep(5);

    await database.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('openverify.kek_rewrap', 'on', true)`);
      await tx
        .update(inquiries)
        .set({ fields: { rewrapped: true } })
        .where(eq(inquiries.id, id));
    });
    const after = await database.db
      .select({ updatedAt: inquiries.updatedAt })
      .from(inquiries)
      .where(eq(inquiries.id, id));

    expect(after[0]?.updatedAt.getTime()).toBe(before[0]?.updatedAt.getTime());
  });

  it('still bumps updated_at on new tables otherwise', async () => {
    // console-tests-6c follow-up: the bump must not rest on the wall clock moving forward.
    onTestFinished(wallClockStepsBack());
    const { environment } = await createTestTenant(database.db);
    const id = await account(environment.id);
    const anHourAgo = await updatedAnHourAgo('accounts', id);

    const [after] = await database.db
      .update(accounts)
      .set({ tags: ['bumped'] })
      .where(eq(accounts.id, id))
      .returning();

    expect(after?.updatedAt.getTime()).toBeGreaterThan(anHourAgo.getTime());
  });
});

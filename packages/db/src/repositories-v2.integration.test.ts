/**
 * One round trip per schema v2 repository on real Postgres 17 + pgvector (Testcontainers),
 * plus what PGlite cannot show: row locks and races seen from several connections.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateApiKey } from './api-keys.js';
import { createDatabase, type Database } from './client.js';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { runMigrations } from './migrate.js';
import {
  addAccountRelation,
  addInquiryTag,
  appendAuditLog,
  cancelInquirySessions,
  claimIdempotencyKey,
  completeIdempotencyKey,
  consolidateAccounts,
  createAccount,
  createAccountType,
  createApiKey,
  createApiLog,
  createDraftInquiryTemplateVersion,
  createEnvironment,
  createEvent,
  createInquiry,
  createInquirySession,
  createInquiryTemplate,
  createInvitedUser,
  createMfaChallenge,
  createOneTimeLink,
  createOrganization,
  createRole,
  createTotpFactor,
  createUser,
  createWebhook,
  createWebhookDelivery,
  acceptInvitation,
  deleteExpiredIdempotencyKeys,
  getAccount,
  getAuditLog,
  getTotpSecret,
  listAccountRelations,
  listAccounts,
  listApiKeys,
  listApiLogs,
  listEvents,
  listInquiries,
  listInquiriesDueForRetention,
  listInquirySessions,
  listInquiryTemplateVersions,
  listOverdueInquiries,
  listOverdueInquirySessions,
  listUserAuditLogs,
  listUserPermissions,
  listWebhookDeliveries,
  markInquirySessionStarted,
  publishInquiryTemplateVersion,
  recordMfaChallengeFailure,
  redactInquiryRecords,
  redeemOneTimeLink,
  rewrapAll,
  rotateWebhookSecret,
  setUserRoles,
  syncBuiltinRoles,
  updateEnvironmentSettings,
} from './repositories/index.js';
import { hashSessionToken } from './tokens.js';
import { createIntegrationPool, testId, startIntegrationPostgres } from './testing.js';

const kek = randomBytes(32);
const keyring = createKeyring(kek);

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let db: Database;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 10 });
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
  const template = await createInquiryTemplate(db, environment.id, {
    id: testId('itmpl'),
    name: 'KYC',
    version: { id: testId('itmplv'), flow: {}, verificationConfig: {} },
  });
  const inquiry = (input: Partial<Parameters<typeof createInquiry>[2]> = {}) =>
    createInquiry(db, environment.id, {
      id: testId('inq'),
      inquiryTemplateId: template.id,
      inquiryTemplateVersionId: template.currentVersion.id,
      ...input,
    });
  return { org: organization.id, env: environment.id, template, inquiry };
}

describe('schema v2 repositories on Postgres 17', () => {
  it('accounts: types, filters, relations and consolidation', async () => {
    const { env, inquiry } = await tenant();
    const type = await createAccountType(db, env, { id: testId('acctp'), name: 'business' });
    const target = await createAccount(db, env, {
      id: testId('acc'),
      fields: { a: 1 },
      tags: ['VIP'],
    });
    const source = await createAccount(db, env, {
      id: testId('acc'),
      accountTypeId: type.id,
      fields: { b: 2 },
    });
    const moved = await inquiry({ accountId: source.id });
    const outsider = await createAccount(db, env, { id: testId('acc') });
    await addAccountRelation(db, env, {
      fromAccountId: source.id,
      toAccountId: outsider.id,
      relationType: 'spouse',
    });

    const result = await consolidateAccounts(db, env, {
      targetId: target.id,
      sourceIds: [source.id],
    });

    expect(result.movedInquiryIds).toEqual([moved.id]);
    expect(result.target.fields).toEqual({ a: 1, b: 2 });
    expect((await getAccount(db, env, source.id))?.consolidatedInto).toBe(target.id);
    expect((await listAccountRelations(db, env, target.id)).map((r) => r.relatedAccountId)).toEqual(
      [outsider.id],
    );
    expect((await listAccounts(db, env, { tag: 'vip' })).items.map((a) => a.id)).toEqual([
      target.id,
    ]);
  });

  it('inquiries: reference-id accounts under concurrency, tags and filters', async () => {
    const { env, inquiry } = await tenant();

    const created = await Promise.all(
      Array.from({ length: 6 }, () => inquiry({ referenceId: 'same-person' })),
    );
    await addInquiryTag(db, env, created[0]?.id ?? '', 'Gold');

    expect(new Set(created.map((entry) => entry.accountId)).size).toBe(1);
    expect(
      (await listInquiries(db, env, { accountId: created[0]?.accountId ?? '' })).items,
    ).toHaveLength(6);
    expect((await listInquiries(db, env, { tag: 'GOLD' })).items.map((entry) => entry.id)).toEqual([
      created[0]?.id,
    ]);
  });

  it('template versions: drafts and publishing', async () => {
    const { env, template } = await tenant();
    const draft = await createDraftInquiryTemplateVersion(db, env, template.id, {
      id: testId('itmplv'),
      flow: {},
      verificationConfig: {},
      settings: { 'retention-days': 3 },
    });

    const published = await publishInquiryTemplateVersion(db, env, draft?.id ?? '');

    expect(published).toMatchObject({
      status: 'published',
      superseded: { id: template.currentVersion.id },
    });
    expect(
      (await listInquiryTemplateVersions(db, env, { status: 'superseded' })).items,
    ).toHaveLength(1);
  });

  it('sessions and one-time links: a link redeems once under concurrent requests', async () => {
    const { env, inquiry } = await tenant();
    const target = await inquiry();
    const tokenHash = hashSessionToken(`ovo_${testId('inq')}`);
    await createOneTimeLink(db, env, {
      inquiryId: target.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const results = await Promise.all(
      Array.from({ length: 8 }, () => redeemOneTimeLink(db, { inquiryId: target.id, tokenHash })),
    );
    const session = await createInquirySession(db, env, {
      id: testId('iqse'),
      inquiryId: target.id,
      tokenHash: hashSessionToken(`ovs_${testId('iqse')}`),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const started = await Promise.all(
      Array.from({ length: 4 }, () =>
        markInquirySessionStarted(db, env, session.id, { ip: '203.0.113.9' }),
      ),
    );

    expect(results.filter((result) => result !== null)).toHaveLength(1);
    expect(started.filter((result) => result !== null)).toHaveLength(1);
    expect((await cancelInquirySessions(db, env, target.id)).map((s) => s.id)).toEqual([
      session.id,
    ]);
    expect((await listInquirySessions(db, env, { status: 'canceled' })).items).toHaveLength(1);
  });

  it('expiry and retention sweeps hand each row to one worker (FOR UPDATE SKIP LOCKED)', async () => {
    const { env, inquiry } = await tenant();
    const past = new Date('2001-01-01T00:00:00.000Z');
    const firstOverdue = await inquiry({ expiresAt: past });
    const overdue = [firstOverdue, await inquiry({ expiresAt: past })];
    await createInquirySession(db, env, {
      id: testId('iqse'),
      inquiryId: firstOverdue.id,
      tokenHash: hashSessionToken(`ovs_${testId('iqse')}`),
      expiresAt: past,
    });
    const now = new Date('2002-01-01T00:00:00.000Z');
    await updateEnvironmentSettings(db, env, { 'inquiry-retention-days': 1 });
    const done = await inquiry();
    await pool?.query(
      `update inquiries set status = 'completed', updated_at = '2001-01-01T00:00:00Z' where id = $1`,
      [done.id],
    );

    const [first, second] = await db.transaction(async (one) => {
      const a = {
        inquiries: await listOverdueInquiries(one, { now, lock: true, limit: 1000 }),
        sessions: await listOverdueInquirySessions(one, { now, lock: true, limit: 1000 }),
        retention: await listInquiriesDueForRetention(one, { now, lock: true, limit: 1000 }),
      };
      const b = await db.transaction(async (two) => ({
        inquiries: await listOverdueInquiries(two, { now, lock: true, limit: 1000 }),
        sessions: await listOverdueInquirySessions(two, { now, lock: true, limit: 1000 }),
        retention: await listInquiriesDueForRetention(two, { now, lock: true, limit: 1000 }),
      }));
      return [a, b];
    });

    const mine = (rows: { id: string }[]) =>
      rows.map((row) => row.id).filter((id) => [...overdue.map((i) => i.id), done.id].includes(id));
    expect(mine(first.inquiries).sort()).toEqual(overdue.map((entry) => entry.id).sort());
    expect(first.sessions.length).toBeGreaterThanOrEqual(1);
    expect(mine(first.retention)).toEqual([done.id]);
    expect(mine(second.inquiries)).toEqual([]);
    expect(second.sessions.filter((row) => row.environmentId === env)).toEqual([]);
    expect(mine(second.retention)).toEqual([]);
  });

  it('idempotency keys: one claimant among concurrent requests, then a replay', async () => {
    const { env } = await tenant();
    const input = {
      principalType: 'api_key' as const,
      principalId: testId('key'),
      key: 'concurrent',
      fingerprint: createHash('sha256').update('body').digest('hex'),
    };

    const claims = await Promise.all(
      Array.from({ length: 8 }, () => claimIdempotencyKey(db, env, input)),
    );
    const winner = claims.find((claim) => claim.outcome === 'claimed');
    if (winner?.outcome !== 'claimed') throw new Error('no claim');
    await completeIdempotencyKey(db, env, winner.id, {
      status: 201,
      headers: {},
      body: '{"ok":true}',
    });

    expect(claims.filter((claim) => claim.outcome === 'claimed')).toHaveLength(1);
    expect(claims.filter((claim) => claim.outcome === 'in_progress')).toHaveLength(7);
    expect(await claimIdempotencyKey(db, env, input)).toMatchObject({
      outcome: 'replay',
      response: { status: 201 },
    });
    expect(
      await deleteExpiredIdempotencyKeys(db, { now: new Date(Date.now() + 2 * 86_400_000) }),
    ).toBeGreaterThanOrEqual(1);
  });

  it('API keys, API logs and events', async () => {
    const { env } = await tenant();
    const generated = generateApiKey('sandbox', randomBytes(32));
    const key = await createApiKey(db, env, {
      id: testId('key'),
      name: 'Server',
      prefix: generated.prefix,
      tokenPrefix: generated.tokenPrefix,
      secretHash: generated.secretHash,
    });
    await createApiLog(db, env, {
      id: testId('alog'),
      method: 'GET',
      path: '/api/v1/events',
      route: '/api/v1/events',
      status: 429,
      durationMs: 2,
      apiKeyId: key.id,
      ip: '203.0.113.7',
    });
    const inquiryId = testId('inq');
    await createEvent(db, env, {
      id: testId('evt'),
      name: 'inquiry.approved',
      payload: { data: { type: 'inquiry', id: inquiryId } },
    });

    expect((await listApiKeys(db, env)).items.map((entry) => entry.tokenPrefix)).toEqual([
      generated.tokenPrefix,
    ]);
    expect((await listApiLogs(db, env, { status: '4xx', apiKeyId: key.id })).items[0]?.ip).toBe(
      '203.0.113.7',
    );
    expect(
      (await listEvents(db, env, { objectId: inquiryId, name: 'inquiry.approved' })).items,
    ).toHaveLength(1);
  });

  it('webhooks: rotation and deliveries', async () => {
    const { env } = await tenant();
    const webhook = await createWebhook(db, env, {
      id: testId('wbh'),
      url: 'https://hooks.example.test/pg',
      enabledEvents: ['*'],
      secret: 'wbhsec_synthetic_pg_one_abcd',
      customHeaders: { 'X-Key': 'value' },
    });
    const event = await createEvent(db, env, {
      id: testId('evt'),
      name: 'inquiry.created',
      payload: {},
    });
    await createWebhookDelivery(db, env, {
      id: testId('whd'),
      webhookId: webhook.id,
      eventId: event.id,
    });
    await createWebhookDelivery(db, env, {
      id: testId('whd'),
      webhookId: webhook.id,
      eventId: event.id,
      isReplay: true,
    });

    const rotated = await rotateWebhookSecret(db, env, webhook.id, {
      secret: 'wbhsec_synthetic_pg_two_wxyz',
      previousSecretExpiresAt: new Date(Date.now() + 60_000),
    });

    expect(rotated?.customHeaderNames).toEqual(['X-Key']);
    expect((await listWebhookDeliveries(db, env, { webhookId: webhook.id })).items).toHaveLength(2);
  });

  it('operators: invitations, roles, permissions, MFA', async () => {
    const { org } = await tenant();
    const roles = await syncBuiltinRoles(
      db,
      org,
      [{ key: 'admin', name: 'Admin', permissions: ['users:write'] }],
      () => testId('role'),
    );
    const custom = await createRole(db, org, {
      id: testId('role'),
      name: 'Logs',
      permissions: ['api-logs:read'],
    });
    const tokenHash = hashSessionToken(`ovi_${testId('usr')}`);
    const invited = await createInvitedUser(db, {
      id: testId('usr'),
      organizationId: org,
      email: 'invitee@example.test',
      invitationTokenHash: tokenHash,
      invitationExpiresAt: new Date(Date.now() + 60_000),
    });
    const accepted = await acceptInvitation(db, {
      tokenHash,
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
      name: 'Invitee',
    });
    await setUserRoles(db, org, invited.id, [roles[0]?.id ?? '', custom.id]);
    const factor = await createTotpFactor(db, org, {
      id: testId('mfa'),
      userId: invited.id,
      name: 'Phone',
      secret: 'JBSWY3DPEHPK3PXP',
    });
    const challenge = await createMfaChallenge(db, org, {
      userId: invited.id,
      tokenHash: hashSessionToken(`ovm_${testId('usr')}`),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const failures = await Promise.all(
      Array.from({ length: 7 }, () => recordMfaChallengeFailure(db, challenge.id)),
    );

    expect(accepted?.status).toBe('active');
    expect((await listUserPermissions(db, org, invited.id)).sort()).toEqual([
      'api-logs:read',
      'users:write',
    ]);
    expect((await getTotpSecret(db, org, factor.id))?.secret).toBe('JBSWY3DPEHPK3PXP');
    expect(failures.filter((failure) => failure !== null)).toHaveLength(5);
    expect(failures.filter((failure) => failure?.revoked === true)).toHaveLength(1);
  });

  it('user audit logs: public ids, sealed user agent, filters', async () => {
    const { env } = await tenant();
    const entry = await appendAuditLog(db, env, {
      actorType: 'user',
      actorId: testId('usr'),
      action: 'environment.switched',
      userAgent: 'SyntheticBrowser/7',
    });
    await appendAuditLog(db, env, { actorType: 'system', action: 'inquiry.expired' });

    expect(await getAuditLog(db, env, entry.publicId)).toEqual(entry);
    expect(
      (await listUserAuditLogs(db, env, { action: 'environment.switched' })).items.map(
        (log) => log.userAgent,
      ),
    ).toEqual(['SyntheticBrowser/7']);
  });

  it('redaction and KEK rewrap', async () => {
    const { org, env, inquiry } = await tenant();
    const target = await inquiry({ fields: { name: 'Synthetic' }, note: 'note' });
    await appendAuditLog(db, env, {
      actorType: 'system',
      action: 'inquiry.redacted',
      userAgent: 'UA',
    });
    await createUser(db, {
      id: testId('usr'),
      organizationId: org,
      email: 'rewrap@example.test',
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
    });

    const redacted = await redactInquiryRecords(db, env, target.id);
    const rotating = createKeyring(randomBytes(32), [kek]);
    setDefaultKeyring(rotating);
    try {
      const result = await rewrapAll(db, { keyring: rotating, batchSize: 50 });
      expect(result.rewrapped).toBeGreaterThan(0);
      expect((await rewrapAll(db, { keyring: rotating })).rewrapped).toBe(0);
    } finally {
      setDefaultKeyring(keyring);
    }

    expect(redacted?.inquiry).toMatchObject({ fields: {}, note: null });
  });
});

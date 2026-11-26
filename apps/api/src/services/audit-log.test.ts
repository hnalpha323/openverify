import {
  newId,
  userAuditLogDocumentSchema,
  userAuditLogListDocumentSchema,
} from '@openverify/contracts';
import { appendAuditLog, listAuditLogs } from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UNMASKED, piiMaskFor } from '../auth/pii.js';
import { userPrincipal } from '../test-support/principals.js';
import type { AuditEntry } from '../ports.js';
import {
  appendSystemAuditEntry,
  auditActionName,
  createAuditLogger,
  getUserAuditLogDocument,
  listUserAuditLogDocument,
  storedActorOf,
  toUserAuditLogResource,
} from './audit-log.js';

// Synthetic tenants, actors and addresses only.
let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

const runActor = (id: string): AuditEntry['actor'] => ({ type: 'workflow-run', id });

describe('storedActorOf (owner decision 5 after Workflow 7B)', () => {
  it('stores each principal as its own kind', () => {
    const user = newId('usr');
    const key = newId('key');
    expect(storedActorOf({ type: 'user', id: user })).toEqual({ actorType: 'user', actorId: user });
    expect(storedActorOf({ type: 'api-key', id: key })).toEqual({
      actorType: 'api_key',
      actorId: key,
    });
  });

  it('stores a workflow run as itself, never as a user or an API key (C121.1)', () => {
    const run = newId('wfr');
    expect(storedActorOf(runActor(run))).toEqual({ actorType: 'workflow_run', actorId: run });
  });
});

async function tenant() {
  const { organization, environment } = await createTestTenant(database.db);
  return { organizationId: organization.id, environmentId: environment.id };
}

function entry(
  scope: { organizationId: string; environmentId: string },
  overrides: Partial<AuditEntry> = {},
): AuditEntry {
  return {
    ...scope,
    actor: { type: 'user', id: newId('usr') },
    action: 'inquiry.approved',
    resourceType: 'inquiry',
    resourceId: newId('inq'),
    ...overrides,
  };
}

describe('createAuditLogger', () => {
  it('appends the entry with an aud_ id, the actor, the request and encrypted client details', async () => {
    const scope = await tenant();
    const logger = createAuditLogger();
    const recorded = entry(scope, {
      ipAddress: '203.0.113.9',
      userAgent: 'Synthetic Browser/1.0',
      requestId: 'req-synthetic-1',
      metadata: { from: 'completed', to: 'approved' },
    });

    await logger.record(database.db, recorded);

    const [stored] = await listAuditLogs(database.db, scope.environmentId);
    expect(stored).toMatchObject({
      actorType: 'user',
      actorId: recorded.actor.id,
      action: 'inquiry.approved',
      resourceType: 'inquiry',
      resourceId: recorded.resourceId,
      requestId: 'req-synthetic-1',
      ip: '203.0.113.9',
      userAgent: 'Synthetic Browser/1.0',
      metadata: { from: 'completed', to: 'approved' },
    });
    expect(stored?.publicId).toMatch(/^aud_[0-9A-HJKMNP-TV-Z]{26}$/);
    // Client details are encrypted at rest.
    const raw = await database.client.query<{ ip: string }>(
      'select ip::text as ip from audit_logs where public_id = $1',
      [stored?.publicId],
    );
    expect(raw.rows[0]?.ip).not.toContain('203.0.113.9');
  });

  it('records API key actors with the stored api_key type', async () => {
    const scope = await tenant();
    const keyId = newId('key');

    await createAuditLogger().record(
      database.db,
      entry(scope, { actor: { type: 'api-key', id: keyId } }),
    );

    const [stored] = await listAuditLogs(database.db, scope.environmentId);
    expect(stored).toMatchObject({ actorType: 'api_key', actorId: keyId, metadata: {} });
  });

  it('refuses an action that is not dotted kebab-case, before writing anything', async () => {
    const scope = await tenant();
    const logger = createAuditLogger();

    for (const action of ['inquiry_approved', 'Inquiry.Approved', 'inquiry', 'inquiry.approved2']) {
      await expect(logger.record(database.db, entry(scope, { action })), action).rejects.toThrow(
        RangeError,
      );
    }
    expect(await listAuditLogs(database.db, scope.environmentId)).toEqual([]);
  });
});

describe('appendSystemAuditEntry', () => {
  it('records an action taken by no principal, such as the user:reset-mfa command', async () => {
    const scope = await tenant();
    const userId = newId('usr');

    await appendSystemAuditEntry(database.db, scope.environmentId, {
      action: 'user.mfa-reset',
      resourceType: 'user',
      resourceId: userId,
      metadata: { via: 'cli' },
    });

    const [stored] = await listAuditLogs(database.db, scope.environmentId);
    expect(stored).toMatchObject({
      actorType: 'system',
      actorId: null,
      action: 'user.mfa-reset',
      resourceId: userId,
      metadata: { via: 'cli' },
    });
  });
});

describe('auditActionName', () => {
  it('serves the Phase 1 snake_case resource names in the kebab-case of C15', () => {
    expect(auditActionName('user_session.created')).toBe('user-session.created');
    expect(auditActionName('file.viewed')).toBe('file.viewed');
  });
});

describe('toUserAuditLogResource', () => {
  it('maps a stored entry to the user-audit-log resource', async () => {
    const scope = await tenant();
    const actorId = newId('usr');
    const stored = await appendAuditLog(database.db, scope.environmentId, {
      actorType: 'user',
      actorId,
      action: 'user_session.created',
      resourceType: 'user-session',
      resourceId: newId('uss'),
      ip: '198.51.100.4',
      userAgent: 'Synthetic Agent',
      metadata: { mfa: 'totp' },
    });

    expect(toUserAuditLogResource(stored, UNMASKED)).toEqual({
      type: 'user-audit-log',
      id: stored.publicId,
      attributes: {
        action: 'user-session.created',
        actor: { type: 'user', id: actorId },
        'resource-type': 'user-session',
        'resource-id': stored.resourceId,
        'ip-address': '198.51.100.4',
        'user-agent': 'Synthetic Agent',
        metadata: { mfa: 'totp' },
        'created-at': stored.createdAt.toISOString(),
      },
    });
  });

  it('masks the client address and agent for a user without pii:view', async () => {
    const scope = await tenant();
    const stored = await appendAuditLog(database.db, scope.environmentId, {
      actorType: 'api_key',
      actorId: newId('key'),
      action: 'webhook.secret-rotated',
      resourceType: 'webhook',
      resourceId: newId('wbh'),
      ip: '198.51.100.4',
      userAgent: 'Synthetic Agent',
    });
    const viewer = piiMaskFor(userPrincipal({ ...scope, permissions: ['audit-logs:read'] }));

    expect(toUserAuditLogResource(stored, viewer).attributes).toMatchObject({
      actor: { type: 'api-key', id: stored.actorId },
      'ip-address': null,
      'user-agent': null,
    });
  });

  it('serves an entry no principal wrote as the system actor, masked like every entry', async () => {
    const scope = await tenant();
    const stored = await appendAuditLog(database.db, scope.environmentId, {
      actorType: 'system',
      action: 'inquiry.redacted',
      resourceType: 'inquiry',
      resourceId: newId('inq'),
      ip: '203.0.113.9',
      userAgent: 'synthetic',
    });

    const viewer = piiMaskFor(userPrincipal({ ...scope, permissions: ['audit-logs:read'] }));

    expect(toUserAuditLogResource(stored, UNMASKED).attributes).toMatchObject({
      actor: { type: 'system', id: null },
      'ip-address': '203.0.113.9',
    });
    expect(toUserAuditLogResource(stored, viewer).attributes).toMatchObject({
      actor: { type: 'system', id: null },
      'ip-address': null,
      'user-agent': null,
    });
  });

  it.each([
    ['handoff.issued', 'handoff', 'hnd'],
    ['handoff.review-requested', 'inquiry', 'inq'],
    ['importer.completed', 'importer', 'mprt'],
    ['graph-query.completed', 'graph-query', 'grphq'],
    ['user.mfa-reset', 'user', 'usr'],
    ['environment.otp-sms-budget-tripped', 'environment', 'env'],
  ] as const)('serves the %s entry the system writes', async (action, resourceType, prefix) => {
    const scope = await tenant();
    await appendSystemAuditEntry(database.db, scope.environmentId, {
      action,
      resourceType,
      resourceId: newId(prefix),
      metadata: { synthetic: true },
    });

    const document = await listUserAuditLogDocument(database.db, scope.environmentId, {}, UNMASKED, '/x');

    expect(userAuditLogListDocumentSchema.parse(document).data[0]?.attributes).toMatchObject({
      action,
      actor: { type: 'system', id: null },
      'resource-type': resourceType,
    });
  });
});

describe('listUserAuditLogDocument and getUserAuditLogDocument', () => {
  async function seed() {
    const scope = await tenant();
    const alice = newId('usr');
    const key = newId('key');
    const logger = createAuditLogger();
    const inquiryId = newId('inq');
    await logger.record(database.db, entry(scope, { actor: { type: 'user', id: alice }, resourceId: inquiryId }));
    await appendSystemAuditEntry(database.db, scope.environmentId, {
      action: 'inquiry.redacted',
      resourceType: 'inquiry',
      resourceId: inquiryId,
    });
    await logger.record(
      database.db,
      entry(scope, { actor: { type: 'api-key', id: key }, action: 'webhook.created', resourceType: 'webhook', resourceId: newId('wbh') }),
    );
    await logger.record(
      database.db,
      entry(scope, { actor: { type: 'user', id: alice }, action: 'file.viewed', resourceType: 'file', resourceId: newId('file') }),
    );
    const all = await listAuditLogs(database.db, scope.environmentId);
    return { scope, alice, key, inquiryId, all };
  }

  it('lists newest first, system entries included, as a C1 list document', async () => {
    const { scope, all } = await seed();

    const document = await listUserAuditLogDocument(database.db, scope.environmentId, {}, UNMASKED, '/x');

    expect(userAuditLogListDocumentSchema.parse(document)).toEqual(document);
    expect(document.data).toHaveLength(all.length);
    expect(document.data.map((item) => item.attributes.action)).toEqual(
      all.map((item) => item.action),
    );
    expect(document.data.filter((item) => item.attributes.actor.type === 'system')).toHaveLength(1);
    expect(document.links.next).toBeNull();
  });

  it('filters by action, actor, resource and creation time, and pages with the next link', async () => {
    const { scope, alice, key, inquiryId } = await seed();
    const list = (query: Parameters<typeof listUserAuditLogDocument>[2]) =>
      listUserAuditLogDocument(database.db, scope.environmentId, query, UNMASKED, '/api/v1/user-audit-logs');

    expect((await list({ 'filter[action]': 'file.viewed,webhook.created' })).data).toHaveLength(2);
    expect((await list({ 'filter[actor-id]': key })).data.map((item) => item.attributes.action)).toEqual([
      'webhook.created',
    ]);
    expect((await list({ 'filter[actor-id]': alice })).data).toHaveLength(2);
    // The principal's entry and the system's, on the same inquiry.
    expect((await list({ 'filter[resource-type]': 'inquiry', 'filter[resource-id]': inquiryId })).data).toHaveLength(2);
    expect((await list({ 'filter[created-at-end]': '2000-01-01T00:00:00Z' })).data).toEqual([]);

    const page = await list({ 'page[size]': 1, 'filter[actor-id]': alice });
    expect(page.data).toHaveLength(1);
    const next = new URL(page.links.next ?? '', 'http://api.invalid');
    expect(next.pathname).toBe('/api/v1/user-audit-logs');
    expect(next.searchParams.get('filter[actor-id]')).toBe(alice);
    expect(next.searchParams.get('page[size]')).toBe('1');
    expect(next.searchParams.get('page[after]')).toBe(page.data[0]?.id);
    const following = await list({
      'page[size]': 1,
      'filter[actor-id]': alice,
      'page[after]': next.searchParams.get('page[after]') ?? '',
    });
    expect(following.data.map((item) => item.attributes.action)).toEqual(['inquiry.approved']);
  });

  it('refuses a cursor that names no entry of the environment with a 400', async () => {
    const { scope } = await seed();
    const other = await seed();

    await expect(
      listUserAuditLogDocument(database.db, scope.environmentId, { 'page[after]': other.all[0]?.publicId ?? '' }, UNMASKED, '/x'),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('gets one entry by id, a system entry too, and 404 across environments', async () => {
    const { scope, all } = await seed();
    const other = await tenant();
    const userEntry = all.find((item) => item.action === 'file.viewed');
    const systemEntry = all.find((item) => item.actorType === 'system');

    const document = await getUserAuditLogDocument(database.db, scope.environmentId, userEntry?.publicId ?? '', UNMASKED);

    expect(userAuditLogDocumentSchema.parse(document).data.id).toBe(userEntry?.publicId);
    await expect(
      getUserAuditLogDocument(database.db, other.environmentId, userEntry?.publicId ?? '', UNMASKED),
    ).rejects.toMatchObject({ status: 404 });
    const system = await getUserAuditLogDocument(database.db, scope.environmentId, systemEntry?.publicId ?? '', UNMASKED);
    expect(system.data.attributes.actor).toEqual({ type: 'system', id: null });
    await expect(
      getUserAuditLogDocument(database.db, other.environmentId, systemEntry?.publicId ?? '', UNMASKED),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('a workflow run in the audit log (C121.1)', () => {
  it('is stored as itself and served with its wfr_ id', async () => {
    const scope = await tenant();
    const run = newId('wfr');

    await createAuditLogger().record(
      database.db,
      entry(scope, { actor: runActor(run), action: 'inquiry.declined' }),
    );

    const [stored] = await listAuditLogs(database.db, scope.environmentId);
    expect(stored).toMatchObject({ actorType: 'workflow_run', actorId: run });
    expect(toUserAuditLogResource(stored as never, UNMASKED).attributes.actor).toEqual({
      type: 'workflow-run',
      id: run,
    });
  });
});

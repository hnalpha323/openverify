import {
  newId,
  userAuditLogDocumentSchema,
  userAuditLogListDocumentSchema,
} from '@openverify/contracts';
import { appendAuditLog } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createAuditLogger } from '../../services/audit-log.js';
import {
  createDashboardHarness,
  expectJson,
  type DashboardHarness,
  type TestOrganization,
} from './dashboard.test-support.js';

let database: TestDatabase;
const harnesses: DashboardHarness[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

afterAll(async () => {
  await database.close();
});

async function harness() {
  const api = await createDashboardHarness(database);
  harnesses.push(api);
  return api;
}

async function seedEntry(organization: TestOrganization, action = 'inquiry.approved') {
  await createAuditLogger().record(database.db, {
    organizationId: organization.id,
    environmentId: organization.sandboxId,
    actor: { type: 'api-key', id: newId('key') },
    action,
    resourceType: 'inquiry',
    resourceId: newId('inq'),
    ipAddress: '203.0.113.50',
    userAgent: 'Synthetic Client/1.0',
  });
}

describe('GET /audit-logs (C15)', () => {
  it('serves an entry no principal wrote as the system, masked like every entry (K7A-8)', async () => {
    const api = await harness();
    const organization = await api.organization();
    const auditor = await api.operator(organization, { roles: [], roleIds: [] });
    const { createRole, setUserRoles } = await import('@openverify/db');
    const role = await createRole(database.db, organization.id, {
      id: newId('role'),
      name: 'Synthetic Auditor',
      permissions: ['audit-logs:read'],
    });
    await setUserRoles(database.db, organization.id, auditor.user.id, [role.id]);
    const token = await api.signIn(auditor.email);
    await appendAuditLog(database.db, organization.sandboxId, {
      actorType: 'system',
      action: 'importer.completed',
      resourceType: 'importer',
      resourceId: newId('mprt'),
      ip: '203.0.113.51',
      userAgent: 'Synthetic Client/1.0',
    });

    const { data } = userAuditLogListDocumentSchema.parse(
      expectJson(
        await api.call('GET', '/audit-logs?filter[action]=importer.completed', { token }),
        200,
      ),
    );

    expect(data[0]?.attributes).toMatchObject({
      action: 'importer.completed',
      actor: { type: 'system', id: null },
      'ip-address': null,
      'user-agent': null,
    });
  });

  it('lists the session environment’s entries with client details for an admin', async () => {
    const api = await harness();
    const organization = await api.organization();
    const admin = await api.operator(organization);
    const token = await api.signIn(admin.email);
    await seedEntry(organization);
    await seedEntry(await api.organization());

    const body = userAuditLogListDocumentSchema.parse(
      expectJson(
        await api.call('GET', '/audit-logs?filter[action]=inquiry.approved', { token }),
        200,
      ),
    );

    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.attributes).toMatchObject({
      action: 'inquiry.approved',
      'ip-address': '203.0.113.50',
      'user-agent': 'Synthetic Client/1.0',
    });
    // The admin's own login is in the log too.
    const all = userAuditLogListDocumentSchema.parse(
      expectJson(await api.call('GET', '/audit-logs', { token }), 200),
    );
    expect(all.data.map(({ attributes }) => attributes.action)).toContain('user-session.created');
  });

  it('masks client details without pii:view', async () => {
    const api = await harness();
    const organization = await api.organization();
    const auditor = await api.operator(organization, { roles: [], roleIds: [] });
    const { createRole } = await import('@openverify/db');
    const role = await createRole(database.db, organization.id, {
      id: newId('role'),
      name: 'Synthetic Auditor',
      permissions: ['audit-logs:read'],
    });
    const { setUserRoles } = await import('@openverify/db');
    await setUserRoles(database.db, organization.id, auditor.user.id, [role.id]);
    const token = await api.signIn(auditor.email);
    await seedEntry(organization);

    const body = userAuditLogListDocumentSchema.parse(
      expectJson(
        await api.call('GET', '/audit-logs?filter[action]=inquiry.approved', { token }),
        200,
      ),
    );

    expect(body.data[0]?.attributes).toMatchObject({ 'ip-address': null, 'user-agent': null });
  });

  it('needs audit-logs:read and validates the filters', async () => {
    const api = await harness();
    const organization = await api.organization();
    const developer = await api.operator(organization, { roles: ['developer'] });
    const admin = await api.operator(organization);
    const developerToken = await api.signIn(developer.email);
    const adminToken = await api.signIn(admin.email);

    expect((await api.call('GET', '/audit-logs', { token: developerToken })).statusCode).toBe(403);
    expect(
      (await api.call('GET', '/audit-logs?filter[action]=Not_Valid', { token: adminToken }))
        .statusCode,
    ).toBe(400);
  });
});

describe('GET /audit-logs/:id', () => {
  it('returns one entry, and 404 for another environment’s', async () => {
    const api = await harness();
    const organization = await api.organization();
    const other = await api.organization();
    const admin = await api.operator(organization);
    const otherAdmin = await api.operator(other);
    const token = await api.signIn(admin.email);
    await api.signIn(otherAdmin.email);
    const [own] = await api.audit(organization.sandboxId, 'user-session.created');
    const [foreign] = await api.audit(other.sandboxId, 'user-session.created');

    const body = userAuditLogDocumentSchema.parse(
      expectJson(await api.call('GET', `/audit-logs/${own?.publicId ?? ''}`, { token }), 200),
    );

    expect(body.data).toMatchObject({
      id: own?.publicId,
      attributes: { actor: { type: 'user', id: admin.user.id } },
    });
    expect(
      (await api.call('GET', `/audit-logs/${foreign?.publicId ?? ''}`, { token })).statusCode,
    ).toBe(404);
    expect((await api.call('GET', `/audit-logs/${newId('aud')}`, { token })).statusCode).toBe(404);
    const developer = await api.operator(organization, { roles: ['developer'] });
    const developerToken = await api.signIn(developer.email);
    expect(
      (await api.call('GET', `/audit-logs/${own?.publicId ?? ''}`, { token: developerToken }))
        .statusCode,
    ).toBe(403);
  });
});

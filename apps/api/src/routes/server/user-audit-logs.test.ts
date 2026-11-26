import { randomBytes } from 'node:crypto';
import {
  newId,
  userAuditLogDocumentSchema,
  userAuditLogListDocumentSchema,
} from '@openverify/contracts';
import { appendAuditLog, useAuditIpIndexKey } from '@openverify/db';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { appendSystemAuditEntry, createAuditLogger } from '../../services/audit-log.js';
import { bearer, createTestApi, expectStatus, type TestApi } from '../../test-support/harness.js';

// Synthetic actors and addresses only.
let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
}, 60_000);

afterAll(async () => {
  await api.close();
});

async function record(
  scope: { organizationId: string; environmentId: string },
  action: string,
  actorId = newId('usr'),
) {
  await createAuditLogger().record(api.database.db, {
    ...scope,
    actor: { type: 'user', id: actorId },
    action,
    resourceType: 'inquiry',
    resourceId: newId('inq'),
    ipAddress: '203.0.113.61',
    userAgent: 'Synthetic Agent/1.0',
    metadata: { synthetic: true },
  });
}

const list = (token: string, query = '') =>
  api.app.inject({ url: `/api/v1/user-audit-logs${query}`, headers: bearer(token) });

describe('GET /api/v1/user-audit-logs (C15)', () => {
  it('lists the environment’s entries, newest first, with client details for an API key', async () => {
    const tenant = await api.newTenant();
    await record(tenant, 'inquiry.approved');
    await record(tenant, 'inquiry.declined');
    await record(await api.newTenant(), 'inquiry.approved');

    const body = userAuditLogListDocumentSchema.parse(expectStatus(await list(tenant.token), 200));

    expect(body.data.map(({ attributes }) => attributes.action)).toEqual([
      'inquiry.declined',
      'inquiry.approved',
    ]);
    expect(body.data[0]?.attributes).toMatchObject({
      'ip-address': '203.0.113.61',
      'user-agent': 'Synthetic Agent/1.0',
      metadata: { synthetic: true },
    });
  });

  it('filters by action and actor, and pages with links.next', async () => {
    const tenant = await api.newTenant();
    const actor = newId('usr');
    await record(tenant, 'inquiry.approved', actor);
    await record(tenant, 'inquiry.approved', actor);
    await record(tenant, 'webhook.created');

    const byActor = userAuditLogListDocumentSchema.parse(
      expectStatus(await list(tenant.token, `?filter[actor-id]=${actor}&page[size]=1`), 200),
    );
    const byAction = userAuditLogListDocumentSchema.parse(
      expectStatus(await list(tenant.token, '?filter[action]=webhook.created'), 200),
    );

    expect(byActor.data).toHaveLength(1);
    expect(byActor.links.next).toMatch(/^\/api\/v1\/user-audit-logs\?filter\[actor-id\]=/);
    expect(byAction.data.map(({ attributes }) => attributes.action)).toEqual(['webhook.created']);
  });

  it('masks client details for a user without pii:view', async () => {
    const tenant = await api.newTenant();
    await record(tenant, 'inquiry.approved');
    const token = api.newUserToken(tenant.environmentId, { permissions: ['audit-logs:read'] });

    const body = userAuditLogListDocumentSchema.parse(expectStatus(await list(token), 200));

    expect(body.data[0]?.attributes).toMatchObject({ 'ip-address': null, 'user-agent': null });
  });

  it('needs audit-logs:read: 403 forbidden for an API key or a user without it', async () => {
    const tenant = await api.newTenant();
    const key = await api.newApiKey(tenant.environmentId, { scopes: ['inquiries:read'] });
    const user = api.newUserToken(tenant.environmentId, { permissions: ['inquiries:read'] });

    for (const token of [key, user]) {
      const response = await list(token);
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ type: 'https://openverify.dev/problems/forbidden' });
    }
  });

  it('answers 400 for a bad filter or a cursor from another environment', async () => {
    const tenant = await api.newTenant();
    const other = await api.newTenant();
    await record(other, 'inquiry.approved');
    const foreign = userAuditLogListDocumentSchema.parse(
      expectStatus(await list(other.token), 200),
    );

    expect((await list(tenant.token, '?filter[action]=NotAnAction')).statusCode).toBe(400);
    expect((await list(tenant.token, `?page[after]=${foreign.data[0]?.id ?? ''}`)).statusCode).toBe(
      400,
    );
  });
});

describe('an entry no principal wrote (K7A-8)', () => {
  async function seeded() {
    const tenant = await api.newTenant();
    await appendSystemAuditEntry(api.database.db, tenant.environmentId, {
      action: 'handoff.redeemed',
      resourceType: 'handoff',
      resourceId: newId('hnd'),
      metadata: { method: 'qr' },
    });
    return tenant;
  }

  it('is listed and read one by one as the system, under audit-logs:read', async () => {
    const tenant = await seeded();

    const [entry] = userAuditLogListDocumentSchema.parse(
      expectStatus(await list(tenant.token), 200),
    ).data;

    expect(entry?.attributes).toMatchObject({
      action: 'handoff.redeemed',
      actor: { type: 'system', id: null },
    });
    const one = await api.app.inject({
      url: `/api/v1/user-audit-logs/${entry?.id ?? ''}`,
      headers: bearer(tenant.token),
    });
    expect(userAuditLogDocumentSchema.parse(expectStatus(one, 200)).data.id).toBe(entry?.id);
  });

  it('stays in its environment, and needs audit-logs:read', async () => {
    await seeded();
    const other = await api.newTenant();
    const reader = await seeded();
    const none = api.newUserToken(reader.environmentId, { permissions: ['inquiries:read'] });

    expect(expectStatus(await list(other.token), 200).data).toEqual([]);
    expect((await list(none)).statusCode).toBe(403);
  });
});

describe('GET /api/v1/user-audit-logs/:id', () => {
  it('returns one entry, and 404 for another environment’s or an unknown one', async () => {
    const tenant = await api.newTenant();
    const other = await api.newTenant();
    await record(tenant, 'inquiry.approved');
    const [entry] = userAuditLogListDocumentSchema.parse(
      expectStatus(await list(tenant.token), 200),
    ).data;
    const get = (token: string, id: string) =>
      api.app.inject({ url: `/api/v1/user-audit-logs/${id}`, headers: bearer(token) });

    const body = userAuditLogDocumentSchema.parse(
      expectStatus(await get(tenant.token, entry?.id ?? ''), 200),
    );

    expect(body.data).toEqual(entry);
    expect((await get(other.token, entry?.id ?? '')).statusCode).toBe(404);
    expect((await get(tenant.token, newId('aud'))).statusCode).toBe(404);
    expect((await get(tenant.token, 'not-an-id')).statusCode).toBe(400);
    const withoutScope = await api.newApiKey(tenant.environmentId, { scopes: ['events:read'] });
    expect((await get(withoutScope, entry?.id ?? '')).statusCode).toBe(403);
  });
});

/**
 * C168.6 on the server API (Phase 9, Workflow 9B, integration-9b): the explorer's filters
 * the query schema accepts since Stage 1a apply here too. Before this, a key sending
 * `filter[ip]` got every entry unfiltered (fail open, api-access' deviation).
 */
describe('GET /api/v1/user-audit-logs: the explorer filters (C168.6)', () => {
  const KEY = new Uint8Array(randomBytes(32));

  afterEach(() => {
    useAuditIpIndexKey(null);
  });

  async function seededAddresses() {
    useAuditIpIndexKey(KEY);
    const tenant = await api.newTenant();
    for (const [action, ip] of [
      ['inquiry.approved', '203.0.113.71'],
      ['inquiry.declined', '198.51.100.72'],
      ['webhook.created', '203.0.113.71'],
    ] as const) {
      await appendAuditLog(api.database.db, tenant.environmentId, {
        actorType: 'system',
        action,
        resourceType: 'inquiry',
        resourceId: newId('inq'),
        ip,
      });
    }
    return tenant;
  }

  const actions = async (token: string, query: string) =>
    userAuditLogListDocumentSchema
      .parse(expectStatus(await list(token, query), 200))
      .data.map(({ attributes }) => attributes.action);

  it('matches one exact address through the index, never answering the others', async () => {
    const tenant = await seededAddresses();

    expect(await actions(tenant.token, '?filter[ip]=203.0.113.71')).toEqual([
      'webhook.created',
      'inquiry.approved',
    ]);
    expect(await actions(tenant.token, '?filter[ip]=192.0.2.73')).toEqual([]);
  });

  it('refuses filter[ip] without pii:view, and with no blind-index key, never listing all', async () => {
    const tenant = await seededAddresses();
    const user = api.newUserToken(tenant.environmentId, { permissions: ['audit-logs:read'] });

    expect((await list(user, '?filter[ip]=203.0.113.71')).statusCode).toBe(403);
    useAuditIpIndexKey(null);
    const previous = process.env.OPENVERIFY_BLIND_INDEX_KEY;
    delete process.env.OPENVERIFY_BLIND_INDEX_KEY;
    try {
      expect((await list(tenant.token, '?filter[ip]=203.0.113.71')).statusCode).toBe(503);
    } finally {
      if (previous !== undefined) process.env.OPENVERIFY_BLIND_INDEX_KEY = previous;
    }
  });

  it('filters by action prefix and by from and to', async () => {
    const tenant = await seededAddresses();
    const future = new Date(Date.now() + 3_600_000).toISOString();

    expect(await actions(tenant.token, '?filter[action-prefix]=inquiry.')).toEqual([
      'inquiry.declined',
      'inquiry.approved',
    ]);
    expect(await actions(tenant.token, `?filter[from]=${future}`)).toEqual([]);
    expect(await actions(tenant.token, `?filter[to]=${future}`)).toHaveLength(3);
  });
});

/**
 * C169.1-C169.3 (Workflow 9B, `api-keys-webhooks`; decision 50; contracts B29): one-call rotation
 * through the clone's checks (a refusal test, review P33), the key's `note`, its age warning against
 * `api-key-age-warning-days`, and the attribute blocklist stored, cloned and applied to what the key is
 * served (the HTTP exits: a list, a resource, an event's payload, a problem and the stored API log).
 * Every value is synthetic.
 */
import {
  apiKeyDocumentSchema,
  apiKeyListDocumentSchema,
  createdApiKeyDocumentSchema,
  newId,
  rotatedApiKeyDocumentSchema,
} from '@openverify/contracts';
import { createEvent, getApiKey, listApiLogs, updateEnvironmentSettings } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { createDbApiKeyAuthenticator } from '../../auth/api-key-lookup.js';
import {
  bearer,
  createInquiry,
  createTestApi,
  expectStatus,
  TEST_PEPPER,
  type TestApi,
  type TestApp,
} from '../../test-support/harness.js';

let api: TestApi;
let app: TestApp;

beforeAll(async () => {
  api = await createTestApi();
  const authenticator = createDbApiKeyAuthenticator({
    db: api.database.db,
    pepper: TEST_PEPPER,
    clock: api.clock,
  });
  app = buildApp({
    lookupApiKey: authenticator.lookup,
    onAuthenticated: authenticator.touch,
    now: () => api.clock.now(),
    logger: false,
    mode: 'test',
    api: api.deps,
    apiKeyPepper: TEST_PEPPER,
  });
});

afterAll(async () => {
  await app.close();
  await api.close();
});

const URL = '/api/v1/api-keys';
const DAY = 86_400_000;

const call = (
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  token: string,
  payload?: Record<string, unknown>,
) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: bearer(token),
    ...(payload === undefined ? {} : { payload }),
  });

async function createKey(token: string, attributes: Record<string, unknown> = {}) {
  const response = await call('POST', '/api-keys', token, {
    data: {
      type: 'api-key',
      attributes: { name: 'Synthetic backend', scopes: ['inquiries:read'], ...attributes },
    },
  });
  return createdApiKeyDocumentSchema.parse(expectStatus(response, 201));
}

const rotate = (token: string, id: string, meta: Record<string, unknown>) =>
  call('POST', `/api-keys/${id}/rotate`, token, { meta });

describe('POST /api-keys/:id/rotate (C169.1)', () => {
  it('clones the key with its scopes, IPs, version, blocklist and note, ends the old one, and answers the token once', async () => {
    const tenant = await api.newTenant();
    const source = await createKey(tenant.token, {
      name: 'Synthetic billing',
      scopes: ['inquiries:read', 'events:read'],
      'allowed-ips': ['203.0.113.0/24'],
      note: 'Rotated every quarter',
      'attribute-blocklist': ['fields', 'reference-id'],
    });
    const now = api.clock.now();

    const response = await rotate(tenant.token, source.data.id, {
      'previous-expires-in-seconds': 3600,
    });

    const document = rotatedApiKeyDocumentSchema.parse(expectStatus(response, 201));
    expect(response.headers.location).toBe(`${URL}/${document.data.id}`);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(document.data.id).not.toBe(source.data.id);
    expect(document.meta.token).not.toBe(source.meta.token);
    expect(document.meta['previous-key-id']).toBe(source.data.id);
    const end = new Date(now.getTime() + 3_600_000).toISOString();
    expect(document.meta['previous-expires-at']).toBe(end);
    expect(document.data.attributes).toMatchObject({
      name: 'Synthetic billing',
      scopes: ['inquiries:read', 'events:read'],
      'allowed-ips': ['203.0.113.0/24'],
      'api-version': source.data.attributes['api-version'],
      note: 'Rotated every quarter',
      'attribute-blocklist': ['fields', 'reference-id'],
      'expires-at': null,
      'age-warning': false,
    });
    const old = await call('GET', `/api-keys/${source.data.id}`, tenant.token);
    expect(apiKeyDocumentSchema.parse(expectStatus(old, 200)).data.attributes['expires-at']).toBe(
      end,
    );
  });

  it('takes meta.name for the new key', async () => {
    const tenant = await api.newTenant();
    const source = await createKey(tenant.token);

    const response = await rotate(tenant.token, source.data.id, {
      'previous-expires-in-seconds': 0,
      name: 'Synthetic backend 2026-Q4',
    });

    expect(
      rotatedApiKeyDocumentSchema.parse(expectStatus(response, 201)).data.attributes.name,
    ).toBe('Synthetic backend 2026-Q4');
  });

  it('writes one audit entry linking both keys, without the token', async () => {
    const tenant = await api.newTenant();
    const source = await createKey(tenant.token);
    const before = api.audit.withAction('api-key.rotated').length;

    const document = rotatedApiKeyDocumentSchema.parse(
      expectStatus(
        await rotate(tenant.token, source.data.id, { 'previous-expires-in-seconds': 60 }),
        201,
      ),
    );

    const entries = api.audit.withAction('api-key.rotated').slice(before);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      resourceType: 'api-key',
      resourceId: document.data.id,
      metadata: {
        'previous-api-key-id': source.data.id,
        'previous-expires-at': document.meta['previous-expires-at'],
      },
    });
    expect(JSON.stringify(entries)).not.toContain(document.meta.token);
    expect(api.audit.withAction('api-key.cloned').map((entry) => entry.resourceId)).not.toContain(
      document.data.id,
    );
  });

  it('keeps the old token working until the chosen end, and the new one from now', async () => {
    const tenant = await api.newTenant();
    const source = await createKey(tenant.token, { scopes: ['api-keys:read'] });

    const document = rotatedApiKeyDocumentSchema.parse(
      expectStatus(
        await rotate(tenant.token, source.data.id, { 'previous-expires-in-seconds': 600 }),
        201,
      ),
    );

    expect((await call('GET', '/api-keys', source.meta.token)).statusCode).toBe(200);
    expect((await call('GET', '/api-keys', document.meta.token)).statusCode).toBe(200);
    api.clock.advance(601_000);
    expect((await call('GET', '/api-keys', source.meta.token)).statusCode).toBe(401);
    expect((await call('GET', '/api-keys', document.meta.token)).statusCode).toBe(200);
  });

  it('ends the old key at once with 0 seconds, and never extends an earlier end', async () => {
    const tenant = await api.newTenant();
    const now = api.clock.now();
    const soon = await createKey(tenant.token, { 'expires-in-seconds': 60 });
    const other = await createKey(tenant.token, { scopes: ['api-keys:read'] });

    const kept = rotatedApiKeyDocumentSchema.parse(
      expectStatus(
        await rotate(tenant.token, soon.data.id, { 'previous-expires-in-seconds': 86_400 }),
        201,
      ),
    );
    expectStatus(
      await rotate(tenant.token, other.data.id, { 'previous-expires-in-seconds': 0 }),
      201,
    );

    expect(kept.meta['previous-expires-at']).toBe(new Date(now.getTime() + 60_000).toISOString());
    expect((await call('GET', '/api-keys', other.meta.token)).statusCode).toBe(401);
  });

  it('refuses a caller that does not hold every scope it would copy, and changes nothing (review P33)', async () => {
    const tenant = await api.newTenant();
    const source = await createKey(tenant.token, { scopes: ['inquiries:read', 'accounts:write'] });
    const narrow = await api.newApiKey(tenant.environmentId, {
      scopes: ['api-keys:write', 'inquiries:read'],
    });
    const before = await call('GET', '/api-keys', tenant.token);

    const response = await rotate(narrow, source.data.id, { 'previous-expires-in-seconds': 0 });

    expect(response.statusCode, response.body).toBe(403);
    expect(response.body).toContain('accounts:write');
    const after = await call('GET', '/api-keys', tenant.token);
    const keysOf = (response: typeof before) =>
      apiKeyListDocumentSchema
        .parse(expectStatus(response, 200))
        .data.map(({ id, attributes }) => ({ id, end: attributes['expires-at'] }));
    expect(keysOf(after)).toEqual(keysOf(before));
    const stored = await getApiKey(api.database.db, tenant.environmentId, source.data.id);
    expect(stored?.expiresAt).toBeNull();
  });

  it('forces pii-masked when the caller cannot see PII', async () => {
    const tenant = await api.newTenant();
    const source = await createKey(tenant.token);
    const user = api.newUserToken(tenant.environmentId, {
      permissions: ['api-keys:write', 'inquiries:read'],
    });

    const response = await rotate(user, source.data.id, { 'previous-expires-in-seconds': 0 });

    expect(
      rotatedApiKeyDocumentSchema.parse(expectStatus(response, 201)).data.attributes['pii-masked'],
    ).toBe(true);
  });

  it('answers 404 for a key of another environment', async () => {
    const tenant = await api.newTenant();
    const other = await api.newTenant();
    const source = await createKey(other.token);

    const response = await rotate(tenant.token, source.data.id, {
      'previous-expires-in-seconds': 0,
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('the key’s note and blocklist (C169.1, C169.3)', () => {
  it('stores and serves them on create, changes them on update, and audits the names only', async () => {
    const tenant = await api.newTenant();
    const created = await createKey(tenant.token, {
      note: 'Synthetic reconciliation job',
      'attribute-blocklist': ['birthdate'],
    });
    expect(created.data.attributes).toMatchObject({
      note: 'Synthetic reconciliation job',
      'attribute-blocklist': ['birthdate'],
      'age-warning': false,
    });

    const changed = await call('PATCH', `/api-keys/${created.data.id}`, tenant.token, {
      data: { type: 'api-key', attributes: { note: null, 'attribute-blocklist': ['fields'] } },
    });

    expect(apiKeyDocumentSchema.parse(expectStatus(changed, 200)).data.attributes).toMatchObject({
      note: null,
      'attribute-blocklist': ['fields'],
    });
    expect(api.audit.withAction('api-key.updated').at(-1)?.metadata).toEqual({
      changed: ['note', 'attribute-blocklist'],
    });
    expect(JSON.stringify(api.audit.entries)).not.toContain('Synthetic reconciliation job');
  });

  it('serves a key made before 9B with no note and an empty blocklist', async () => {
    const tenant = await api.newTenant();

    const listed = apiKeyListDocumentSchema.parse(
      expectStatus(await call('GET', '/api-keys', tenant.token), 200),
    );

    expect(listed.data[0]?.attributes).toMatchObject({ note: null, 'attribute-blocklist': [] });
  });

  it('copies the blocklist and the note on clone', async () => {
    const tenant = await api.newTenant();
    const source = await createKey(tenant.token, {
      note: 'Synthetic note',
      'attribute-blocklist': ['birthdate'],
    });

    const clone = createdApiKeyDocumentSchema.parse(
      expectStatus(await call('POST', `/api-keys/${source.data.id}/clone`, tenant.token), 201),
    );

    expect(clone.data.attributes).toMatchObject({
      note: 'Synthetic note',
      'attribute-blocklist': ['birthdate'],
    });
  });
});

describe('the key’s age (C169.2)', () => {
  it('marks a key older than api-key-age-warning-days (90 by default) and follows the setting', async () => {
    const tenant = await api.newTenant();
    const key = await createKey(tenant.token);
    const warned = async () =>
      apiKeyDocumentSchema.parse(
        expectStatus(await call('GET', `/api-keys/${key.data.id}`, tenant.token), 200),
      ).data.attributes['age-warning'];

    // created-at is the database's time: the clock is set from it.
    api.clock.set(new Date(Date.parse(key.data.attributes['created-at']) + 90 * DAY));
    const atNinety = await warned();
    api.clock.advance(1000);
    const pastNinety = await warned();
    await updateEnvironmentSettings(api.database.db, tenant.environmentId, {
      'api-key-age-warning-days': 200,
    });
    const withSetting = await warned();

    expect([atNinety, pastNinety, withSetting]).toEqual([false, true, false]);
  });
});

describe('the blocklist on what the key is served (C169.3)', () => {
  it('strips a list of keys, an inquiry, an event’s payload and the stored log; a problem stays whole', async () => {
    const tenant = await api.newTenant();
    const { data: blocked, meta } = await createKey(tenant.token, {
      scopes: ['api-keys:read', 'inquiries:read', 'events:read'],
      'attribute-blocklist': ['scopes', 'reference-id', 'fields'],
    });
    const inquiryId = await createInquiry(api, {
      token: tenant.token,
      referenceId: 'ref-synthetic',
    });
    // The harness records events rather than storing them: the inquiry's own document is stored.
    const full = await call('GET', `/inquiries/${inquiryId}`, tenant.token);
    const eventId = newId('evt');
    await createEvent(api.database.db, tenant.environmentId, {
      id: eventId,
      name: 'inquiry.created',
      payload: { data: full.json<{ data: object }>().data },
    });

    const keys = await call('GET', '/api-keys', meta.token);
    const inquiry = await call('GET', `/inquiries/${inquiryId}`, meta.token);
    const event = await call('GET', `/events/${eventId}`, meta.token);
    const missing = await call('GET', `/inquiries/${newId('inq')}`, meta.token);

    expect(keys.statusCode, keys.body).toBe(200);
    // The blocklist names `scopes` (as a value of its own attribute); no key carries the member.
    expect(
      keys
        .json<{ data: { attributes: object }[] }>()
        .data.map(({ attributes }) => 'scopes' in attributes),
    ).not.toContain(true);
    expect(inquiry.statusCode, inquiry.body).toBe(200);
    expect(inquiry.json<{ data: { id: string; attributes: object } }>().data).toMatchObject({
      id: inquiryId,
      attributes: { status: expect.any(String) as unknown },
    });
    expect(inquiry.body).not.toContain('reference-id');
    expect(inquiry.body).not.toContain('"fields"');
    expect(event.statusCode, event.body).toBe(200);
    expect(event.body).toContain(inquiryId);
    expect(event.body).not.toContain('ref-synthetic');
    expect(missing.statusCode).toBe(404);
    expect(missing.json<{ status: number }>().status).toBe(404);
    await vi.waitFor(async () => {
      const logs = await listApiLogs(api.database.db, tenant.environmentId, {
        apiKeyId: blocked.id,
      });
      const logged = logs.items
        .filter((log) => log.path === `/api/v1/inquiries/${inquiryId}`)
        .map((log) => JSON.stringify(log.responseBody));
      expect(logged).toHaveLength(1);
      expect(logged[0]).toContain(inquiryId);
      expect(logged[0]).not.toContain('ref-synthetic');
    });
  });
});

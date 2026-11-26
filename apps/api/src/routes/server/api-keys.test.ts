import {
  apiKeyDocumentSchema,
  apiKeyListDocumentSchema,
  createdApiKeyDocumentSchema,
  LATEST_API_VERSION,
  newId,
  type ApiKeyResource,
} from '@openverify/contracts';
import { BUILTIN_ROLES } from '@openverify/core';
import { getApiKey } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { createDbApiKeyAuthenticator } from '../../auth/api-key-lookup.js';
import { routesOf } from '../../test-support/plugins.js';
import {
  bearer,
  createInquiry,
  createTestApi,
  expectStatus,
  TEST_PEPPER,
  type TestApi,
  type TestApp,
} from '../../test-support/harness.js';
import type { ApiDependencies } from '../../services/context.js';
import { apiKeyRoutes } from './api-keys.js';

let api: TestApi;
/** The API with the pepper new keys are hashed with, on the harness database. */
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
const HOUR = 3_600_000;

function create(token: string, attributes: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: URL,
    headers: bearer(token),
    payload: { data: { type: 'api-key', attributes } },
  });
}

async function createKey(token: string, attributes: Record<string, unknown> = {}) {
  const response = await create(token, {
    name: 'Backend',
    scopes: ['inquiries:read'],
    ...attributes,
  });
  return createdApiKeyDocumentSchema.parse(expectStatus(response, 201));
}

function action(token: string, id: string, name: string, meta?: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `${URL}/${id}/${name}`,
    headers: bearer(token),
    ...(meta === undefined ? {} : { payload: { meta } }),
  });
}

const attributesOf = (resource: ApiKeyResource) => resource.attributes;

describe('POST /api/v1/api-keys', () => {
  it('creates a key and returns its token once, in meta.token', async () => {
    const tenant = await api.newTenant();

    const response = await create(tenant.token, {
      name: 'Billing backend',
      scopes: ['inquiries:read', 'events:read'],
      'allowed-ips': ['203.0.113.0/24'],
    });

    const document = createdApiKeyDocumentSchema.parse(expectStatus(response, 201));
    expect(response.headers.location).toBe(`${URL}/${document.data.id}`);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(document.meta.token).toMatch(/^ov_sbx_[\w-]{43}$/);
    expect(attributesOf(document.data)).toEqual({
      name: 'Billing backend',
      scopes: ['inquiries:read', 'events:read'],
      'allowed-ips': ['203.0.113.0/24'],
      'api-version': LATEST_API_VERSION,
      'token-prefix': document.meta.token.slice(0, 11),
      'expires-at': null,
      'last-used-at': null,
      'created-at': expect.stringMatching(/Z$/) as unknown,
      'pii-masked': false,
      // C169.1-C169.3 (Workflow 9B).
      note: null,
      'attribute-blocklist': [],
      'age-warning': false,
    });
    const stored = await getApiKey(api.database.db, tenant.environmentId, document.data.id);
    expect(stored?.secretHash).not.toContain(document.meta.token);
    expect(JSON.stringify(stored)).not.toContain(document.meta.token);
  });

  it('issues a token that authenticates with exactly the granted scopes', async () => {
    const tenant = await api.newTenant();
    const { meta } = await createKey(tenant.token, { scopes: ['api-keys:read'] });

    const allowed = await app.inject({ url: URL, headers: bearer(meta.token) });
    const refused = await app.inject({ url: '/api/v1/events', headers: bearer(meta.token) });

    expect(allowed.statusCode).toBe(200);
    expect(refused.statusCode).toBe(403);
  });

  it('issues production keys in a production environment', async () => {
    const tenant = await api.newTenant({ kind: 'production' });

    const { meta, data } = await createKey(tenant.token);

    expect(meta.token).toMatch(/^ov_prod_/);
    expect(data.attributes['token-prefix']).toMatch(/^ov_prod_[\w-]{4}$/);
  });

  it('records an audit entry without the token', async () => {
    const tenant = await api.newTenant();

    const { data, meta } = await createKey(tenant.token, { scopes: ['events:read'] });

    const entries = api.audit.entries.filter((entry) => entry.resourceId === data.id);
    expect(entries).toEqual([
      expect.objectContaining({
        environmentId: tenant.environmentId,
        organizationId: tenant.organizationId,
        actor: { type: 'api-key', id: expect.stringMatching(/^key_/) as unknown },
        action: 'api-key.created',
        resourceType: 'api-key',
        resourceId: data.id,
        metadata: { scopes: ['events:read'] },
      }),
    ]);
    expect(JSON.stringify(api.audit.entries)).not.toContain(meta.token);
  });

  it('lets a user grant the scopes it holds, as itself', async () => {
    const tenant = await api.newTenant();
    const userId = newId('usr');
    const token = api.newUserToken(tenant.environmentId, {
      permissions: ['api-keys:write', 'inquiries:read', 'pii:view'],
      userId,
    });

    const { data } = await createKey(token, { scopes: ['inquiries:read'] });

    expect(api.audit.withAction('api-key.created').at(-1)?.actor).toEqual({
      type: 'user',
      id: userId,
    });
    const stored = await getApiKey(api.database.db, tenant.environmentId, data.id);
    expect(stored?.createdById).toBe(userId);
  });

  it('answers 403 forbidden when asked for a scope the caller does not hold', async () => {
    const tenant = await api.newTenant();
    const user = api.newUserToken(tenant.environmentId, {
      permissions: ['api-keys:write', 'api-keys:read', 'inquiries:read'],
    });
    const key = await api.newApiKey(tenant.environmentId, {
      scopes: ['api-keys:write', 'events:read'],
    });

    for (const token of [user, key]) {
      const response = await create(token, {
        name: 'Escalation',
        scopes: ['inquiries:read', 'events:read', 'webhooks:write'],
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        type: 'https://openverify.dev/problems/forbidden',
        detail: expect.stringContaining('webhooks:write') as unknown,
      });
    }
    const list = await app.inject({ url: URL, headers: bearer(user) });
    expect(apiKeyListDocumentSchema.parse(expectStatus(list, 200)).data).toHaveLength(2);
  });

  it('answers 403 forbidden without api-keys:write', async () => {
    const tenant = await api.newTenant();
    const token = api.newUserToken(tenant.environmentId, { permissions: ['api-keys:read'] });

    const response = await create(token, { name: 'Nope', scopes: ['api-keys:read'] });

    expect(response.statusCode).toBe(403);
  });

  it.each([
    ['no scopes', { name: 'X', scopes: [] }],
    ['an unknown scope', { name: 'X', scopes: ['everything:all'] }],
    ['duplicate scopes', { name: 'X', scopes: ['events:read', 'events:read'] }],
    ['a range that is not CIDR', { name: 'X', scopes: ['events:read'], 'allowed-ips': ['nope'] }],
    ['an unknown version', { name: 'X', scopes: ['events:read'], 'api-version': '2020-01-01' }],
    ['no name', { scopes: ['events:read'] }],
  ])('answers 400 for %s', async (_label, attributes) => {
    const response = await create(api.token, attributes);

    expect(response.statusCode).toBe(400);
  });

  it('answers 422 for a range with host bits set, naming it', async () => {
    const response = await create(api.token, {
      name: 'Bad range',
      scopes: ['events:read'],
      'allowed-ips': ['198.51.100.0/24', '203.0.113.5/24'],
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      errors: [{ pointer: '/data/attributes/allowed-ips/1' }],
    });
  });

  it('accepts IPv6 ranges and an empty list, which allows every address', async () => {
    const tenant = await api.newTenant();

    const v6 = await createKey(tenant.token, { 'allowed-ips': ['2001:db8::/32'] });
    const any = await createKey(tenant.token, { 'allowed-ips': [] });

    expect(v6.data.attributes['allowed-ips']).toEqual(['2001:db8::/32']);
    expect(any.data.attributes['allowed-ips']).toEqual([]);
  });

  it('answers 500 rather than issue unhashable tokens when the API has no pepper', async () => {
    const authenticator = createDbApiKeyAuthenticator({ db: api.database.db, pepper: TEST_PEPPER });
    const unconfigured = buildApp({
      lookupApiKey: authenticator.lookup,
      logger: false,
      mode: 'test',
      api: api.deps,
    });

    const response = await unconfigured.inject({
      method: 'POST',
      url: URL,
      headers: bearer(api.token),
      payload: { data: { type: 'api-key', attributes: { name: 'X', scopes: ['events:read'] } } },
    });
    await unconfigured.close();

    expect(response.statusCode).toBe(500);
  });
});

describe('PII visibility of the keys a principal mints (2B F001)', () => {
  const FIELDS = { name_first: 'Synthetic Jane' };

  async function fieldsSeenBy(token: string, inquiryId: string): Promise<unknown> {
    const response = await app.inject({
      url: `/api/v1/inquiries/${inquiryId}`,
      headers: bearer(token),
    });
    return expectStatus(response, 200).data.attributes.fields;
  }

  async function setup() {
    const tenant = await api.newTenant();
    const inquiryId = await createInquiry(api, { token: tenant.token, fields: FIELDS });
    const developer = api.newUserToken(tenant.environmentId, {
      permissions: BUILTIN_ROLES.developer.permissions,
    });
    return { tenant, inquiryId, developer };
  }

  it('masks PII for a key minted by a user without pii:view, as that user sees it', async () => {
    const { inquiryId, developer } = await setup();
    expect(await fieldsSeenBy(developer, inquiryId)).toEqual({ name_first: null });

    const { meta } = await createKey(developer, { scopes: ['inquiries:read'] });

    expect(await fieldsSeenBy(meta.token, inquiryId)).toEqual({ name_first: null });
  });

  it('keeps PII visible for keys minted by a user with pii:view or by an unmasked key', async () => {
    const { tenant, inquiryId } = await setup();
    const reviewer = api.newUserToken(tenant.environmentId, {
      permissions: ['api-keys:write', 'inquiries:read', 'pii:view'],
    });

    const byUser = await createKey(reviewer, { scopes: ['inquiries:read'] });
    const byKey = await createKey(tenant.token, { scopes: ['inquiries:read'] });

    expect(await fieldsSeenBy(byUser.meta.token, inquiryId)).toEqual(FIELDS);
    expect(await fieldsSeenBy(byKey.meta.token, inquiryId)).toEqual(FIELDS);
  });

  it('passes masking on to the keys a masked key mints and to clones', async () => {
    const { tenant, inquiryId, developer } = await setup();
    const masked = await createKey(developer, { scopes: ['api-keys:write', 'inquiries:read'] });
    const unmasked = await createKey(tenant.token, { scopes: ['inquiries:read'] });

    const minted = await createKey(masked.meta.token, { scopes: ['inquiries:read'] });
    const cloneOfMasked = createdApiKeyDocumentSchema.parse(
      expectStatus(await action(tenant.token, masked.data.id, 'clone'), 201),
    );
    const cloneByDeveloper = createdApiKeyDocumentSchema.parse(
      expectStatus(await action(developer, unmasked.data.id, 'clone'), 201),
    );

    for (const token of [
      minted.meta.token,
      cloneOfMasked.meta.token,
      cloneByDeveloper.meta.token,
    ]) {
      expect(await fieldsSeenBy(token, inquiryId)).toEqual({ name_first: null });
    }
  });
});

describe('GET /api/v1/api-keys', () => {
  it("lists the environment's keys newest first, in pages", async () => {
    const tenant = await api.newTenant();
    const first = await createKey(tenant.token, { name: 'First' });
    api.clock.advance(1_000);
    const second = await createKey(tenant.token, { name: 'Second' });

    const page = apiKeyListDocumentSchema.parse(
      expectStatus(
        await app.inject({ url: `${URL}?page[size]=2`, headers: bearer(tenant.token) }),
        200,
      ),
    );
    const rest = apiKeyListDocumentSchema.parse(
      expectStatus(
        await app.inject({ url: page.links.next ?? '', headers: bearer(tenant.token) }),
        200,
      ),
    );

    expect(page.data.map((key) => key.id).slice(0, 2)).toEqual([second.data.id, first.data.id]);
    expect(rest.data.map((key) => key.attributes.name)).toEqual(['Test key']);
  });

  it('shows keys made before token prefixes were kept with an unknown prefix', async () => {
    const tenant = await api.newTenant();

    const page = apiKeyListDocumentSchema.parse(
      expectStatus(await app.inject({ url: URL, headers: bearer(tenant.token) }), 200),
    );

    expect(page.data.map((key) => key.attributes['token-prefix'])).toEqual(['ov_sbx_----']);
  });

  it("never lists another environment's keys", async () => {
    const tenant = await api.newTenant();
    const other = await api.newTenant();
    await createKey(other.token);

    const page = apiKeyListDocumentSchema.parse(
      expectStatus(await app.inject({ url: URL, headers: bearer(tenant.token) }), 200),
    );

    expect(page.data).toHaveLength(1);
  });

  it('answers 403 forbidden without api-keys:read', async () => {
    const token = api.newUserToken(api.environmentId, { permissions: ['api-keys:write'] });

    const response = await app.inject({ url: URL, headers: bearer(token) });

    expect(response.statusCode).toBe(403);
  });
});

describe('GET /api/v1/api-keys/:id', () => {
  it('returns one key, never its token or hash', async () => {
    const { data, meta } = await createKey(api.token, { name: 'Fetched' });

    const response = await app.inject({ url: `${URL}/${data.id}`, headers: bearer(api.token) });

    const document = apiKeyDocumentSchema.parse(expectStatus(response, 200));
    expect(document.data).toEqual(data);
    expect(response.body).not.toContain(meta.token);
    expect(response.body).not.toContain('secret');
  });

  it("answers 404 for another environment's key and 400 for a malformed id", async () => {
    const other = await api.newTenant();
    const { data } = await createKey(other.token);

    const foreign = await app.inject({ url: `${URL}/${data.id}`, headers: bearer(api.token) });
    const malformed = await app.inject({ url: `${URL}/wbh_x`, headers: bearer(api.token) });

    expect(foreign.statusCode).toBe(404);
    expect(malformed.statusCode).toBe(400);
  });

  it('answers 403 forbidden without api-keys:read', async () => {
    const { data } = await createKey(api.token);
    const token = api.newUserToken(api.environmentId, { permissions: ['events:read'] });

    const response = await app.inject({ url: `${URL}/${data.id}`, headers: bearer(token) });

    expect(response.statusCode).toBe(403);
  });
});

describe('PATCH /api/v1/api-keys/:id', () => {
  function patch(token: string, id: string, attributes: Record<string, unknown>) {
    return app.inject({
      method: 'PATCH',
      url: `${URL}/${id}`,
      headers: bearer(token),
      payload: { data: { type: 'api-key', attributes } },
    });
  }

  it('renames a key and replaces its allowed ranges, which then apply', async () => {
    const tenant = await api.newTenant();
    const { data, meta } = await createKey(tenant.token, { scopes: ['api-keys:read'] });

    const response = await patch(tenant.token, data.id, {
      name: 'Renamed',
      'allowed-ips': ['198.51.100.0/24'],
    });
    const outside = await app.inject({
      url: URL,
      headers: bearer(meta.token),
      remoteAddress: '203.0.113.1',
    });
    const inside = await app.inject({
      url: URL,
      headers: bearer(meta.token),
      remoteAddress: '198.51.100.7',
    });

    const document = apiKeyDocumentSchema.parse(expectStatus(response, 200));
    expect(document.data.attributes).toMatchObject({
      name: 'Renamed',
      'allowed-ips': ['198.51.100.0/24'],
      scopes: ['api-keys:read'],
    });
    expect(outside.statusCode).toBe(403);
    expect(inside.statusCode).toBe(200);
    expect(api.audit.withAction('api-key.updated').at(-1)).toMatchObject({
      resourceId: data.id,
      metadata: { changed: ['name', 'allowed-ips'] },
    });
  });

  it('answers 400 for a change of scopes, which keys never get', async () => {
    const { data } = await createKey(api.token);

    const response = await patch(api.token, data.id, { scopes: ['events:read'] });

    expect(response.statusCode).toBe(400);
  });

  it("answers 404 for another environment's key and 403 without api-keys:write", async () => {
    const other = await api.newTenant();
    const { data } = await createKey(other.token);
    const reader = api.newUserToken(other.environmentId, { permissions: ['api-keys:read'] });

    expect((await patch(api.token, data.id, { name: 'X' })).statusCode).toBe(404);
    expect((await patch(reader, data.id, { name: 'X' })).statusCode).toBe(403);
  });
});

describe('POST /api/v1/api-keys/:id/clone', () => {
  it('creates a key with the same scopes, ranges and version and a new token', async () => {
    const tenant = await api.newTenant();
    const source = await createKey(tenant.token, {
      name: 'Original',
      scopes: ['events:read', 'inquiries:read'],
      'allowed-ips': ['203.0.113.0/24'],
    });

    const response = await action(tenant.token, source.data.id, 'clone', { name: 'Rotated' });

    const clone = createdApiKeyDocumentSchema.parse(expectStatus(response, 201));
    expect(clone.data.id).not.toBe(source.data.id);
    expect(clone.meta.token).not.toBe(source.meta.token);
    expect(clone.data.attributes).toMatchObject({
      name: 'Rotated',
      scopes: ['events:read', 'inquiries:read'],
      'allowed-ips': ['203.0.113.0/24'],
      'api-version': source.data.attributes['api-version'],
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(api.audit.withAction('api-key.cloned').at(-1)).toMatchObject({
      resourceId: clone.data.id,
      metadata: { 'source-api-key-id': source.data.id },
    });
  });

  it("keeps the source's name when none is given", async () => {
    const source = await createKey(api.token, { name: 'Keep me' });

    const response = await action(api.token, source.data.id, 'clone');

    expect(
      createdApiKeyDocumentSchema.parse(expectStatus(response, 201)).data.attributes.name,
    ).toBe('Keep me');
  });

  it('answers 403 forbidden when the source holds scopes the caller does not', async () => {
    const tenant = await api.newTenant();
    const source = await createKey(tenant.token, { scopes: ['webhooks:write'] });
    const token = api.newUserToken(tenant.environmentId, { permissions: ['api-keys:write'] });

    const response = await action(token, source.data.id, 'clone');

    expect(response.statusCode).toBe(403);
  });

  it("answers 404 for another environment's key", async () => {
    const other = await api.newTenant();
    const { data } = await createKey(other.token);

    expect((await action(api.token, data.id, 'clone')).statusCode).toBe(404);
  });
});

describe('POST /api/v1/api-keys/:id/expire', () => {
  it('expires a key now with 0 seconds, so its token stops working', async () => {
    const tenant = await api.newTenant();
    const { data, meta } = await createKey(tenant.token, { scopes: ['api-keys:read'] });

    const response = await action(tenant.token, data.id, 'expire', { 'expires-in-seconds': 0 });
    const after = await app.inject({ url: URL, headers: bearer(meta.token) });

    const document = apiKeyDocumentSchema.parse(expectStatus(response, 200));
    expect(document.data.attributes['expires-at']).toBe(api.clock.now().toISOString());
    expect(after.statusCode).toBe(401);
    expect(api.audit.withAction('api-key.expired').at(-1)).toMatchObject({
      resourceId: data.id,
      metadata: { 'expires-at': api.clock.now().toISOString() },
    });
  });

  it('schedules the expiry, and the key works until then', async () => {
    const tenant = await api.newTenant();
    const { data, meta } = await createKey(tenant.token, { scopes: ['api-keys:read'] });

    const response = await action(tenant.token, data.id, 'expire', { 'expires-in-seconds': 3_600 });
    const before = await app.inject({ url: URL, headers: bearer(meta.token) });

    expect(
      apiKeyDocumentSchema.parse(expectStatus(response, 200)).data.attributes['expires-at'],
    ).toBe(new Date(api.clock.now().getTime() + HOUR).toISOString());
    expect(before.statusCode).toBe(200);
  });

  it('never moves an earlier expiry later', async () => {
    const tenant = await api.newTenant();
    const { data } = await createKey(tenant.token);
    await action(tenant.token, data.id, 'expire', { 'expires-in-seconds': 600 });

    const response = await action(tenant.token, data.id, 'expire', {
      'expires-in-seconds': 86_400,
    });

    expect(
      apiKeyDocumentSchema.parse(expectStatus(response, 200)).data.attributes['expires-at'],
    ).toBe(new Date(api.clock.now().getTime() + 600_000).toISOString());
  });

  it.each([
    ['no body', undefined],
    ['a negative delay', { 'expires-in-seconds': -1 }],
    ['more than 30 days', { 'expires-in-seconds': 2_592_001 }],
  ])('answers 400 for %s', async (_label, meta) => {
    const { data } = await createKey(api.token);

    expect((await action(api.token, data.id, 'expire', meta)).statusCode).toBe(400);
  });

  it("answers 404 for another environment's key and 403 without api-keys:write", async () => {
    const other = await api.newTenant();
    const { data } = await createKey(other.token);
    const reader = api.newUserToken(other.environmentId, { permissions: ['api-keys:read'] });

    expect(
      (await action(api.token, data.id, 'expire', { 'expires-in-seconds': 0 })).statusCode,
    ).toBe(404);
    expect((await action(reader, data.id, 'expire', { 'expires-in-seconds': 0 })).statusCode).toBe(
      403,
    );
  });
});

describe('expiry on creation (C25.5, Workflow 2E)', () => {
  it('creates a key that expires expires-in-seconds later, after which it answers 401', async () => {
    const tenant = await api.newTenant();
    const createdAt = api.clock.now();

    const { data, meta } = await createKey(tenant.token, {
      scopes: ['api-keys:read'],
      'expires-in-seconds': 3_600,
    });
    const before = await app.inject({ url: URL, headers: bearer(meta.token) });
    api.clock.advance(HOUR);
    const after = await app.inject({ url: URL, headers: bearer(meta.token) });
    api.clock.set(createdAt);

    const expiresAt = new Date(createdAt.getTime() + HOUR).toISOString();
    expect(data.attributes['expires-at']).toBe(expiresAt);
    expect(before.statusCode).toBe(200);
    expect(after.statusCode).toBe(401);
    expect(after.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(api.audit.withAction('api-key.created').at(-1)).toMatchObject({
      resourceId: data.id,
      metadata: { scopes: ['api-keys:read'], 'expires-at': expiresAt },
    });
  });

  it('never expires a key created without it', async () => {
    const tenant = await api.newTenant();
    const createdAt = api.clock.now();

    const { data, meta } = await createKey(tenant.token, { scopes: ['api-keys:read'] });
    api.clock.advance(365 * 24 * HOUR);
    const later = await app.inject({ url: URL, headers: bearer(meta.token) });
    api.clock.set(createdAt);

    expect(data.attributes['expires-at']).toBeNull();
    expect(later.statusCode).toBe(200);
  });

  it.each([0, -1, 2_592_001, 1.5, '60'])('answers 400 for expires-in-seconds %s', async (value) => {
    const response = await create(api.token, {
      name: 'Backend',
      scopes: ['inquiries:read'],
      'expires-in-seconds': value,
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('pii-masked on API keys (C25.6, Workflow 2E)', () => {
  it('shows on the create, list, get, update and clone answers', async () => {
    const tenant = await api.newTenant();
    const developer = api.newUserToken(tenant.environmentId, {
      permissions: BUILTIN_ROLES.developer.permissions,
    });
    const masked = await createKey(developer, { name: 'Masked', scopes: ['inquiries:read'] });
    const unmasked = await createKey(tenant.token, { name: 'Unmasked' });

    const listed = apiKeyListDocumentSchema.parse(
      expectStatus(await app.inject({ url: URL, headers: bearer(tenant.token) }), 200),
    );
    const got = apiKeyDocumentSchema.parse(
      expectStatus(
        await app.inject({ url: `${URL}/${masked.data.id}`, headers: bearer(tenant.token) }),
        200,
      ),
    );
    const updated = apiKeyDocumentSchema.parse(
      expectStatus(
        await app.inject({
          method: 'PATCH',
          url: `${URL}/${masked.data.id}`,
          headers: bearer(tenant.token),
          payload: { data: { type: 'api-key', attributes: { name: 'Still masked' } } },
        }),
        200,
      ),
    );
    const clone = createdApiKeyDocumentSchema.parse(
      expectStatus(await action(tenant.token, masked.data.id, 'clone'), 201),
    );

    expect(masked.data.attributes).toMatchObject({ 'pii-masked': true });
    expect(unmasked.data.attributes).toMatchObject({ 'pii-masked': false });
    expect(
      Object.fromEntries(listed.data.map((key) => [key.id, key.attributes['pii-masked']])),
    ).toMatchObject({ [masked.data.id]: true, [unmasked.data.id]: false });
    expect(got.data.attributes).toMatchObject({ 'pii-masked': true });
    expect(updated.data.attributes).toMatchObject({ 'pii-masked': true });
    expect(clone.data.attributes).toMatchObject({ 'pii-masked': true });
  });

  it('cannot be chosen: a create or update that sends it answers 400', async () => {
    const { data } = await createKey(api.token);

    const created = await create(api.token, {
      name: 'Chooser',
      scopes: ['inquiries:read'],
      'pii-masked': false,
    });
    const updated = await app.inject({
      method: 'PATCH',
      url: `${URL}/${data.id}`,
      headers: bearer(api.token),
      payload: { data: { type: 'api-key', attributes: { 'pii-masked': false } } },
    });

    expect(created.statusCode).toBe(400);
    expect(updated.statusCode).toBe(400);
  });
});

describe('apiKeyRoutes', () => {
  it('registers the C12 API key routes', async () => {
    expect(await routesOf(apiKeyRoutes, {} as ApiDependencies)).toEqual([
      'POST /api-keys',
      'GET /api-keys',
      'HEAD /api-keys',
      'GET /api-keys/:id',
      'HEAD /api-keys/:id',
      'PATCH /api-keys/:id',
      'POST /api-keys/:id/clone',
      // C169.1 (Workflow 9B Stage 1b (W)): frozen for api-keys-webhooks.
      'POST /api-keys/:id/rotate',
      'POST /api-keys/:id/expire',
    ]);
  });
});

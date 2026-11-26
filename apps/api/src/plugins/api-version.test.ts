import { LATEST_API_VERSION, newId } from '@openverify/contracts';
import { apiKeys, createApiKey, generateApiKey } from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ApiKeyPrincipal } from '../ports.js';
import { registerProblemDetails } from '../problem-details.js';
import { userPrincipal } from '../test-support/principals.js';
import apiVersion, { createApiKeyVersionLookup, type ApiKeyVersionLookup } from './api-version.js';
import principalAuth, { type ApiKeyRecord } from './principal-auth.js';

// Synthetic tokens; real ones come from generateApiKey() and newUserSessionToken().
const KEY_TOKEN = 'ov_sbx_SyntheticApiVersionTokenAAAAAAAAAAAAAAAAAAA';
const UNKNOWN_KEY_TOKEN = 'ov_sbx_SyntheticApiVersionTokenBBBBBBBBBBBBBBBBBBB';
const USER_TOKEN = 'ovu_SyntheticApiVersionUserTokenAAAAAAAAAAAAAAAAA';
const HEADER = 'openverify-version';

const key = (id: string): ApiKeyRecord => ({
  id,
  organizationId: 'org_1',
  environmentId: 'env_1',
  environmentKind: 'sandbox',
  scopes: [],
  expiresAt: null,
  revokedAt: null,
});

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function build(versions: Record<string, '2026-10-01' | null> = { key_known: '2026-10-01' }) {
  const lookup = vi.fn<ApiKeyVersionLookup>((principal: ApiKeyPrincipal) =>
    Promise.resolve(versions[principal.apiKeyId] ?? null),
  );
  const app = Fastify({ logger: false });
  apps.push(app);
  registerProblemDetails(app, { exposeInternals: true });
  // A scope created before the decorations, as @fastify/swagger's routes are.
  void app.register((early, _options, next) => {
    early.get('/early', { config: { public: true } }, () => ({ early: true }));
    next();
  });
  void app.register(principalAuth, {
    lookupApiKey: (token) =>
      Promise.resolve(
        token === KEY_TOKEN
          ? key('key_known')
          : token === UNKNOWN_KEY_TOKEN
            ? key('key_new')
            : null,
      ),
    resolveUserSession: (token) =>
      Promise.resolve(
        token === USER_TOKEN
          ? userPrincipal({ organizationId: 'org_1', environmentId: 'env_1' })
          : null,
      ),
  });
  void app.register(apiVersion, { apiKeyVersion: lookup });
  const handler = vi.fn((request: { apiVersion: string | null }) => ({
    version: request.apiVersion,
  }));
  app.get('/api/v1/things', { config: { scopes: [] } }, handler);
  app.get('/health', { config: { public: true } }, () => ({ status: 'ok' }));
  app.get('/api/v1/flow/session', { config: { auth: 'session-token' } }, () => ({ flow: true }));
  return { app, lookup, handler };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('OpenVerify-Version (C12)', () => {
  it("applies the API key's version when the request names none, and echoes it", async () => {
    const { app } = build();

    const response = await app.inject({ url: '/api/v1/things', headers: bearer(KEY_TOKEN) });

    expect(response.statusCode).toBe(200);
    expect(response.headers[HEADER]).toBe('2026-10-01');
    expect(response.json()).toEqual({ version: '2026-10-01' });
  });

  it('applies a supported version named in the request', async () => {
    const { app, lookup } = build();

    const response = await app.inject({
      url: '/api/v1/things',
      headers: { ...bearer(KEY_TOKEN), [HEADER]: '2026-10-01' },
    });

    expect(response.headers[HEADER]).toBe('2026-10-01');
    expect(response.json()).toEqual({ version: '2026-10-01' });
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each(['2020-01-01', 'latest', '2026-10-01, 2026-10-01', ''])(
    'answers 400 unsupported-api-version for %j and echoes the version that applies',
    async (requested) => {
      const { app, handler } = build();

      const response = await app.inject({
        url: '/api/v1/things',
        headers: { ...bearer(KEY_TOKEN), [HEADER]: requested },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        type: 'https://openverify.dev/problems/unsupported-api-version',
        status: 400,
        detail: expect.stringContaining(LATEST_API_VERSION) as unknown,
      });
      expect(response.headers[HEADER]).toBe('2026-10-01');
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it('gives dashboard user sessions the latest version', async () => {
    const { app, lookup } = build();

    const response = await app.inject({ url: '/api/v1/things', headers: bearer(USER_TOKEN) });

    expect(response.headers[HEADER]).toBe(LATEST_API_VERSION);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('falls back to the latest version for a key without a recorded version', async () => {
    const { app } = build({});

    const response = await app.inject({
      url: '/api/v1/things',
      headers: bearer(UNKNOWN_KEY_TOKEN),
    });

    expect(response.headers[HEADER]).toBe(LATEST_API_VERSION);
  });

  it('echoes a version on server API responses refused before authentication', async () => {
    const { app } = build();

    const anonymous = await app.inject({ url: '/api/v1/things' });
    const named = await app.inject({ url: '/api/v1/things', headers: { [HEADER]: '2026-10-01' } });
    const invalid = await app.inject({ url: '/api/v1/things', headers: { [HEADER]: 'nope' } });

    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.headers[HEADER]).toBe(LATEST_API_VERSION);
    expect(named.headers[HEADER]).toBe('2026-10-01');
    expect(invalid.headers[HEADER]).toBe(LATEST_API_VERSION);
  });

  it('leaves public routes and other APIs alone', async () => {
    const { app } = build();
    const early = await app.inject({ url: '/early' });
    expect(early.statusCode).toBe(200);
    expect(early.headers[HEADER]).toBeUndefined();

    const health = await app.inject({ url: '/health' });
    const flow = await app.inject({ url: '/api/v1/flow/session' });
    const unknown = await app.inject({ url: '/api/v1/nothing-here' });

    expect(health.headers[HEADER]).toBeUndefined();
    expect(flow.headers[HEADER]).toBeUndefined();
    expect(unknown.headers[HEADER]).toBeUndefined();
  });
});

describe('createApiKeyVersionLookup', () => {
  let database: TestDatabase;
  let environmentId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    ({
      environment: { id: environmentId },
    } = await createTestTenant(database.db));
  });

  afterAll(async () => {
    await database.close();
  });

  async function newKey(): Promise<ApiKeyPrincipal> {
    const generated = generateApiKey('sandbox', new Uint8Array(32).fill(7));
    const row = await createApiKey(database.db, environmentId, {
      id: newId('key'),
      name: 'Version probe',
      prefix: generated.prefix,
      secretHash: generated.secretHash,
    });
    return {
      kind: 'api-key',
      apiKeyId: row.id,
      organizationId: 'org_1',
      environmentId,
      environmentKind: 'sandbox',
      permissions: new Set(),
    };
  }

  const setStoredVersion = (id: string, version: string) =>
    database.db.update(apiKeys).set({ apiVersion: version }).where(eq(apiKeys.id, id));

  it("reads the key's stored api-version", async () => {
    const principal = await newKey();

    await expect(createApiKeyVersionLookup(database.db)(principal)).resolves.toBe('2026-10-01');
  });

  it('answers null for a key it cannot find, or a version the API no longer knows', async () => {
    const lookup = createApiKeyVersionLookup(database.db);
    const principal = await newKey();
    await setStoredVersion(principal.apiKeyId, '1999-01-01');

    await expect(lookup({ ...principal, apiKeyId: newId('key') })).resolves.toBeNull();
    await expect(lookup(principal)).resolves.toBeNull();
  });

  it('caches versions, which never change after creation, in a bounded map', async () => {
    const lookup = createApiKeyVersionLookup(database.db, { maxEntries: 1 });
    const first = await newKey();
    const second = await newKey();

    await lookup(first);
    await setStoredVersion(first.apiKeyId, '1999-01-01');
    await expect(lookup(first)).resolves.toBe('2026-10-01');

    await lookup(second);
    await expect(lookup(first)).resolves.toBeNull();
  });
});

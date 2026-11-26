/**
 * C247.3 (Phase 11, Workflow 11B, auth-sessions; review B3-E1): no route that mints an API key
 * grants more than its caller holds, and a user without `environments:production` cannot mint a
 * production key. The bound is Phase 9's `ensureCanGrant` (amendment 8); these tests cover every
 * route that mints one, read from the OpenAPI document so that a new minting route fails here
 * until it is covered. The refusal stays 403 `forbidden` naming the missing scopes (amendment 8:
 * no `scope_exceeds_creator` code).
 */
import { readFileSync } from 'node:fs';
import {
  apiKeyListDocumentSchema,
  createdApiKeyDocumentSchema,
  newId,
  newUserSessionToken,
} from '@openverify/contracts';
import {
  createRole,
  createUser,
  createUserSession,
  hashSessionToken,
  listApiKeys,
  setUserRoles,
} from '@openverify/db';
import { createTestTenant } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { createDbApiKeyAuthenticator } from '../../auth/api-key-lookup.js';
import { createUserSessionPrincipalResolver } from '../../operator-auth/principal-resolver.js';
import {
  bearer,
  createTestApi,
  expectStatus,
  TEST_PEPPER,
  type TestApi,
  type TestApp,
} from '../../test-support/harness.js';

let api: TestApi;
/** API keys and the harness's user sessions. */
let app: TestApp;
/** API keys and real `ovu_` sessions resolved from `user_sessions` (C12, C167.2). */
let sessions: TestApp;

beforeAll(async () => {
  api = await createTestApi();
  const authenticator = createDbApiKeyAuthenticator({
    db: api.database.db,
    pepper: TEST_PEPPER,
    clock: api.clock,
  });
  const common = {
    lookupApiKey: authenticator.lookup,
    onAuthenticated: authenticator.touch,
    now: () => api.clock.now(),
    logger: false,
    mode: 'test',
    api: api.deps,
    apiKeyPepper: TEST_PEPPER,
  } as const;
  app = buildApp(common);
  sessions = buildApp({
    ...common,
    resolveUserSession: createUserSessionPrincipalResolver({
      db: api.database.db,
      clock: api.clock,
    }),
  });
});

afterAll(async () => {
  await app.close();
  await sessions.close();
  await api.close();
});

const BASE = '/api/v1';
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

interface OpenApiOperation {
  responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
}
interface OpenApiDocument {
  paths: Record<string, Partial<Record<(typeof HTTP_METHODS)[number], OpenApiOperation>>>;
  components?: { schemas?: Record<string, unknown> };
}

const openapi = JSON.parse(
  readFileSync(new URL('../../../../../docs/api/openapi.json', import.meta.url), 'utf8'),
) as OpenApiDocument;

/** Whether `schema` (through `$ref`s and compositions) is a document with `meta.token`. */
function answersToken(schema: unknown, depth = 0): boolean {
  if (depth > 16 || typeof schema !== 'object' || schema === null) {
    return false;
  }
  const node = schema as Record<string, unknown>;
  if (typeof node.$ref === 'string') {
    const name = node.$ref.split('/').at(-1) ?? '';
    return answersToken(openapi.components?.schemas?.[name], depth + 1);
  }
  const properties = (node.properties ?? {}) as Record<string, unknown>;
  const meta = properties.meta as Record<string, unknown> | undefined;
  if (meta !== undefined) {
    const resolved =
      typeof meta.$ref === 'string'
        ? (openapi.components?.schemas?.[meta.$ref.split('/').at(-1) ?? ''] as
            Record<string, unknown> | undefined)
        : meta;
    const metaProperties = (resolved?.properties ?? {}) as Record<string, unknown>;
    if ('token' in metaProperties) {
      return true;
    }
  }
  return ['allOf', 'anyOf', 'oneOf'].some((key) =>
    ((node[key] as unknown[] | undefined) ?? []).some((part) => answersToken(part, depth + 1)),
  );
}

/** Every operation whose success answer hands out a new key's token. */
function mintingOperations(): string[] {
  const found: string[] = [];
  for (const [path, operations] of Object.entries(openapi.paths)) {
    for (const method of HTTP_METHODS) {
      const responses = operations[method]?.responses ?? {};
      const mints = Object.entries(responses).some(
        ([status, response]) =>
          status.startsWith('2') &&
          Object.values(response.content ?? {}).some(({ schema }) => answersToken(schema)),
      );
      if (mints) {
        found.push(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  return found.sort();
}

function call(
  target: TestApp,
  method: 'GET' | 'POST',
  url: string,
  token: string,
  payload?: unknown,
) {
  return target.inject({
    method,
    url: `${BASE}${url}`,
    headers: bearer(token),
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

async function createKey(token: string, scopes: readonly string[]) {
  const response = await call(app, 'POST', '/api-keys', token, {
    data: { type: 'api-key', attributes: { name: 'Synthetic source', scopes } },
  });
  return createdApiKeyDocumentSchema.parse(expectStatus(response, 201)).data;
}

/** How each minting route is asked to mint, from a caller, for a key holding `scopes`. */
const MINTERS: Record<
  string,
  (
    caller: string,
    owner: string,
    scopes: readonly string[],
  ) => Promise<{ statusCode: number; body: string; json(): unknown }>
> = {
  'POST /api/v1/api-keys': (caller, _owner, scopes) =>
    call(app, 'POST', '/api-keys', caller, {
      data: { type: 'api-key', attributes: { name: 'Synthetic escalation', scopes } },
    }),
  'POST /api/v1/api-keys/{id}/clone': async (caller, owner, scopes) => {
    const source = await createKey(owner, scopes);
    return call(app, 'POST', `/api-keys/${source.id}/clone`, caller);
  },
  'POST /api/v1/api-keys/{id}/rotate': async (caller, owner, scopes) => {
    const source = await createKey(owner, scopes);
    return call(app, 'POST', `/api-keys/${source.id}/rotate`, caller, {
      meta: { 'previous-expires-in-seconds': 0 },
    });
  },
};

describe('C247.3: every route that mints an API key is bounded by its caller', () => {
  it('knows every minting route of the OpenAPI document (a new one fails here until covered)', () => {
    expect(mintingOperations()).toEqual(Object.keys(MINTERS).sort());
  });

  describe.each(Object.entries(MINTERS))('%s', (_operation, mint) => {
    it('refuses a key that would hold a scope its API-key caller lacks: 403 forbidden naming it, writing nothing', async () => {
      const tenant = await api.newTenant();
      const narrow = await api.newApiKey(tenant.environmentId, {
        scopes: ['api-keys:write', 'api-keys:read', 'inquiries:read'],
      });
      const before = await call(app, 'GET', '/api-keys', tenant.token);

      const response = await mint(narrow, tenant.token, ['inquiries:read', 'webhooks:write']);

      expect(response.statusCode, response.body).toBe(403);
      expect(response.json()).toMatchObject({
        type: 'https://openverify.dev/problems/forbidden',
        detail: expect.stringContaining('webhooks:write') as unknown,
      });
      expect(response.body).not.toContain('inquiries:read,');
      const after = await call(app, 'GET', '/api-keys', tenant.token);
      const ids = (page: typeof before) =>
        apiKeyListDocumentSchema
          .parse(expectStatus(page, 200))
          .data.map(({ id, attributes }) => `${id}:${String(attributes['expires-at'])}`);
      // The clone and rotate sources are made before the call; nothing else may appear or end.
      expect(ids(after).filter((id) => !ids(before).includes(id)).length).toBeLessThanOrEqual(1);
      expect(ids(after).every((id) => id.endsWith(':null'))).toBe(true);
    });

    it('refuses a user caller the same way', async () => {
      const tenant = await api.newTenant();
      const user = api.newUserToken(tenant.environmentId, {
        permissions: ['api-keys:write', 'api-keys:read', 'inquiries:read', 'pii:view'],
      });

      const response = await mint(user, tenant.token, ['inquiries:read', 'accounts:write']);

      expect(response.statusCode, response.body).toBe(403);
      expect(response.json()).toMatchObject({
        type: 'https://openverify.dev/problems/forbidden',
        detail: expect.stringContaining('accounts:write') as unknown,
      });
    });

    it('mints when the caller holds every scope', async () => {
      const tenant = await api.newTenant();
      const holder = await api.newApiKey(tenant.environmentId, {
        scopes: ['api-keys:write', 'api-keys:read', 'inquiries:read', 'webhooks:write'],
      });

      const response = await mint(holder, tenant.token, ['inquiries:read', 'webhooks:write']);

      expect(response.statusCode, response.body).toBe(201);
    });
  });
});

describe('C247.3: production keys need environments:production', () => {
  async function productionSession(permissions: readonly string[]) {
    const { organization, environment } = await createTestTenant(api.database.db, {
      kind: 'production',
    });
    const user = await createUser(api.database.db, {
      id: newId('usr'),
      organizationId: organization.id,
      email: `scope-bound-${newId('usr').slice(-8).toLowerCase()}@example.com`,
      passwordHash: '$argon2id$synthetic$unused',
    });
    const role = await createRole(api.database.db, organization.id, {
      id: newId('role'),
      name: 'Synthetic key minter',
      permissions,
    });
    await setUserRoles(api.database.db, organization.id, user.id, [role.id]);
    const token = newUserSessionToken();
    await createUserSession(api.database.db, {
      id: newId('uss'),
      organizationId: organization.id,
      userId: user.id,
      environmentId: environment.id,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(api.clock.now().getTime() + 3_600_000),
      mfaSatisfied: true,
    });
    return { environment, token };
  }

  it('lets a user holding it mint an ov_prod_ key in production', async () => {
    const { token } = await productionSession([
      'api-keys:write',
      'inquiries:read',
      'environments:production',
    ]);

    const response = await call(sessions, 'POST', '/api-keys', token, {
      data: { type: 'api-key', attributes: { name: 'Synthetic prod', scopes: ['inquiries:read'] } },
    });

    const created = createdApiKeyDocumentSchema.parse(expectStatus(response, 201));
    expect(created.meta.token.startsWith('ov_prod_')).toBe(true);
  });

  it('never lets a user without it mint one: its production session does not resolve, and no key is written', async () => {
    const { environment, token } = await productionSession(['api-keys:write', 'inquiries:read']);

    const response = await call(sessions, 'POST', '/api-keys', token, {
      data: { type: 'api-key', attributes: { name: 'Synthetic prod', scopes: ['inquiries:read'] } },
    });

    expect(response.statusCode, response.body).toBe(401);
    const keys = await listApiKeys(api.database.db, environment.id);
    expect(keys.items).toEqual([]);
  });
});

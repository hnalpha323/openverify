import type { FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { buildApp } from '../app.js';
import { UnauthorizedError } from '../errors.js';
import type { Principal, PrincipalResolver, UserPrincipal } from '../ports.js';
import {
  authorizePrincipal,
  requirePrincipal,
  type ApiKeyLookup,
  type ApiKeyRecord,
} from './principal-auth.js';

const NOW = new Date('2026-10-20T12:00:00.000Z');
// Synthetic test token; real tokens come from @openverify/db generateApiKey().
const TOKEN = 'ov_sbx_SyntheticTestTokenAAAAAAAAAAAAAAAAAAAAAAAAA';
const PROBLEM_JSON = 'application/problem+json; charset=utf-8';

interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
}

const activeKey: ApiKeyRecord = {
  id: 'key_1',
  organizationId: 'org_1',
  environmentId: 'env_1',
  environmentKind: 'sandbox',
  scopes: ['inquiries:read'],
  expiresAt: null,
  revokedAt: null,
};

/** The Phase 1 view of the authenticated key, so the Phase 1 assertions stay as they were. */
function apiKeyView(principal: Principal | null) {
  return principal?.kind === 'api-key'
    ? {
        id: principal.apiKeyId,
        environmentId: principal.environmentId,
        scopes: [...principal.permissions],
      }
    : null;
}

let record: ApiKeyRecord;
let lookupApiKey: Mock<ApiKeyLookup>;
let app: ReturnType<typeof buildApp>;

beforeEach(() => {
  record = { ...activeKey };
  lookupApiKey = vi.fn<ApiKeyLookup>((token) => Promise.resolve(token === TOKEN ? record : null));
  app = buildApp({ lookupApiKey, logger: false, mode: 'production', now: () => NOW });
  app.get('/inquiries', { config: { scopes: ['inquiries:read'] } }, (request) => ({
    apiKey: apiKeyView(request.principal),
  }));
  app.post('/inquiries', { config: { scopes: ['inquiries:write'] } }, () => ({ created: true }));
  app.get('/whoami', (request) => ({ apiKeyId: apiKeyView(request.principal)?.id }));
});

afterEach(async () => {
  await app.close();
});

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('API key authentication', () => {
  it('rejects a request without an API key with a 401 problem and a Bearer challenge', async () => {
    const response = await app.inject({ url: '/inquiries' });

    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect(response.headers['www-authenticate']).toBe('Bearer realm="openverify"');
    expect(response.json<Problem>()).toMatchObject({
      type: 'about:blank',
      title: 'Unauthorized',
      status: 401,
      detail: 'An API key is required. Send it as "Authorization: Bearer <key>".',
      instance: '/inquiries',
    });
    expect(lookupApiKey).not.toHaveBeenCalled();
  });

  it.each([
    ['another scheme', `Basic ${Buffer.from('user:pass').toString('base64')}`],
    ['an empty bearer token', 'Bearer '],
    ['a token with spaces', `Bearer ${TOKEN} extra`],
    ['an oversized token', `Bearer ${'a'.repeat(513)}`],
  ])('rejects %s without calling the key lookup', async (_label, authorization) => {
    const response = await app.inject({ url: '/inquiries', headers: { authorization } });

    expect(response.statusCode).toBe(401);
    expect(lookupApiKey).not.toHaveBeenCalled();
  });

  it('rejects an unknown key with invalid_token', async () => {
    const response = await app.inject({ url: '/inquiries', headers: bearer('ov_sbx_unknown') });

    expect(response.statusCode).toBe(401);
    expect(response.json<Problem>().detail).toBe('The API key is not valid.');
    expect(response.headers['www-authenticate']).toContain('error="invalid_token"');
    expect(lookupApiKey).toHaveBeenCalledExactlyOnceWith('ov_sbx_unknown');
  });

  it('rejects an expired key', async () => {
    record = { ...activeKey, expiresAt: new Date(NOW.getTime() - 1_000) };

    const response = await app.inject({ url: '/inquiries', headers: bearer(TOKEN) });

    expect(response.statusCode).toBe(401);
    expect(response.json<Problem>().detail).toBe('The API key has expired.');
    expect(response.headers['www-authenticate']).toContain('error="invalid_token"');
  });

  it('treats a key as expired from the exact expiry instant', async () => {
    record = { ...activeKey, expiresAt: NOW };

    const response = await app.inject({ url: '/inquiries', headers: bearer(TOKEN) });

    expect(response.statusCode).toBe(401);
  });

  it('accepts a key that expires in the future', async () => {
    record = { ...activeKey, expiresAt: new Date(NOW.getTime() + 1_000) };

    const response = await app.inject({ url: '/inquiries', headers: bearer(TOKEN) });

    expect(response.statusCode).toBe(200);
    expect(lookupApiKey).toHaveBeenCalledExactlyOnceWith(TOKEN);
  });

  it('rejects a revoked key', async () => {
    record = { ...activeKey, revokedAt: new Date(NOW.getTime() - 60_000) };

    const response = await app.inject({ url: '/inquiries', headers: bearer(TOKEN) });

    expect(response.statusCode).toBe(401);
    expect(response.json<Problem>().detail).toBe('The API key has been revoked.');
  });

  it('rejects a key without the scope the route requires with a 403 problem', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/inquiries',
      headers: bearer(TOKEN),
    });

    expect(response.statusCode).toBe(403);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect(response.headers['www-authenticate']).toBe(
      'Bearer realm="openverify", error="insufficient_scope", scope="inquiries:write"',
    );
    expect(response.json<Problem>()).toMatchObject({
      title: 'Forbidden',
      status: 403,
      detail: 'The API key is missing the required scope: inquiries:write.',
    });
  });

  it('accepts a valid key with the required scope and exposes it on the request', async () => {
    const response = await app.inject({ url: '/inquiries', headers: bearer(TOKEN) });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      apiKey: { id: 'key_1', environmentId: 'env_1', scopes: ['inquiries:read'] },
    });
    expect(lookupApiKey).toHaveBeenCalledExactlyOnceWith(TOKEN);
  });

  it('accepts the bearer scheme in any letter case', async () => {
    const response = await app.inject({
      url: '/inquiries',
      headers: { authorization: `bEaReR ${TOKEN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(lookupApiKey).toHaveBeenCalledExactlyOnceWith(TOKEN);
  });

  it('requires a valid key on routes that declare no scopes (secure by default)', async () => {
    const anonymous = await app.inject({ url: '/whoami' });
    const authenticated = await app.inject({ url: '/whoami', headers: bearer(TOKEN) });

    expect(anonymous.statusCode).toBe(401);
    expect(authenticated.statusCode).toBe(200);
    expect(authenticated.json()).toEqual({ apiKeyId: 'key_1' });
  });

  it('skips authentication on routes marked public', async () => {
    const response = await app.inject({ url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(lookupApiKey).not.toHaveBeenCalled();
  });

  it('answers unknown routes with 404 rather than 401', async () => {
    const response = await app.inject({ url: '/no-such-route' });

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect(response.json<Problem>().title).toBe('Not Found');
    expect(lookupApiKey).not.toHaveBeenCalled();
  });

  it('turns a failing key lookup into a 500 problem without leaking the cause', async () => {
    lookupApiKey.mockRejectedValueOnce(new Error('pg: password authentication failed'));

    const response = await app.inject({ url: '/inquiries', headers: bearer(TOKEN) });

    expect(response.statusCode).toBe(500);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect(response.body).not.toContain('password');
  });

  it('sends the request id on auth failures', async () => {
    const response = await app.inject({
      url: '/inquiries',
      headers: { 'x-request-id': 'trace-auth' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers['x-request-id']).toBe('trace-auth');
  });

  it('leaves routes that take another credential to their own auth hook', async () => {
    app.get('/flow-only', { config: { auth: 'session-token' } }, () => ({ ok: true }));

    const response = await app.inject({ url: '/flow-only' });

    expect(response.statusCode).toBe(200);
    expect(lookupApiKey).not.toHaveBeenCalled();
  });

  it('still requires an API key on routes that name api-key auth explicitly', async () => {
    app.get('/explicit', { config: { auth: 'api-key' } }, () => ({ ok: true }));

    expect((await app.inject({ url: '/explicit' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/explicit', headers: bearer(TOKEN) })).statusCode).toBe(200);
  });

  describe('IP allowlist', () => {
    const fromAddress = (remoteAddress: string) =>
      app.inject({ url: '/inquiries', headers: bearer(TOKEN), remoteAddress });

    it.each([
      [['10.0.0.0/8'], '10.20.30.40'],
      [['192.0.2.7/32'], '192.0.2.7'],
      [['10.0.0.0/8', '2001:db8::/32'], '2001:db8::1'],
      [['10.0.0.0/8'], '::ffff:10.1.2.3'],
    ])('accepts a key restricted to %j from %s', async (allowedIps, address) => {
      record = { ...activeKey, allowedIps };

      expect((await fromAddress(address)).statusCode).toBe(200);
    });

    it.each([
      [['10.0.0.0/8'], '192.0.2.1'],
      [['2001:db8::/32'], '2001:db9::1'],
      [['10.0.0.0/8'], '::ffff:192.0.2.1'],
    ])('refuses a key restricted to %j from %s with a 403 problem', async (allowedIps, address) => {
      record = { ...activeKey, allowedIps };

      const response = await fromAddress(address);

      expect(response.statusCode).toBe(403);
      expect(response.json<Problem>().detail).toBe(
        'The API key may not be used from this IP address.',
      );
      expect(response.body).not.toContain(address);
    });

    it.each([[null], [[]]])(
      'places no restriction when the allowlist is %j',
      async (allowedIps) => {
        record = { ...activeKey, allowedIps };

        expect((await fromAddress('198.51.100.9')).statusCode).toBe(200);
      },
    );

    it('fails closed on an allowlist entry it cannot parse', async () => {
      record = { ...activeKey, allowedIps: ['not-a-cidr'] };

      expect((await fromAddress('10.0.0.1')).statusCode).toBe(403);
    });
  });

  describe('onAuthenticated', () => {
    it('is told about each successfully authenticated key', async () => {
      const onAuthenticated = vi.fn(() => Promise.resolve());
      const withCallback = buildApp({
        lookupApiKey,
        logger: false,
        now: () => NOW,
        onAuthenticated,
      });
      withCallback.get('/inquiries', { config: { scopes: ['inquiries:read'] } }, () => ({ ok: 1 }));

      await withCallback.inject({ url: '/inquiries', headers: bearer(TOKEN) });
      await withCallback.inject({ url: '/inquiries', headers: bearer('ov_sbx_unknown') });
      await withCallback.close();

      expect(onAuthenticated).toHaveBeenCalledExactlyOnceWith({
        id: 'key_1',
        environmentId: 'env_1',
        scopes: ['inquiries:read'],
      });
    });

    it('is not called for a key that fails its scope check', async () => {
      const onAuthenticated = vi.fn(() => Promise.resolve());
      const withCallback = buildApp({
        lookupApiKey,
        logger: false,
        now: () => NOW,
        onAuthenticated,
      });
      withCallback.post('/inquiries', { config: { scopes: ['inquiries:write'] } }, () => ({}));

      const response = await withCallback.inject({
        method: 'POST',
        url: '/inquiries',
        headers: bearer(TOKEN),
      });
      await withCallback.close();

      expect(response.statusCode).toBe(403);
      expect(onAuthenticated).not.toHaveBeenCalled();
    });

    it('never fails the request when the callback fails', async () => {
      const onAuthenticated = vi.fn(() => Promise.reject(new Error('db down')));
      const withCallback = buildApp({
        lookupApiKey,
        logger: false,
        now: () => NOW,
        onAuthenticated,
      });
      withCallback.get('/inquiries', { config: { scopes: ['inquiries:read'] } }, () => ({ ok: 1 }));

      const response = await withCallback.inject({ url: '/inquiries', headers: bearer(TOKEN) });
      await withCallback.close();

      expect(response.statusCode).toBe(200);
      expect(onAuthenticated).toHaveBeenCalledOnce();
    });
  });

  it('uses the real clock when none is injected', async () => {
    const realClock = buildApp({ lookupApiKey, logger: false });
    realClock.get('/inquiries', { config: { scopes: ['inquiries:read'] } }, () => ({ ok: true }));
    record = { ...activeKey, expiresAt: new Date(Date.now() - 1_000) };

    const response = await realClock.inject({ url: '/inquiries', headers: bearer(TOKEN) });
    await realClock.close();

    expect(response.statusCode).toBe(401);
  });
});

describe('principals (C12)', () => {
  // Synthetic user session tokens; real ones come from newUserSessionToken().
  const USER_TOKEN = `ovu_${'U'.repeat(43)}`;
  const OTHER_USER_TOKEN = `ovu_${'V'.repeat(43)}`;

  const user = (overrides: Partial<UserPrincipal> = {}): UserPrincipal => ({
    kind: 'user',
    userId: 'usr_1',
    userSessionId: 'uss_1',
    organizationId: 'org_1',
    environmentId: 'env_1',
    environmentKind: 'production',
    permissions: new Set(['inquiries:read']),
    mfaSatisfied: true,
    ...overrides,
  });

  let seen: Principal | null;
  let resolveUserSession: Mock<PrincipalResolver>;
  let withUsers: ReturnType<typeof buildApp>;
  let onAuthenticated: Mock<() => Promise<void>>;

  beforeEach(() => {
    seen = null;
    resolveUserSession = vi.fn<PrincipalResolver>((token) =>
      Promise.resolve(token === USER_TOKEN ? user() : null),
    );
    onAuthenticated = vi.fn(() => Promise.resolve());
    withUsers = buildApp({
      lookupApiKey,
      resolveUserSession,
      onAuthenticated,
      logger: false,
      mode: 'production',
      now: () => NOW,
    });
    withUsers.get('/inquiries', { config: { scopes: ['inquiries:read'] } }, (request) => {
      seen = request.principal;
      return { ok: true };
    });
    withUsers.post('/inquiries', { config: { scopes: ['inquiries:write'] } }, () => ({}));
    withUsers.get('/open', (request) => {
      seen = request.principal;
      return { ok: true };
    });
    withUsers.get('/dashboard-only', { config: { auth: 'user-session' } }, (request) => {
      seen = request.principal;
      return { ok: true };
    });
  });

  afterEach(async () => {
    await withUsers.close();
  });

  describe('API keys', () => {
    it('become an api-key principal with the organization and environment kind of the key', async () => {
      record = {
        ...activeKey,
        environmentKind: 'production',
        scopes: ['inquiries:read', 'webhooks:read'],
      };

      const response = await withUsers.inject({ url: '/inquiries', headers: bearer(TOKEN) });

      expect(response.statusCode).toBe(200);
      expect(seen).toEqual({
        kind: 'api-key',
        apiKeyId: 'key_1',
        organizationId: 'org_1',
        environmentId: 'env_1',
        environmentKind: 'production',
        permissions: new Set(['inquiries:read', 'webhooks:read']),
      });
    });

    it('grants no permission for a stored scope that is not a known permission', async () => {
      record = { ...activeKey, scopes: ['inquiries:read', 'legacy.scope'] };

      await withUsers.inject({ url: '/inquiries', headers: bearer(TOKEN) });

      expect(seen?.permissions).toEqual(new Set(['inquiries:read']));
    });

    it('answer a missing scope with the forbidden problem type', async () => {
      const response = await withUsers.inject({
        method: 'POST',
        url: '/inquiries',
        headers: bearer(TOKEN),
      });

      expect(response.statusCode).toBe(403);
      expect(response.json<Problem>().type).toBe('https://openverify.dev/problems/forbidden');
    });

    it('keep about:blank for an address outside the allowlist, which is not a permission', async () => {
      record = { ...activeKey, allowedIps: ['10.0.0.0/8'] };

      const response = await withUsers.inject({
        url: '/inquiries',
        headers: bearer(TOKEN),
        remoteAddress: '192.0.2.1',
      });

      expect(response.statusCode).toBe(403);
      expect(response.json<Problem>().type).toBe('about:blank');
    });

    it('are looked up for production keys too', async () => {
      const production = 'ov_prod_SyntheticProductionTokenAAAAAAAAAAAAAAAAAAAAA';

      const response = await withUsers.inject({ url: '/inquiries', headers: bearer(production) });

      expect(response.statusCode).toBe(401);
      expect(lookupApiKey).toHaveBeenCalledExactlyOnceWith(production);
      expect(resolveUserSession).not.toHaveBeenCalled();
    });

    it('never look up a token without an API key prefix', async () => {
      const response = await withUsers.inject({
        url: '/inquiries',
        headers: bearer('not-an-openverify-token'),
      });

      expect(response.statusCode).toBe(401);
      expect(response.json<Problem>().detail).toBe('The API key is not valid.');
      expect(response.headers['www-authenticate']).toContain('error="invalid_token"');
      expect(lookupApiKey).not.toHaveBeenCalled();
      expect(resolveUserSession).not.toHaveBeenCalled();
    });
  });

  describe('user sessions', () => {
    it('are resolved by the user-session resolver, never by the API key lookup', async () => {
      const response = await withUsers.inject({ url: '/inquiries', headers: bearer(USER_TOKEN) });

      expect(response.statusCode).toBe(200);
      expect(seen).toEqual(user());
      expect(resolveUserSession).toHaveBeenCalledOnce();
      expect(resolveUserSession.mock.calls[0]?.[0]).toBe(USER_TOKEN);
      expect(resolveUserSession.mock.calls[0]?.[1]).toMatchObject({ url: '/inquiries' });
      expect(lookupApiKey).not.toHaveBeenCalled();
    });

    it('answer an unknown, expired or revoked session with a generic 401', async () => {
      const response = await withUsers.inject({
        url: '/inquiries',
        headers: bearer(OTHER_USER_TOKEN),
      });

      expect(response.statusCode).toBe(401);
      expect(response.headers['content-type']).toBe(PROBLEM_JSON);
      expect(response.json<Problem>()).toMatchObject({
        type: 'about:blank',
        detail: 'The user session is not valid or has expired.',
      });
      expect(response.headers['www-authenticate']).toContain('error="invalid_token"');
    });

    it('are refused when no user-session resolver is configured', async () => {
      const keysOnly = buildApp({ lookupApiKey, logger: false, mode: 'production' });
      keysOnly.get('/inquiries', { config: { scopes: ['inquiries:read'] } }, () => ({ ok: 1 }));

      const response = await keysOnly.inject({ url: '/inquiries', headers: bearer(USER_TOKEN) });
      await keysOnly.close();

      expect(response.statusCode).toBe(401);
      expect(response.json<Problem>().detail).toBe('The user session is not valid or has expired.');
      expect(lookupApiKey).not.toHaveBeenCalled();
    });

    it('answer a missing permission with 403 forbidden naming it', async () => {
      const response = await withUsers.inject({
        method: 'POST',
        url: '/inquiries',
        headers: bearer(USER_TOKEN),
      });

      expect(response.statusCode).toBe(403);
      expect(response.headers['content-type']).toBe(PROBLEM_JSON);
      expect(response.headers['www-authenticate']).toBe(
        'Bearer realm="openverify", error="insufficient_scope", scope="inquiries:write"',
      );
      expect(response.json<Problem>()).toMatchObject({
        type: 'https://openverify.dev/problems/forbidden',
        title: 'Forbidden',
        status: 403,
        detail: 'The user is missing the required permission: inquiries:write.',
      });
    });

    it('answer 401 mfa-required while the session has not satisfied required MFA', async () => {
      resolveUserSession.mockResolvedValue(user({ mfaSatisfied: false }));

      for (const url of ['/inquiries', '/open']) {
        const response = await withUsers.inject({ url, headers: bearer(USER_TOKEN) });

        expect(response.statusCode).toBe(401);
        expect(response.json<Problem>()).toMatchObject({
          type: 'https://openverify.dev/problems/mfa-required',
          title: 'MFA Required',
          status: 401,
        });
        expect(response.headers['www-authenticate']).toContain(
          'error="insufficient_user_authentication"',
        );
      }
      expect(seen).toBeNull();
    });

    it('ask for MFA before reporting a missing permission', async () => {
      resolveUserSession.mockResolvedValue(user({ mfaSatisfied: false }));

      const response = await withUsers.inject({
        method: 'POST',
        url: '/inquiries',
        headers: bearer(USER_TOKEN),
      });

      expect(response.statusCode).toBe(401);
    });

    it('do not record API key use', async () => {
      await withUsers.inject({ url: '/inquiries', headers: bearer(USER_TOKEN) });

      expect(onAuthenticated).not.toHaveBeenCalled();
    });

    it('turn a failing resolver into a 500 problem without leaking the cause', async () => {
      resolveUserSession.mockRejectedValueOnce(new Error('pg: relation user_sessions is gone'));

      const response = await withUsers.inject({ url: '/inquiries', headers: bearer(USER_TOKEN) });

      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain('user_sessions');
    });

    it('let a resolver refuse with its own problem', async () => {
      resolveUserSession.mockRejectedValueOnce(
        new UnauthorizedError('The user is deactivated.', { error: 'invalid_token' }),
      );

      const response = await withUsers.inject({ url: '/inquiries', headers: bearer(USER_TOKEN) });

      expect(response.statusCode).toBe(401);
      expect(response.json<Problem>().detail).toBe('The user is deactivated.');
    });
  });

  it('leaves dashboard routes, which take user sessions, to their own auth hook', async () => {
    const response = await withUsers.inject({
      url: '/dashboard-only',
      headers: bearer(USER_TOKEN),
    });

    expect(response.statusCode).toBe(200);
    expect(seen).toBeNull();
    expect(resolveUserSession).not.toHaveBeenCalled();
  });
});

describe('requirePrincipal', () => {
  it('returns the principal of an authenticated request', () => {
    const principal: Principal = {
      kind: 'api-key',
      apiKeyId: 'key_1',
      organizationId: 'org_1',
      environmentId: 'env_1',
      environmentKind: 'sandbox',
      permissions: new Set(),
    };

    expect(requirePrincipal({ principal } as FastifyRequest)).toBe(principal);
  });

  it('refuses a request that has none', () => {
    expect(() => requirePrincipal({ principal: null } as FastifyRequest)).toThrow(
      UnauthorizedError,
    );
  });
});

describe('authorizePrincipal', () => {
  const principal: Principal = {
    kind: 'user',
    userId: 'usr_1',
    userSessionId: 'uss_1',
    organizationId: 'org_1',
    environmentId: 'env_1',
    environmentKind: 'sandbox',
    permissions: new Set(['inquiries:read', 'pii:view']),
    mfaSatisfied: true,
  };

  it('passes when every permission is held', () => {
    expect(() => {
      authorizePrincipal(principal, ['inquiries:read', 'pii:view']);
    }).not.toThrow();
    expect(() => {
      authorizePrincipal(principal, []);
    }).not.toThrow();
  });

  it('names every missing permission, in request order', () => {
    expect(() => {
      authorizePrincipal(principal, ['users:write', 'inquiries:read', 'roles:write']);
    }).toThrow('The user is missing the required permissions: users:write, roles:write.');
  });
});

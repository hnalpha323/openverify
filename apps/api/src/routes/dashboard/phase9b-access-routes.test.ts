/**
 * Workflow 9B Stage 1b, checkpoint (U): the dashboard routes of C167.3 and C168 that `foundation-9b`
 * freezes for `api-access`, each answering 501 until built, behind the operator's session and its
 * permission, and listed in the OpenAPI document with the contract's schemas:
 *
 * - `PUT /users/:id/roles` and `GET /roles/grantable` (C167.3);
 * - `POST /invitations/:id/resend`, counted by the `invitations-resend` policy per invitation before
 *   anything else, `POST /users/:id/reactivate` and `POST /users/:id/reset-mfa` (C168.1, C168.3);
 * - `GET /sessions`, `POST /sessions/:id/revoke`, `POST /sessions/revoke-others`, and the step-up
 *   with its passkey options (C168.4; contracts B26);
 * - the audit list refusing its four new filters with 501 until they are built, never answering an
 *   unfiltered list as if filtered (C168.6; fail closed, as contracts B16 asks of the list filters).
 *
 * Every value is synthetic.
 */
import { RATE_LIMIT_DEFAULTS, RATE_LIMIT_POLICY_WINDOWS } from '@openverify/contracts';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { RateLimiter } from '../../ports.js';
import {
  createDashboardHarness,
  type DashboardHarness,
  type DashboardHarnessOptions,
  type HttpMethod,
} from './dashboard.test-support.js';

let database: TestDatabase;
const harnesses: DashboardHarness[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

afterAll(async () => {
  await database.close();
});

async function setup(options: DashboardHarnessOptions = {}) {
  const api = await createDashboardHarness(database, options);
  harnesses.push(api);
  const organization = await api.organization();
  const admin = await api.operator(organization, { roles: ['admin'] });
  const viewer = await api.operator(organization, { roles: ['viewer'] });
  return {
    api,
    organization,
    admin,
    viewer,
    token: await api.signIn(admin.email),
    viewerToken: await api.signIn(viewer.email),
  };
}

const SESSION = 'uss_01M5CN00000000000000009B51';
const ROLES_BODY = (roleId: string) => ({
  assignments: [{ 'role-id': roleId, 'environment-ids': null }],
});

/** Every frozen route, with a body the contract accepts. */
function frozen(
  userId: string,
  roleId: string,
): { method: HttpMethod; path: string; payload?: unknown; scope: string | null }[] {
  return [
    {
      method: 'PUT',
      path: `/users/${userId}/roles`,
      payload: ROLES_BODY(roleId),
      scope: 'users:write',
    },
    { method: 'GET', path: '/roles/grantable', scope: 'roles:read' },
    { method: 'POST', path: `/invitations/${userId}/resend`, payload: {}, scope: 'users:write' },
    { method: 'POST', path: `/users/${userId}/reactivate`, payload: {}, scope: 'users:write' },
    { method: 'POST', path: `/users/${userId}/reset-mfa`, payload: {}, scope: 'users:write' },
    { method: 'GET', path: '/sessions', scope: null },
    { method: 'POST', path: `/sessions/${SESSION}/revoke`, payload: {}, scope: null },
    { method: 'POST', path: '/sessions/revoke-others', payload: {}, scope: null },
    {
      method: 'POST',
      path: '/sessions/current/step-up',
      payload: { 'totp-code': '123456' },
      scope: null,
    },
    {
      method: 'POST',
      path: '/sessions/current/step-up/webauthn/options',
      payload: {},
      scope: null,
    },
  ];
}

/** Refuses only the keys of `policy`; every other count passes, as Valkey would. */
function limiter(policy: string, allowed: boolean, keys: string[] = []): RateLimiter {
  return {
    consume: (key, rule) => {
      keys.push(key);
      const refused = !allowed && key.startsWith(`${policy}:`);
      return Promise.resolve({
        allowed: !refused,
        limit: rule.limit,
        remaining: refused ? 0 : rule.limit,
        resetAt: new Date(0),
        retryAfterSeconds: refused ? 30 : 0,
      });
    },
  };
}

describe('the access routes, built by api-access (C167.3, C168; behaviour in role-assignments, step-up, acting-on-users and my-sessions tests)', () => {
  it('refuse a viewer the user routes (users:write), and everyone without a session', async () => {
    const { api, organization, admin, viewerToken } = await setup();

    for (const route of frozen(admin.user.id, organization.roleIds.viewer)) {
      const payload = route.payload === undefined ? {} : { payload: route.payload };
      const anonymous = await api.call(route.method, route.path, payload);
      expect(anonymous.statusCode, `${route.method} ${route.path}`).toBe(401);
      if (route.scope === 'users:write') {
        const viewer = await api.call(route.method, route.path, { token: viewerToken, ...payload });
        expect(viewer.statusCode, `${route.method} ${route.path}`).toBe(403);
      }
    }
  });

  it('read the contract: an assignment names each role once, an id has its prefix', async () => {
    const { api, organization, admin, token } = await setup();
    const roleId = organization.roleIds.viewer;

    const twice = await api.call('PUT', `/users/${admin.user.id}/roles`, {
      token,
      payload: {
        assignments: [...ROLES_BODY(roleId).assignments, ...ROLES_BODY(roleId).assignments],
      },
    });
    const prefix = await api.call('POST', `/users/${roleId}/reactivate`, { token, payload: {} });
    const recovery = await api.call('POST', '/sessions/current/step-up', {
      token,
      payload: { 'recovery-code': 'abcd-efgh-ijkl' },
    });

    expect([twice.statusCode, prefix.statusCode, recovery.statusCode]).toEqual([400, 400, 400]);
  });

  it('are listed in the OpenAPI document with their answers', async () => {
    const { api } = await setup();
    const { paths } = (await api.app.inject({ url: '/openapi.json' })).json<{
      paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
    }>();
    const operations: [string, string, string][] = [
      ['/api/v1/dashboard/users/{id}/roles', 'put', '200'],
      ['/api/v1/dashboard/roles/grantable', 'get', '200'],
      ['/api/v1/dashboard/invitations/{id}/resend', 'post', '201'],
      ['/api/v1/dashboard/users/{id}/reactivate', 'post', '200'],
      ['/api/v1/dashboard/users/{id}/reset-mfa', 'post', '200'],
      ['/api/v1/dashboard/sessions', 'get', '200'],
      ['/api/v1/dashboard/sessions/{id}/revoke', 'post', '204'],
      ['/api/v1/dashboard/sessions/revoke-others', 'post', '200'],
      ['/api/v1/dashboard/sessions/current/step-up', 'post', '200'],
      ['/api/v1/dashboard/sessions/current/step-up/webauthn/options', 'post', '200'],
    ];

    for (const [path, method, success] of operations) {
      const operation = paths[path]?.[method];
      expect(operation, `${method} ${path}`).toBeDefined();
      expect(Object.keys(operation?.responses ?? {}), `${method} ${path}`).toEqual(
        expect.arrayContaining([success, '401']),
      );
    }
  });
});

describe('the invitations-resend policy (C174.4; review P35)', () => {
  it('is 5 an hour per invitation, refusing a resend with 429 before anything else', async () => {
    const policy = 'invitations-resend';
    expect((RATE_LIMIT_DEFAULTS as Readonly<Record<string, number>>)[policy]).toBe(5);
    expect((RATE_LIMIT_POLICY_WINDOWS as Readonly<Record<string, number>>)[policy]).toBe(3600);
    const { api, viewer, token } = await setup({ routeRateLimiter: limiter(policy, false) });

    const response = await api.call('POST', `/invitations/${viewer.user.id}/resend`, {
      token,
      payload: {},
    });

    expect(response.statusCode, response.body).toBe(429);
    expect(response.headers['retry-after']).toBe('30');
  });

  it('counts the invitation (the invited user), not the caller', async () => {
    const keys: string[] = [];
    const { api, viewer, token } = await setup({
      routeRateLimiter: limiter('invitations-resend', true, keys),
    });

    await api.call('POST', `/invitations/${viewer.user.id}/resend`, { token, payload: {} });

    expect(keys.filter((key) => key.startsWith('invitations-resend:'))).toEqual([
      `invitations-resend:${viewer.user.id}`,
    ]);
  });
});

describe('the audit explorer, built by api-access (C168.6; audit-explorer.test.ts)', () => {
  it('still lists without them', async () => {
    const { api, token } = await setup();

    const response = await api.call('GET', '/audit-logs?filter[action]=user-session.created', {
      token,
    });

    expect(response.statusCode, response.body).toBe(200);
  });
});

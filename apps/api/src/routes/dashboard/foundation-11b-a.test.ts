/**
 * Workflow 11B Stage 1b (A) (foundation-11b): the routes frozen at 501 with `contracts-11b`'s schemas
 * (the SSO start, callback, step-up and providers, sso-oidc's; ending a user's sessions,
 * auth-sessions'), and the hooks of C245: the session policy where every session resolves (the
 * dashboard's and the server API's, with the route's `activity` flag) and `endUserSessions` at both
 * role writes. The hooks call auth-sessions' stubs, spied on here.
 */
import { readFileSync } from 'node:fs';
import { newId } from '@openverify/contracts';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { findUserSessionContext } from '../../operator-auth/session-context.js';
import * as sessionPolicy from '../../operator-auth/session-policy.js';
import { createUserSessionPrincipalResolver } from '../../operator-auth/principal-resolver.js';
import { createDashboardHarness, type DashboardHarness } from './dashboard.test-support.js';

vi.mock('../../operator-auth/session-policy.js', { spy: true });

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../../contracts/fixtures/api/sso/${name}`, import.meta.url),
      'utf8',
    ),
  ) as unknown;

let database: TestDatabase;
let harness: DashboardHarness;

beforeAll(async () => {
  database = await createTestDatabase();
  harness = await createDashboardHarness(database);
});

afterAll(async () => {
  await harness.close();
  await database.close();
});

afterEach(() => {
  vi.mocked(sessionPolicy.enforceSessionPolicy).mockClear();
  vi.mocked(sessionPolicy.endUserSessions).mockClear();
});

async function admin() {
  const organization = await harness.organization();
  const { user, email } = await harness.operator(organization, { roles: ['admin'] });
  return { organization, user, token: await harness.signIn(email) };
}

describe('the SSO routes, frozen for sso-oidc and built by it (C248.3, C248.4, C248.6)', () => {
  // sso-oidc (a named borrowed edit, rule 12): the routes are built, so they no longer answer 501;
  // their behaviour is held by routes/dashboard/sso.test.ts.
  it('answers the public start and callback without a session, generically', async () => {
    const start = await harness.call('GET', '/sso/example-bank/start');
    expect(start.statusCode).toBe(404);
    const callback = await harness.call(
      'GET',
      `/sso/callback/${newId('ssop')}?state=synthetic-state&code=synthetic-code`,
    );
    expect(callback.statusCode).toBe(400);
  });

  it('validates the start path and the callback provider first', async () => {
    expect((await harness.call('GET', '/sso/Example_Bank/start')).statusCode).toBe(400);
    expect((await harness.call('GET', '/sso/callback/usr_nope?state=x')).statusCode).toBe(400);
  });

  it('answers the SSO step-up and every provider route for an admin, never 501', async () => {
    const { token } = await admin();
    const id = newId('ssop');
    const calls = [
      harness.call('POST', '/sessions/current/step-up/sso', { token, payload: {} }),
      harness.call('GET', '/sso-providers', { token }),
      harness.call('POST', '/sso-providers', { token, payload: fixture('provider-create.json') }),
      harness.call('GET', `/sso-providers/${id}`, { token }),
      harness.call('PATCH', `/sso-providers/${id}`, {
        token,
        payload: fixture('provider-update.json'),
      }),
      harness.call('DELETE', `/sso-providers/${id}`, { token }),
    ];
    // No SSO link (404), the list (200), changes without the step-up (403), an unknown id (404).
    expect((await Promise.all(calls)).map((response) => response.statusCode)).toEqual([
      404, 200, 403, 404, 403, 403,
    ]);
  });

  it('keeps the provider routes behind a session', async () => {
    expect((await harness.call('GET', '/sso-providers')).statusCode).toBe(401);
  });
});

// Built by auth-sessions (C245.3; its behaviour is held by end-sessions.test.ts): no longer a 501.
describe('ending a user’s sessions, built by auth-sessions (C245.3)', () => {
  it('answers 200 for an admin, and 401 without a session', async () => {
    const { organization, token } = await admin();
    const other = await harness.operator(organization, { roles: ['viewer'] });
    const ended = await harness.call('POST', `/users/${other.user.id}/end-sessions`, {
      token,
      payload: {},
    });
    expect(ended.statusCode, ended.body).toBe(200);
    expect(
      (await harness.call('POST', `/users/${other.user.id}/end-sessions`, { payload: {} }))
        .statusCode,
    ).toBe(401);
  });
});

describe('the session policy hook (C245.1, C245.2)', () => {
  it('is called for every dashboard request with the session, the clock and the limits', async () => {
    const { token } = await admin();
    vi.mocked(sessionPolicy.enforceSessionPolicy).mockClear();
    expect((await harness.call('GET', '/sessions', { token })).statusCode).toBe(200);
    expect(sessionPolicy.enforceSessionPolicy).toHaveBeenCalledTimes(1);
    const [, input] = vi.mocked(sessionPolicy.enforceSessionPolicy).mock.calls[0] ?? [];
    expect(input).toMatchObject({
      activity: true,
      now: harness.clock.now(),
      timeouts: { idleTimeoutSeconds: 1800, absoluteTimeoutSeconds: 43_200 },
    });
    expect(input?.session.id).toMatch(/^uss_/);
  });

  it('passes activity false from the operator auth and from a route on the server API', async () => {
    const { token } = await admin();
    vi.mocked(sessionPolicy.enforceSessionPolicy).mockClear();
    await harness.operatorAuth.authenticate(token, { activity: false });
    const resolver = createUserSessionPrincipalResolver({
      db: database.db,
      clock: harness.clock,
      sessionTimeouts: { idleTimeoutSeconds: 300, absoluteTimeoutSeconds: 3600 },
    });
    const request = { routeOptions: { config: { activity: false } } } as never;
    expect(await resolver(token, request)).not.toBeNull();
    expect(
      vi
        .mocked(sessionPolicy.enforceSessionPolicy)
        .mock.calls.map(([, input]) => [input.activity, input.timeouts.idleTimeoutSeconds]),
    ).toEqual([
      [false, 1800],
      [false, 300],
    ]);
  });

  it('runs before the permissions are read, and refuses the session when the policy throws', async () => {
    const { token } = await admin();
    vi.mocked(sessionPolicy.enforceSessionPolicy).mockRejectedValueOnce(new Error('expired'));
    await expect(findUserSessionContext(database.db, token, harness.clock.now())).rejects.toThrow(
      'expired',
    );
  });
});

describe('the role writes call endUserSessions (C245.3; Stage 1a amendment 4)', () => {
  it('on PUT /users/:id/roles and on PATCH /users/:id with role ids', async () => {
    const { organization, token } = await admin();
    const other = await harness.operator(organization, { roles: ['viewer'] });
    vi.mocked(sessionPolicy.endUserSessions).mockClear();
    const put = await harness.call('PUT', `/users/${other.user.id}/roles`, {
      token,
      payload: {
        assignments: [{ 'role-id': organization.roleIds.developer, 'environment-ids': null }],
      },
    });
    expect(put.statusCode, put.body).toBe(200);
    const patch = await harness.call('PATCH', `/users/${other.user.id}`, {
      token,
      payload: { data: { attributes: { 'role-ids': [organization.roleIds.viewer] } } },
    });
    expect(patch.statusCode, patch.body).toBe(200);
    expect(
      vi
        .mocked(sessionPolicy.endUserSessions)
        .mock.calls.map(([, input]) => [input.userId, input.organizationId, input.cause]),
    ).toEqual([
      [other.user.id, organization.id, 'role-change'],
      [other.user.id, organization.id, 'role-change'],
    ]);
  });
});

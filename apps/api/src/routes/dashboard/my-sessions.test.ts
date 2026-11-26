/**
 * C168.4, C168.5 (Phase 9, Workflow 9B; review P20, contracts B27): an operator's own sessions, and
 * the users list's MFA status and last sign-in.
 *
 * - `GET /sessions`: the caller's live sessions, newest first, each with a device summary from the
 *   user agent of its sign-in (never the agent itself), when it was created and last seen (to the
 *   minute), when it expires and when a factor was last checked on it; the current one marked.
 * - `POST /sessions/:id/revoke` revokes one of the caller's own sessions (404 for any other), and
 *   `POST /sessions/revoke-others` every one but the current.
 * - `GET /users` gives `mfa-factors` (kinds and counts) and `last-sign-in-at` only to holders of
 *   `users:write`; a holder of `users:read` alone sees neither, nor `mfa-enabled`, so it cannot
 *   list the accounts without MFA.
 *
 * Every value is synthetic.
 */
import {
  newId,
  revokeOtherSessionsResponseSchema,
  userListDocumentSchema,
  userSessionListDocumentSchema,
} from '@openverify/contracts';
import { createRole, setUserRoles } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { totpCode } from '../../operator-auth/totp.js';
import {
  PASSWORD,
  createDashboardHarness,
  expectJson,
  type DashboardHarness,
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

const FIREFOX_ON_LINUX =
  'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0 synthetic';
const CHROME_ON_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 synthetic';

async function harness() {
  const api = await createDashboardHarness(database);
  harnesses.push(api);
  const organization = await api.organization();
  return { api, organization };
}

async function signInAs(api: DashboardHarness, email: string, userAgent?: string) {
  const response = await api.call('POST', '/sessions', {
    payload: { email, password: PASSWORD },
    ...(userAgent === undefined ? {} : { headers: { 'user-agent': userAgent } }),
  });
  return expectJson<{ token: string }>(response, 201).token;
}

const sessions = async (api: DashboardHarness, token: string) =>
  userSessionListDocumentSchema.parse(
    expectJson(await api.call('GET', '/sessions', { token }), 200),
  ).data;

describe('GET /sessions (C168.4)', () => {
  it('lists the caller’s live sessions newest first, with a device summary and the current one marked', async () => {
    const { api, organization } = await harness();
    const operator = await api.operator(organization);
    const other = await api.operator(organization);
    await api.signIn(other.email);
    const first = await signInAs(api, operator.email, FIREFOX_ON_LINUX);
    const firstAt = api.clock.now();
    api.clock.advance(60_000);
    const second = await signInAs(api, operator.email, 'synthetic-client/1.0');
    api.clock.advance(60_000);
    const third = await signInAs(api, operator.email, CHROME_ON_MAC);
    expect((await api.call('DELETE', '/sessions/current', { token: third })).statusCode).toBe(204);

    const listed = await sessions(api, second);

    expect(listed.map((session) => session.attributes.device)).toEqual([null, 'Firefox on Linux']);
    expect(listed.map((session) => session.attributes.current)).toEqual([true, false]);
    expect(listed[1]?.attributes).toMatchObject({
      'created-at': firstAt.toISOString(),
      'last-seen-at': firstAt.toISOString(),
      'expires-at': new Date(firstAt.getTime() + 12 * 3600 * 1000).toISOString(),
      'mfa-verified-at': null,
    });
    expect(JSON.stringify(listed)).not.toContain('Gecko');
    expect(first).not.toBe(second);
  });

  // KP11-26 (C248.6, Workflow 11F): an SSO session serves the provider's amr it kept; a password
  // session serves null.
  it('serves the identity provider’s amr of an SSO session, and null for a password one', async () => {
    const { api, organization } = await harness();
    const operator = await api.operator(organization);
    const password = await signInAs(api, operator.email);
    api.clock.advance(60_000);
    await api.operatorAuth.openSsoSession(operator.user, true, ['pwd', 'mfa']);

    const listed = await sessions(api, password);

    expect(listed.map((session) => session.attributes['provider-amr'])).toEqual([
      ['pwd', 'mfa'],
      null,
    ]);
  });

  it('moves last-seen-at at most once a minute, from the session’s own requests', async () => {
    const { api, organization } = await harness();
    const operator = await api.operator(organization);
    const token = await api.signIn(operator.email);
    const signedInAt = api.clock.now();

    api.clock.advance(30_000);
    await api.call('GET', '/me', { token });
    const soon = await sessions(api, token);
    api.clock.advance(5 * 60_000);
    const seenAt = api.clock.now();
    await api.call('GET', '/me', { token });
    const later = await sessions(api, token);

    expect(soon[0]?.attributes['last-seen-at']).toBe(signedInAt.toISOString());
    expect(later[0]?.attributes['last-seen-at']).toBe(seenAt.toISOString());
  });
});

describe('revoking my sessions (C168.4)', () => {
  it('revokes one of my sessions (204), and answers 404 for another user’s', async () => {
    const { api, organization } = await harness();
    const operator = await api.operator(organization);
    const other = await api.operator(organization);
    const otherToken = await api.signIn(other.email);
    const kept = await api.signIn(operator.email);
    const revoked = await api.signIn(operator.email);
    const target = (await sessions(api, kept)).find((session) => !session.attributes.current);
    const [othersSession] = await sessions(api, otherToken);

    const mine = await api.call('POST', `/sessions/${target?.id ?? ''}/revoke`, {
      token: kept,
      payload: {},
    });
    const theirs = await api.call('POST', `/sessions/${othersSession?.id ?? ''}/revoke`, {
      token: kept,
      payload: {},
    });

    expect(mine.statusCode, mine.body).toBe(204);
    expect(theirs.statusCode, theirs.body).toBe(404);
    expect((await api.call('GET', '/me', { token: revoked })).statusCode).toBe(401);
    expect((await api.call('GET', '/me', { token: otherToken })).statusCode).toBe(200);
    const [entry] = await api.audit(organization.sandboxId, 'user-session.revoked');
    expect(entry).toMatchObject({ resourceId: target?.id });
  });

  it('revokes every other session and keeps the current one', async () => {
    const { api, organization } = await harness();
    const operator = await api.operator(organization);
    const first = await api.signIn(operator.email);
    const second = await api.signIn(operator.email);
    const current = await api.signIn(operator.email);

    const body = revokeOtherSessionsResponseSchema.parse(
      expectJson(
        await api.call('POST', '/sessions/revoke-others', { token: current, payload: {} }),
        200,
      ),
    );

    expect(body).toEqual({ meta: { revoked: 2 } });
    for (const token of [first, second]) {
      expect((await api.call('GET', '/me', { token })).statusCode).toBe(401);
    }
    expect((await sessions(api, current)).map((session) => session.attributes.current)).toEqual([
      true,
    ]);
    const [entry] = await api.audit(organization.sandboxId, 'user-session.others-revoked');
    expect(entry).toMatchObject({ metadata: { revoked: 2, reason: 'requested' } });
  });
});

describe('GET /users: MFA status and last sign-in (C168.5; review P20)', () => {
  it('serves the factor kinds and counts and the last sign-in to users:write only', async () => {
    const { api, organization } = await harness();
    const admin = await api.operator(organization, { roles: ['admin'] });
    const adminToken = await api.signIn(admin.email);
    const enrolled = await api.operator(organization, { roles: ['viewer'] });
    const enrolledToken = await api.signIn(enrolled.email);
    const enrolment = expectJson<{ data: { id: string }; meta: { secret: string } }>(
      await api.call('POST', '/me/mfa-factors/totp', { token: enrolledToken, payload: {} }),
      201,
    );
    expectJson(
      await api.call('POST', '/me/mfa-factors/totp/confirm', {
        token: enrolledToken,
        payload: {
          'factor-id': enrolment.data.id,
          'totp-code': totpCode(enrolment.meta.secret, api.clock.now()),
        },
      }),
      200,
    );
    const never = await api.operator(organization, { roles: ['viewer'] });
    const reader = await createRole(database.db, organization.id, {
      id: newId('role'),
      name: `Synthetic user reader ${newId('role')}`,
      permissions: ['users:read', 'inquiries:read'],
    });
    const readerUser = await api.operator(organization, { roles: [] });
    await setUserRoles(database.db, organization.id, readerUser.user.id, [reader.id]);
    const readerToken = await api.signIn(readerUser.email);

    const forWriter = userListDocumentSchema.parse(
      expectJson(await api.call('GET', '/users', { token: adminToken }), 200),
    );
    const forReader = userListDocumentSchema.parse(
      expectJson(await api.call('GET', '/users', { token: readerToken }), 200),
    );

    const byId = (list: typeof forWriter, id: string) =>
      list.data.find((user) => user.id === id)?.attributes;
    // The last sign-in is the newest sign-in entry of the audit log, stamped by the database.
    const signedInAt = (await api.audit(organization.sandboxId, 'user-session.created'))
      .filter((entry) => entry.actorId === enrolled.user.id)
      .map((entry) => entry.createdAt.getTime())
      .reduce((latest, at) => Math.max(latest, at), 0);
    expect(byId(forWriter, enrolled.user.id)).toMatchObject({
      'mfa-enabled': true,
      'mfa-factors': [{ kind: 'totp', count: 1 }],
      'last-sign-in-at': new Date(signedInAt).toISOString(),
    });
    expect(byId(forWriter, never.user.id)).toMatchObject({
      'mfa-enabled': false,
      'mfa-factors': [],
      'last-sign-in-at': null,
    });
    for (const user of forReader.data) {
      expect(Object.keys(user.attributes)).not.toEqual(expect.arrayContaining(['mfa-factors']));
      expect(user.attributes).not.toHaveProperty('last-sign-in-at');
      expect(user.attributes).not.toHaveProperty('mfa-enabled');
    }
  });
});

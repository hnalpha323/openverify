import {
  newId,
  newUserSessionToken,
  dashboardMeDocumentSchema,
  dashboardMfaChallengeResponseSchema,
  dashboardSessionResponseSchema,
  problemSchema,
} from '@openverify/contracts';
import { BUILTIN_ROLES, PERMISSIONS } from '@openverify/core';
import { createUserSession, hashSessionToken } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BFF_CLIENT_IP_HEADER, BFF_TOKEN_HEADER } from '../../operator-auth/index.js';
import { createSoftwareAuthenticator } from '../../operator-auth/testing/software-authenticator.js';
import { totpCode } from '../../operator-auth/totp.js';
import {
  BFF_TOKEN,
  PASSWORD,
  WEBAUTHN,
  createDashboardHarness,
  expectJson,
  type DashboardHarness,
  type TestOrganization,
} from './dashboard.test-support.js';

// Synthetic operators and secrets only.
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

async function harness(options?: Parameters<typeof createDashboardHarness>[1]) {
  const created = await createDashboardHarness(database, options);
  harnesses.push(created);
  return created;
}

/** An operator with an active TOTP factor, enrolled through the API. */
async function totpOperator(api: DashboardHarness, organization: TestOrganization) {
  const operator = await api.operator(organization);
  const token = await api.signIn(operator.email);
  const enrolment = expectJson<{ data: { id: string }; meta: { secret: string } }>(
    await api.call('POST', '/me/mfa-factors/totp', { token, payload: {} }),
    201,
  );
  const confirmed = expectJson<{ meta: { 'recovery-codes': string[] } }>(
    await api.call('POST', '/me/mfa-factors/totp/confirm', {
      token,
      payload: {
        'factor-id': enrolment.data.id,
        'totp-code': totpCode(enrolment.meta.secret, api.clock.now()),
      },
    }),
    200,
  );
  await api.call('DELETE', '/sessions/current', { token });
  api.clock.advance(30_000);
  return {
    ...operator,
    factorId: enrolment.data.id,
    secret: enrolment.meta.secret,
    recoveryCodes: confirmed.meta['recovery-codes'],
  };
}

function login(
  api: DashboardHarness,
  email: string,
  extra: Partial<Parameters<DashboardHarness['call']>[2]> = {},
) {
  return api.call('POST', '/sessions', { payload: { email, password: PASSWORD }, ...extra });
}

describe('POST /sessions with MFA (C15)', () => {
  it('answers 202 with an mfa-token and the active factors, uncached, and opens no session', async () => {
    const api = await harness();
    const organization = await api.organization();
    const operator = await totpOperator(api, organization);

    const response = await login(api, operator.email);

    const body = dashboardMfaChallengeResponseSchema.parse(expectJson(response, 202));
    expect(body.factors).toEqual([{ id: operator.factorId, type: 'totp' }]);
    expect(response.headers['cache-control']).toBe('no-store');
    const created = await api.audit(organization.sandboxId, 'user-session.created');
    // One session from the enrolment sign-in; the MFA login has not opened one yet.
    expect(created).toHaveLength(1);
  });

  it('still answers 201 for a user without a factor', async () => {
    const api = await harness();
    const organization = await api.organization();
    const operator = await api.operator(organization);

    expect(
      dashboardSessionResponseSchema.parse(expectJson(await login(api, operator.email), 201)).user
        .id,
    ).toBe(operator.user.id);
  });
});

describe('POST /sessions/mfa', () => {
  it('opens a session for a TOTP code and audits the login with its method', async () => {
    const api = await harness();
    const organization = await api.organization();
    const operator = await totpOperator(api, organization);
    const { 'mfa-token': mfaToken } = expectJson<{ 'mfa-token': string }>(
      await login(api, operator.email),
      202,
    );

    const response = await api.call('POST', '/sessions/mfa', {
      payload: { 'mfa-token': mfaToken, 'totp-code': totpCode(operator.secret, api.clock.now()) },
      headers: { 'user-agent': 'Synthetic Browser/2.0' },
      remoteAddress: '203.0.113.20',
    });

    const body = dashboardSessionResponseSchema.parse(expectJson(response, 201));
    expect(response.headers['cache-control']).toBe('no-store');
    const me = dashboardMeDocumentSchema.parse(
      expectJson(await api.call('GET', '/me', { token: body.token }), 200),
    );
    expect(me.meta?.['mfa-satisfied']).toBe(true);
    const [entry] = await api.audit(organization.sandboxId, 'user-session.created');
    expect(entry).toMatchObject({
      actorId: operator.user.id,
      ip: '203.0.113.20',
      userAgent: 'Synthetic Browser/2.0',
      metadata: { mfa: 'totp' },
    });
  });

  it('accepts a recovery code once', async () => {
    const api = await harness();
    const organization = await api.organization();
    const operator = await totpOperator(api, organization);
    const code = operator.recoveryCodes[0] ?? '';
    const first = expectJson<{ 'mfa-token': string }>(await login(api, operator.email), 202);

    expectJson(
      await api.call('POST', '/sessions/mfa', {
        payload: { 'mfa-token': first['mfa-token'], 'recovery-code': code },
      }),
      201,
    );
    const second = expectJson<{ 'mfa-token': string }>(await login(api, operator.email), 202);
    const reused = await api.call('POST', '/sessions/mfa', {
      payload: { 'mfa-token': second['mfa-token'], 'recovery-code': code },
    });

    expect(reused.statusCode).toBe(401);
    const [entry] = await api.audit(organization.sandboxId, 'user-session.created');
    expect(entry?.metadata).toEqual({ mfa: 'recovery-code' });
  });

  it('answers a wrong code and a bad token with 401 problem+json', async () => {
    const api = await harness();
    const organization = await api.organization();
    const operator = await totpOperator(api, organization);
    const { 'mfa-token': mfaToken } = expectJson<{ 'mfa-token': string }>(
      await login(api, operator.email),
      202,
    );

    const wrong = await api.call('POST', '/sessions/mfa', {
      payload: { 'mfa-token': mfaToken, 'totp-code': '000000' },
    });
    const unknown = await api.call('POST', '/sessions/mfa', {
      payload: { 'mfa-token': `ovm_${'A'.repeat(43)}`, 'totp-code': '000000' },
    });

    for (const response of [wrong, unknown]) {
      expect(response.statusCode).toBe(401);
      expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
      problemSchema.parse(response.json());
    }
  });

  it('validates the body: one code, of the right shape', async () => {
    const api = await harness();
    const token = `ovm_${'A'.repeat(43)}`;

    for (const payload of [
      { 'mfa-token': token },
      { 'mfa-token': token, 'totp-code': '12345' },
      { 'mfa-token': token, 'totp-code': '123456', 'recovery-code': 'AAAA-BBBB-CCCC' },
      { 'mfa-token': 'nope', 'totp-code': '123456' },
    ]) {
      expect((await api.call('POST', '/sessions/mfa', { payload })).statusCode).toBe(400);
    }
  });
});

describe('MFA sign-in problem codes (C25.1, Workflow 2E)', () => {
  function expectCode(response: Awaited<ReturnType<DashboardHarness['call']>>, code: string) {
    expect(response.statusCode, response.body).toBe(401);
    expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(problemSchema.parse(response.json()).code).toBe(code);
  }

  async function challenge(api: DashboardHarness, email: string): Promise<string> {
    return expectJson<{ 'mfa-token': string }>(await login(api, email), 202)['mfa-token'];
  }

  const submit = (api: DashboardHarness, mfaToken: string, code: string) =>
    api.call('POST', '/sessions/mfa', { payload: { 'mfa-token': mfaToken, 'totp-code': code } });

  it('answers mfa_code_invalid for a wrong code, and the token still works', async () => {
    const api = await harness();
    const organization = await api.organization();
    const operator = await totpOperator(api, organization);
    const mfaToken = await challenge(api, operator.email);

    expectCode(await submit(api, mfaToken, '000000'), 'mfa_code_invalid');
    expectCode(
      await api.call('POST', '/sessions/mfa', {
        payload: { 'mfa-token': mfaToken, 'recovery-code': 'AAAA-BBBB-CCCC' },
      }),
      'mfa_code_invalid',
    );
    expectJson(await submit(api, mfaToken, totpCode(operator.secret, api.clock.now())), 201);
  });

  it('answers mfa_attempts_exhausted for the fifth wrong code, then mfa_token_invalid', async () => {
    const api = await harness();
    const organization = await api.organization();
    const operator = await totpOperator(api, organization);
    const mfaToken = await challenge(api, operator.email);

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expectCode(await submit(api, mfaToken, '000000'), 'mfa_code_invalid');
    }
    expectCode(await submit(api, mfaToken, '000000'), 'mfa_attempts_exhausted');
    expectCode(
      await submit(api, mfaToken, totpCode(operator.secret, api.clock.now())),
      'mfa_token_invalid',
    );
  });

  it('answers mfa_token_invalid for an unknown, expired or used token', async () => {
    const api = await harness();
    const organization = await api.organization();
    const operator = await totpOperator(api, organization);
    const used = await challenge(api, operator.email);
    expectJson(await submit(api, used, totpCode(operator.secret, api.clock.now())), 201);
    api.clock.advance(30_000);
    const expired = await challenge(api, operator.email);
    api.clock.advance(5 * 60 * 1000 + 1);

    expectCode(await submit(api, `ovm_${'A'.repeat(43)}`, '000000'), 'mfa_token_invalid');
    expectCode(await submit(api, used, '000000'), 'mfa_token_invalid');
    expectCode(
      await submit(api, expired, totpCode(operator.secret, api.clock.now())),
      'mfa_token_invalid',
    );
  });

  it('answers the same codes for a security key assertion', async () => {
    const api = await harness();
    const organization = await api.organization();
    const operator = await api.operator(organization);
    const authenticator = createSoftwareAuthenticator({ origin: WEBAUTHN.origin });
    const token = await api.signIn(operator.email);
    const { options: creation } = expectJson<{
      options: Parameters<typeof authenticator.register>[0];
    }>(await api.call('POST', '/me/mfa-factors/webauthn/options', { token, payload: {} }), 200);
    expectJson(
      await api.call('POST', '/me/mfa-factors/webauthn/verify', {
        token,
        payload: { credential: authenticator.register(creation), name: 'Synthetic key' },
      }),
      201,
    );
    const mfaToken = await challenge(api, operator.email);
    const stranger = createSoftwareAuthenticator({ origin: WEBAUTHN.origin });
    const wrong = () =>
      api.call('POST', '/sessions/mfa/webauthn/verify', {
        payload: {
          'mfa-token': mfaToken,
          credential: stranger.authenticate({ challenge: 'c3RyYW5nZXI', rpId: WEBAUTHN.rpId }),
        },
      });

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expectCode(await wrong(), 'mfa_code_invalid');
    }
    expectCode(await wrong(), 'mfa_attempts_exhausted');
    expectCode(await wrong(), 'mfa_token_invalid');
    expectCode(
      await api.call('POST', '/sessions/mfa/webauthn/verify', {
        payload: {
          'mfa-token': `ovm_${'B'.repeat(43)}`,
          credential: stranger.authenticate({ challenge: 'c3RyYW5nZXI', rpId: WEBAUTHN.rpId }),
        },
      }),
      'mfa_token_invalid',
    );
  });
});

describe('POST /sessions/mfa/webauthn/options and /verify', () => {
  it('signs in with a security key registered through the API', async () => {
    const api = await harness();
    const organization = await api.organization();
    const operator = await api.operator(organization);
    const authenticator = createSoftwareAuthenticator({ origin: WEBAUTHN.origin });
    const token = await api.signIn(operator.email);
    const { options: creation } = expectJson<{
      options: Parameters<typeof authenticator.register>[0];
    }>(await api.call('POST', '/me/mfa-factors/webauthn/options', { token, payload: {} }), 200);
    expectJson(
      await api.call('POST', '/me/mfa-factors/webauthn/verify', {
        token,
        payload: { credential: authenticator.register(creation), name: 'Synthetic key' },
      }),
      201,
    );
    const challenge = expectJson<{ 'mfa-token': string; factors: { type: string }[] }>(
      await login(api, operator.email),
      202,
    );
    expect(challenge.factors.map(({ type }) => type)).toEqual(['webauthn']);

    const { options } = expectJson<{ options: Parameters<typeof authenticator.authenticate>[0] }>(
      await api.call('POST', '/sessions/mfa/webauthn/options', {
        payload: { 'mfa-token': challenge['mfa-token'] },
      }),
      200,
    );
    const response = await api.call('POST', '/sessions/mfa/webauthn/verify', {
      payload: {
        'mfa-token': challenge['mfa-token'],
        credential: authenticator.authenticate(options),
      },
    });

    dashboardSessionResponseSchema.parse(expectJson(response, 201));
    const [entry] = await api.audit(organization.sandboxId, 'user-session.created');
    expect(entry?.metadata).toEqual({ mfa: 'webauthn' });
  });

  it('answers 409 for options when the user has no security key, and 401 for a bad assertion', async () => {
    const api = await harness();
    const organization = await api.organization();
    const operator = await totpOperator(api, organization);
    const { 'mfa-token': mfaToken } = expectJson<{ 'mfa-token': string }>(
      await login(api, operator.email),
      202,
    );

    const options = await api.call('POST', '/sessions/mfa/webauthn/options', {
      payload: { 'mfa-token': mfaToken },
    });
    const stranger = createSoftwareAuthenticator({ origin: WEBAUTHN.origin });
    const verify = await api.call('POST', '/sessions/mfa/webauthn/verify', {
      payload: {
        'mfa-token': mfaToken,
        credential: stranger.authenticate({ challenge: 'c3RyYW5nZXI', rpId: WEBAUTHN.rpId }),
      },
    });

    expect(options.statusCode).toBe(409);
    expect(verify.statusCode).toBe(401);
  });

  it('answers 503 for options when no relying party is configured', async () => {
    const api = await harness({ webauthn: null });
    const organization = await api.organization();
    const operator = await totpOperator(api, organization);
    const { 'mfa-token': mfaToken } = expectJson<{ 'mfa-token': string }>(
      await login(api, operator.email),
      202,
    );

    const response = await api.call('POST', '/sessions/mfa/webauthn/options', {
      payload: { 'mfa-token': mfaToken },
    });

    expect(response.statusCode).toBe(503);
    expect(problemSchema.parse(response.json()).detail).toContain('OPENVERIFY_WEBAUTHN_RP_ID');
  });
});

describe('the operator client address behind the BFF (C15, F003/F007)', () => {
  it('keys the login limiter and audit entries on x-openverify-client-ip with the BFF token', async () => {
    const api = await harness();
    const organization = await api.organization();
    const operator = await api.operator(organization);
    const bff = { [BFF_TOKEN_HEADER]: BFF_TOKEN, [BFF_CLIENT_IP_HEADER]: '198.51.100.33' };

    expectJson(await login(api, operator.email, { headers: bff, remoteAddress: '10.0.0.5' }), 201);

    const [entry] = await api.audit(organization.sandboxId, 'user-session.created');
    expect(entry?.ip).toBe('198.51.100.33');
  });

  it('ignores the header without the token, so a client cannot choose its address', async () => {
    const api = await harness();
    const organization = await api.organization();
    const operator = await api.operator(organization);

    expectJson(
      await login(api, operator.email, {
        headers: { [BFF_CLIENT_IP_HEADER]: '198.51.100.33' },
        remoteAddress: '10.0.0.5',
      }),
      201,
    );

    const [entry] = await api.audit(organization.sandboxId, 'user-session.created');
    expect(entry?.ip).toBe('10.0.0.5');
  });

  it('limits per operator address, not per BFF address', async () => {
    const { createLoginRateLimiter } = await import('../../operator-auth/index.js');
    const api = await harness({
      rateLimiter: createLoginRateLimiter({ perIp: { max: 2, windowMs: 60_000 } }),
    });
    const attempt = (clientIp: string) =>
      login(api, 'nobody@example.test', {
        headers: { [BFF_TOKEN_HEADER]: BFF_TOKEN, [BFF_CLIENT_IP_HEADER]: clientIp },
        remoteAddress: '10.0.0.5',
      });

    await attempt('203.0.113.1');
    await attempt('203.0.113.1');
    const limited = await attempt('203.0.113.1');
    const other = await attempt('203.0.113.2');

    expect(limited.statusCode).toBe(429);
    expect(other.statusCode).toBe(401);
  });
});

describe('GET /me (C15)', () => {
  it('returns the user with its roles and the session context', async () => {
    const api = await harness();
    const organization = await api.organization();
    const operator = await api.operator(organization, {
      roles: ['viewer', 'reviewer'],
      name: 'Synthetic Name',
    });
    const token = await api.signIn(operator.email);

    const body = dashboardMeDocumentSchema.parse(
      expectJson(await api.call('GET', '/me', { token }), 200),
    );

    expect(body.data).toMatchObject({
      id: operator.user.id,
      attributes: { email: operator.email, name: 'Synthetic Name', status: 'active' },
      relationships: {
        roles: {
          data: [
            { type: 'role', id: organization.roleIds.reviewer },
            { type: 'role', id: organization.roleIds.viewer },
          ].sort((a, b) => a.id.localeCompare(b.id)),
        },
      },
    });
    const granted = new Set([
      ...BUILTIN_ROLES.viewer.permissions,
      ...BUILTIN_ROLES.reviewer.permissions,
    ]);
    expect(body.meta).toEqual({
      environment: { id: organization.sandboxId, kind: 'sandbox' },
      environments: [{ id: organization.sandboxId, kind: 'sandbox' }],
      permissions: PERMISSIONS.filter((permission) => granted.has(permission)),
      'mfa-satisfied': true,
    });
  });
});

describe('required MFA (C15)', () => {
  it('limits a session that has not satisfied MFA to /me, MFA enrolment and logout', async () => {
    const api = await harness();
    const organization = await api.organization({ requireMfa: true });
    const operator = await api.operator(organization);
    const token = await api.signIn(operator.email);

    const me = dashboardMeDocumentSchema.parse(
      expectJson(await api.call('GET', '/me', { token }), 200),
    );
    expect(me.meta?.['mfa-satisfied']).toBe(false);
    expect((await api.call('GET', '/me/mfa-factors', { token })).statusCode).toBe(200);
    for (const [method, path] of [
      ['GET', '/inquiries'],
      ['GET', '/users'],
      ['GET', '/settings'],
      ['POST', '/me/recovery-codes'],
    ] as const) {
      const response = await api.call(method, path, {
        token,
        ...(method === 'POST' ? { payload: {} } : {}),
      });
      expect(response.statusCode, `${method} ${path}`).toBe(401);
      expect(response.json()).toMatchObject({
        type: 'https://openverify.dev/problems/mfa-required',
      });
    }
    expect((await api.call('DELETE', '/sessions/current', { token })).statusCode).toBe(204);
  });

  it('refuses enrolment and factor removal to an unsatisfied session once the user has an active factor (2B F002)', async () => {
    const api = await harness();
    const organization = await api.organization({ requireMfa: true });
    const operator = await api.operator(organization);
    let stolen = await api.signIn(operator.email);
    const own = await api.signIn(operator.email);
    const unsatisfiedSession = async (environmentId: string, userId: string) => {
      const token = newUserSessionToken();
      await createUserSession(database.db, {
        id: newId('uss'),
        organizationId: organization.id,
        userId,
        environmentId,
        tokenHash: hashSessionToken(token),
        expiresAt: new Date(api.clock.now().getTime() + 3_600_000),
      });
      return token;
    };
    const enrolment = expectJson<{ data: { id: string }; meta: { secret: string } }>(
      await api.call('POST', '/me/mfa-factors/totp', { token: own, payload: {} }),
      201,
    );
    expectJson(
      await api.call('POST', '/me/mfa-factors/totp/confirm', {
        token: own,
        payload: {
          'factor-id': enrolment.data.id,
          'totp-code': totpCode(enrolment.meta.secret, api.clock.now()),
        },
      }),
      200,
    );
    // C168.4 (Workflow 9B): the enrolment revoked the session opened before it; an unsatisfied
    // session that outlived it anyway (written here directly) is still held to its factor.
    expect((await api.call('GET', '/me', { token: stolen })).statusCode).toBe(401);
    stolen = await unsatisfiedSession(organization.sandboxId, operator.user.id);

    for (const [method, path, payload] of [
      ['POST', '/me/mfa-factors/totp', {}],
      [
        'POST',
        '/me/mfa-factors/totp/confirm',
        { 'factor-id': enrolment.data.id, 'totp-code': '000000' },
      ],
      ['POST', '/me/mfa-factors/webauthn/options', {}],
      ['DELETE', `/me/mfa-factors/${enrolment.data.id}`, undefined],
    ] as const) {
      const response = await api.call(method, path, {
        token: stolen,
        ...(payload === undefined ? {} : { payload }),
      });
      expect(response.statusCode, `${method} ${path}`).toBe(401);
      expect(response.json()).toMatchObject({
        type: 'https://openverify.dev/problems/mfa-required',
      });
    }
    expect((await api.call('GET', '/inquiries', { token: stolen })).statusCode).toBe(401);
    const factors = expectJson<{ data: { id: string; attributes: { status: string } }[] }>(
      await api.call('GET', '/me/mfa-factors', { token: own }),
      200,
    );
    expect(factors.data.map((factor) => [factor.id, factor.attributes.status])).toEqual([
      [enrolment.data.id, 'active'],
    ]);
  });

  it('satisfies the session once the user activates a factor in it', async () => {
    const api = await harness();
    const organization = await api.organization({ requireMfa: true });
    const operator = await api.operator(organization);
    const token = await api.signIn(operator.email);
    const enrolment = expectJson<{ data: { id: string }; meta: { secret: string } }>(
      await api.call('POST', '/me/mfa-factors/totp', { token, payload: {} }),
      201,
    );

    expectJson(
      await api.call('POST', '/me/mfa-factors/totp/confirm', {
        token,
        payload: {
          'factor-id': enrolment.data.id,
          'totp-code': totpCode(enrolment.meta.secret, api.clock.now()),
        },
      }),
      200,
    );

    expect((await api.call('GET', '/inquiries', { token })).statusCode).toBe(200);
  });
});

import {
  confirmTotpResponseSchema,
  enrollTotpResponseSchema,
  mfaFactorListDocumentSchema,
  newId,
  problemSchema,
  recoveryCodesResponseSchema,
  webauthnRegistrationOptionsResponseSchema,
} from '@openverify/contracts';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createSoftwareAuthenticator } from '../../operator-auth/testing/software-authenticator.js';
import { totpCode } from '../../operator-auth/totp.js';
import {
  WEBAUTHN,
  createDashboardHarness,
  expectJson,
  type DashboardHarness,
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

async function signedIn(options?: Parameters<typeof createDashboardHarness>[1]) {
  const api = await createDashboardHarness(database, options);
  harnesses.push(api);
  const organization = await api.organization();
  const operator = await api.operator(organization, { roles: ['viewer'] });
  const token = await api.signIn(operator.email);
  return { api, organization, operator, token };
}

async function enrol(api: DashboardHarness, token: string, name?: string) {
  return enrollTotpResponseSchema.parse(
    expectJson(
      await api.call('POST', '/me/mfa-factors/totp', {
        token,
        payload: name === undefined ? {} : { name },
      }),
      201,
    ),
  );
}

describe('POST /me/mfa-factors/totp and /confirm', () => {
  it('returns the secret and otpauth URI once, then activates the factor with a code', async () => {
    const { api, organization, operator, token } = await signedIn();

    const enrolment = await enrol(api, token, 'Phone');
    expect(enrolment.data.attributes).toMatchObject({
      kind: 'totp',
      name: 'Phone',
      status: 'pending',
    });

    const confirmed = confirmTotpResponseSchema.parse(
      expectJson(
        await api.call('POST', '/me/mfa-factors/totp/confirm', {
          token,
          payload: {
            'factor-id': enrolment.data.id,
            'totp-code': totpCode(enrolment.meta.secret, api.clock.now()),
          },
        }),
        200,
      ),
    );

    expect(confirmed.data.attributes.status).toBe('active');
    expect(confirmed.meta?.['recovery-codes']).toHaveLength(10);
    const list = mfaFactorListDocumentSchema.parse(
      expectJson(await api.call('GET', '/me/mfa-factors', { token }), 200),
    );
    expect(list.data.map(({ id }) => id)).toEqual([enrolment.data.id]);
    expect(JSON.stringify(list)).not.toContain(enrolment.meta.secret);
    expect((await api.audit(organization.sandboxId)).map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['mfa-factor.created', 'mfa-factor.activated']),
    );
    const [activated] = await api.audit(organization.sandboxId, 'mfa-factor.activated');
    expect(activated).toMatchObject({
      actorId: operator.user.id,
      resourceType: 'mfa-factor',
      resourceId: enrolment.data.id,
      metadata: { kind: 'totp' },
    });
  });

  it('answers 422 for a wrong code, 409 when already active, 404 for another user’s factor', async () => {
    const { api, token } = await signedIn();
    const other = await api.operator(await api.organization());
    const otherToken = await api.signIn(other.email);
    const enrolment = await enrol(api, token);
    const confirm = (by: string, code: string) =>
      api.call('POST', '/me/mfa-factors/totp/confirm', {
        token: by,
        payload: { 'factor-id': enrolment.data.id, 'totp-code': code },
      });

    const wrong = await confirm(
      token,
      totpCode(enrolment.meta.secret, new Date(api.clock.now().getTime() + 600_000)),
    );
    const foreign = await confirm(otherToken, totpCode(enrolment.meta.secret, api.clock.now()));
    expectJson(await confirm(token, totpCode(enrolment.meta.secret, api.clock.now())), 200);
    const again = await confirm(token, totpCode(enrolment.meta.secret, api.clock.now()));

    expect(wrong.statusCode).toBe(422);
    expect(foreign.statusCode).toBe(404);
    expect(again.statusCode).toBe(409);
  });

  it('requires a session', async () => {
    const { api } = await signedIn();

    expect((await api.call('POST', '/me/mfa-factors/totp', { payload: {} })).statusCode).toBe(401);
    expect((await api.call('GET', '/me/mfa-factors')).statusCode).toBe(401);
  });
});

describe('POST /me/mfa-factors/webauthn/options and /verify', () => {
  it('registers a security key and lists it as active', async () => {
    const { api, organization, token } = await signedIn();
    const authenticator = createSoftwareAuthenticator({ origin: WEBAUTHN.origin });

    const { options } = webauthnRegistrationOptionsResponseSchema.parse(
      expectJson(
        await api.call('POST', '/me/mfa-factors/webauthn/options', { token, payload: {} }),
        200,
      ),
    );
    const registered = confirmTotpResponseSchema.parse(
      expectJson(
        await api.call('POST', '/me/mfa-factors/webauthn/verify', {
          token,
          payload: {
            credential: authenticator.register(
              options as Parameters<typeof authenticator.register>[0],
            ),
            name: 'Laptop',
          },
        }),
        201,
      ),
    );

    expect(registered.data.attributes).toMatchObject({
      kind: 'webauthn',
      name: 'Laptop',
      status: 'active',
    });
    expect(registered.meta?.['recovery-codes']).toHaveLength(10);
    const [created] = await api.audit(organization.sandboxId, 'mfa-factor.created');
    expect(created?.metadata).toEqual({ kind: 'webauthn' });
  });

  it('answers 422 for a credential that does not verify', async () => {
    const { api, token } = await signedIn();
    const authenticator = createSoftwareAuthenticator({ origin: 'https://evil.example' });
    const { options } = webauthnRegistrationOptionsResponseSchema.parse(
      expectJson(
        await api.call('POST', '/me/mfa-factors/webauthn/options', { token, payload: {} }),
        200,
      ),
    );

    const response = await api.call('POST', '/me/mfa-factors/webauthn/verify', {
      token,
      payload: {
        credential: authenticator.register(options as Parameters<typeof authenticator.register>[0]),
      },
    });

    expect(response.statusCode).toBe(422);
  });

  it('answers 503 when no relying party is configured', async () => {
    const { api, token } = await signedIn({ webauthn: null });

    const response = await api.call('POST', '/me/mfa-factors/webauthn/options', {
      token,
      payload: {},
    });

    expect(response.statusCode).toBe(503);
    expect(problemSchema.parse(response.json()).detail).toContain('WebAuthn is not configured');
  });
});

describe('DELETE /me/mfa-factors/:id', () => {
  it('removes the user’s factor and audits it; 404 for another user’s or an unknown factor', async () => {
    const { api, organization, token } = await signedIn();
    const other = await signedIn();
    const enrolment = await enrol(api, token);

    expect(
      (
        await other.api.call('DELETE', `/me/mfa-factors/${enrolment.data.id}`, {
          token: other.token,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await api.call('DELETE', `/me/mfa-factors/${newId('mfa')}`, { token })).statusCode,
    ).toBe(404);
    const response = await api.call('DELETE', `/me/mfa-factors/${enrolment.data.id}`, { token });

    expect(response.statusCode).toBe(204);
    expect(
      mfaFactorListDocumentSchema.parse(
        expectJson(await api.call('GET', '/me/mfa-factors', { token }), 200),
      ).data,
    ).toEqual([]);
    expect(await api.audit(organization.sandboxId, 'mfa-factor.deleted')).toHaveLength(1);
  });

  it('validates the id', async () => {
    const { api, token } = await signedIn();

    expect((await api.call('DELETE', '/me/mfa-factors/not-an-id', { token })).statusCode).toBe(400);
  });
});

describe('POST /me/recovery-codes', () => {
  it('regenerates the codes once the user has an active factor, and audits it', async () => {
    const { api, organization, token } = await signedIn();
    const enrolment = await enrol(api, token);
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

    const response = await api.call('POST', '/me/recovery-codes', { token, payload: {} });

    expect(
      recoveryCodesResponseSchema.parse(expectJson(response, 201))['recovery-codes'],
    ).toHaveLength(10);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(await api.audit(organization.sandboxId, 'recovery-codes.regenerated')).toHaveLength(1);
  });

  it('answers 409 without an active factor', async () => {
    const { api, token } = await signedIn();

    expect((await api.call('POST', '/me/recovery-codes', { token, payload: {} })).statusCode).toBe(
      409,
    );
  });
});

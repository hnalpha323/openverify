// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CREATED_AT, SESSION_TOKEN } from '../../testing/api-fixtures';
import { mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { SESSION_COOKIE } from '../session-cookie';
import {
  confirmTotp,
  deleteMfaFactor,
  enrollTotp,
  listMfaFactors,
  regenerateRecoveryCodes,
  verifyWebauthnRegistration,
  webauthnRegistrationOptions,
} from './mfa';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

const FACTOR_ID = 'mfa_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z';
const CODES = Array.from(
  { length: 10 },
  (_, index) => `ABCD-EFGH-JK${String(index).padStart(2, '0')}`,
);

function factor(status: 'pending' | 'active' = 'active', kind: 'totp' | 'webauthn' = 'totp') {
  return {
    type: 'mfa-factor',
    id: FACTOR_ID,
    attributes: {
      kind,
      name: 'Phone',
      status,
      'created-at': CREATED_AT,
      'confirmed-at': status === 'active' ? CREATED_AT : null,
      'last-used-at': null,
    },
  };
}

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
});

describe('the MFA enrolment API (C15)', () => {
  it('lists the operator factors', async () => {
    api.reply(200, { data: [factor()], links: { next: null } });

    await expect(listMfaFactors()).resolves.toEqual([factor()]);
    expect(api.last()).toMatchObject({ method: 'GET', path: '/api/v1/dashboard/me/mfa-factors' });
  });

  it('starts a TOTP enrolment and hands back the secret shown once', async () => {
    const meta = {
      'otpauth-uri': 'otpauth://totp/OpenVerify:operator?secret=JBSWY3DPEHPK3PXP',
      secret: 'JBSWY3DPEHPK3PXP',
    };
    api.reply(201, { data: factor('pending'), meta });

    await expect(enrollTotp('Phone')).resolves.toEqual({ factor: factor('pending'), ...meta });
    expect(api.last()).toMatchObject({
      method: 'POST',
      path: '/api/v1/dashboard/me/mfa-factors/totp',
      body: { name: 'Phone' },
    });
  });

  it('sends no name when none is given', async () => {
    api.reply(201, {
      data: factor('pending'),
      meta: {
        'otpauth-uri': 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP',
        secret: 'JBSWY3DPEHPK3PXP',
      },
    });

    await enrollTotp(undefined);

    expect(api.last().body).toEqual({});
  });

  it('confirms TOTP, with the recovery codes of a first factor', async () => {
    api.reply(200, { data: factor(), meta: { 'recovery-codes': CODES } }).reply(200, {
      data: factor(),
    });

    await expect(confirmTotp(FACTOR_ID, '123456')).resolves.toEqual({
      factor: factor(),
      recoveryCodes: CODES,
    });
    expect(api.requests[0]).toMatchObject({
      path: '/api/v1/dashboard/me/mfa-factors/totp/confirm',
      body: { 'factor-id': FACTOR_ID, 'totp-code': '123456' },
    });
    await expect(confirmTotp(FACTOR_ID, '123456')).resolves.toEqual({
      factor: factor(),
      recoveryCodes: null,
    });
  });

  it('registers a security key in two steps', async () => {
    const options = {
      challenge: 'Y2hhbGxlbmdl',
      rp: { name: 'OpenVerify', id: 'localhost' },
      user: { id: 'dXNlcg', name: 'operator@example.test', displayName: 'Operator' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    };
    const credential = {
      id: 'Y3JlZA',
      rawId: 'Y3JlZA',
      type: 'public-key',
      response: { clientDataJSON: 'e30', attestationObject: 'YXR0' },
      clientExtensionResults: {},
    };
    api.reply(200, { options }).reply(201, { data: factor('active', 'webauthn') });

    await expect(webauthnRegistrationOptions()).resolves.toEqual(options);
    await expect(verifyWebauthnRegistration(credential, 'Laptop key')).resolves.toEqual({
      factor: factor('active', 'webauthn'),
      recoveryCodes: null,
    });
    expect(api.requests[0]).toMatchObject({
      path: '/api/v1/dashboard/me/mfa-factors/webauthn/options',
      body: {},
    });
    expect(api.requests[1]).toMatchObject({
      path: '/api/v1/dashboard/me/mfa-factors/webauthn/verify',
      body: { credential, name: 'Laptop key' },
    });
  });

  it('removes a factor', async () => {
    api.reply(204);

    await deleteMfaFactor(FACTOR_ID);

    expect(api.last()).toMatchObject({
      method: 'DELETE',
      path: `/api/v1/dashboard/me/mfa-factors/${FACTOR_ID}`,
    });
  });

  it('regenerates the recovery codes', async () => {
    api.reply(201, { 'recovery-codes': CODES });

    await expect(regenerateRecoveryCodes()).resolves.toEqual(CODES);
    expect(api.last()).toMatchObject({
      method: 'POST',
      path: '/api/v1/dashboard/me/recovery-codes',
    });
  });
});

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { CREATED_AT, SESSION_TOKEN } from '../../testing/api-fixtures';
import { meDocument, mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { redirectTarget } from '../../testing/next-errors';
import {
  confirmTotpEnrolment,
  finishWebauthnEnrolment,
  regenerateCodes,
  removeMfaFactor,
  signInAgain,
  startTotpEnrolment,
  startWebauthnEnrolment,
} from './account-security';

const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock('next/cache', () => cache);
vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

const FACTOR_ID = 'mfa_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z';
const SECRET = 'JBSWY3DPEHPK3PXP';
const URI = `otpauth://totp/OpenVerify:operator%40example.test?secret=${SECRET}&issuer=OpenVerify`;
const CODES = Array.from(
  { length: 10 },
  (_, index) => `ABCD-EFGH-JK${String(index).padStart(2, '0')}`,
);
const CREDENTIAL = {
  id: 'Y3JlZA',
  rawId: 'Y3JlZA',
  type: 'public-key',
  response: { clientDataJSON: 'e30', attestationObject: 'YXR0' },
  clientExtensionResults: {},
};

function factor(status: 'pending' | 'active', kind: 'totp' | 'webauthn' = 'totp') {
  return {
    type: 'mfa-factor',
    id: FACTOR_ID,
    attributes: {
      kind,
      name: null,
      status,
      'created-at': CREATED_AT,
      'confirmed-at': status === 'active' ? CREATED_AT : null,
      'last-used-at': null,
    },
  };
}

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
};

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  cache.revalidatePath.mockReset();
});

afterEach(() => {
  api.restore();
});

describe('startTotpEnrolment', () => {
  it('creates a pending factor and returns its secret with a QR code drawn on the server', async () => {
    // A session without a factor in an organization that requires MFA may enrol (C15).
    api
      .reply(200, meDocument({ mfaSatisfied: false }))
      .reply(201, { data: factor('pending'), meta: { 'otpauth-uri': URI, secret: SECRET } });

    const result = await startTotpEnrolment(null, form({ name: ' Phone ' }));

    expect(result).toMatchObject({
      ok: true,
      data: { factorId: FACTOR_ID, secret: SECRET, otpauthUri: URI },
    });
    // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
    expect(result.ok && result.data.qr.path).toMatch(/^(M\d+ \d+h1v1h-1z)+$/);
    expect(api.last()).toMatchObject({
      path: '/api/v1/dashboard/me/mfa-factors/totp',
      body: { name: 'Phone' },
    });
  });

  it('sends no name when the field is left empty', async () => {
    api
      .reply(200, meDocument())
      .reply(201, { data: factor('pending'), meta: { 'otpauth-uri': URI, secret: SECRET } });

    await startTotpEnrolment(null, form({ name: '' }));

    expect(api.last().body).toEqual({});
  });

  it('sends a session that must log in with its existing factor to the security page (2B F002)', async () => {
    api.reply(200, meDocument({ mfaSatisfied: false })).replyProblem(401, 'mfa-required');

    await expect(redirectTarget(startTotpEnrolment(null, form({})))).resolves.toBe(
      '/account/security',
    );
  });
});

describe('confirmTotpEnrolment', () => {
  it('activates the factor with a code, and returns the first recovery codes', async () => {
    api
      .reply(200, meDocument())
      .reply(200, { data: factor('active'), meta: { 'recovery-codes': CODES } });

    await expect(
      confirmTotpEnrolment(null, form({ 'factor-id': FACTOR_ID, 'totp-code': ' 123456 ' })),
    ).resolves.toEqual({ ok: true, data: { recoveryCodes: CODES } });
    expect(api.last().body).toEqual({ 'factor-id': FACTOR_ID, 'totp-code': '123456' });
    expect(cache.revalidatePath).toHaveBeenCalledWith('/account/security');
  });

  it('refuses a code that is not 6 digits without calling the API', async () => {
    api.reply(200, meDocument());

    await expect(
      confirmTotpEnrolment(null, form({ 'factor-id': FACTOR_ID, 'totp-code': '12' })),
    ).resolves.toMatchObject({ ok: false, problem: { errors: [{ pointer: '/totp-code' }] } });
    expect(api.requests).toHaveLength(1);
  });

  it("shows the API's refusal of a wrong code", async () => {
    api.reply(200, meDocument()).replyProblem(422, undefined, {
      title: 'Unprocessable Entity',
      detail: 'The code is not valid.',
    });

    await expect(
      confirmTotpEnrolment(null, form({ 'factor-id': FACTOR_ID, 'totp-code': '000000' })),
    ).resolves.toMatchObject({ ok: false, problem: { detail: 'The code is not valid.' } });
  });
});

describe('the security key enrolment', () => {
  it('starts with creation options', async () => {
    const options = {
      challenge: 'Y2hhbGxlbmdl',
      rp: { name: 'OpenVerify', id: 'localhost' },
      user: { id: 'dXNlcg', name: 'operator@example.test', displayName: 'Operator' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    };
    api.reply(200, meDocument()).reply(200, { options });

    await expect(startWebauthnEnrolment()).resolves.toEqual({ ok: true, data: { options } });
  });

  it('finishes with the registration, named, returning the first recovery codes', async () => {
    api
      .reply(200, meDocument())
      .reply(201, { data: factor('active', 'webauthn'), meta: { 'recovery-codes': CODES } });

    await expect(
      finishWebauthnEnrolment({ credential: CREDENTIAL, name: 'Laptop key' }),
    ).resolves.toEqual({ ok: true, data: { recoveryCodes: CODES } });
    expect(api.last().body).toEqual({ credential: CREDENTIAL, name: 'Laptop key' });
    expect(cache.revalidatePath).toHaveBeenCalledWith('/account/security');
  });

  it('refuses something that is not a registration', async () => {
    api.reply(200, meDocument());

    await expect(finishWebauthnEnrolment({ credential: { id: 'x' } })).resolves.toMatchObject({
      ok: false,
      problem: { title: 'Check the values you entered' },
    });
    expect(api.requests).toHaveLength(1);
  });
});

describe('removeMfaFactor', () => {
  it('removes the factor', async () => {
    api.reply(200, meDocument()).reply(204);

    await expect(removeMfaFactor(null, form({ 'factor-id': FACTOR_ID }))).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(api.last()).toMatchObject({
      method: 'DELETE',
      path: `/api/v1/dashboard/me/mfa-factors/${FACTOR_ID}`,
    });
  });

  it('refuses a malformed factor id', async () => {
    api.reply(200, meDocument());

    await expect(removeMfaFactor(null, form({ 'factor-id': '../users' }))).resolves.toMatchObject({
      ok: false,
    });
    expect(api.requests).toHaveLength(1);
  });
});

describe('regenerateCodes', () => {
  it('returns the new recovery codes', async () => {
    api.reply(200, meDocument()).reply(201, { 'recovery-codes': CODES });

    await expect(regenerateCodes()).resolves.toEqual({ ok: true, data: CODES });
  });

  it('needs a session that passed MFA', async () => {
    api.reply(200, meDocument({ mfaSatisfied: false }));

    await expect(redirectTarget(regenerateCodes())).resolves.toBe('/account/security');
  });
});

describe('signInAgain', () => {
  it('says the old session could not be ended when the API cannot revoke it (Workflow 2D F005)', async () => {
    api.replyProblem(503);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(redirectTarget(signInAgain())).resolves.toBe('/login?reason=signout-incomplete');

    expect(fakeRequest.deleteCookie).toHaveBeenCalledWith(SESSION_COOKIE);
    log.mockRestore();
  });

  it('ends the session and asks for a sign-in with the second factor (2B F002)', async () => {
    api.reply(204);

    await expect(redirectTarget(signInAgain())).resolves.toBe('/login?reason=mfa-reauth');
    expect(api.last()).toMatchObject({
      method: 'DELETE',
      path: '/api/v1/dashboard/sessions/current',
    });
    expect(fakeRequest.deleteCookie).toHaveBeenCalledWith(SESSION_COOKIE);
  });
});

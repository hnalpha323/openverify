// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_LOGIN_STATE } from '../../lib/login-state';
import {
  MFA_CHALLENGE_COOKIE,
  encodeMfaChallenge,
  type MfaChallenge,
} from '../../lib/mfa-challenge';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { EXPIRES_AT, SESSION_TOKEN, sessionResponse } from '../../testing/api-fixtures';
import { fakeRequest } from '../../testing/fake-request';
import { redirectTarget } from '../../testing/next-errors';
import {
  cancelMfaLogin,
  completeMfa,
  finishWebauthnLogin,
  login,
  logout,
  startWebauthnLogin,
} from './auth';

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  completeMfaLogin: vi.fn(),
  webauthnLoginOptions: vi.fn(),
  verifyWebauthnLogin: vi.fn(),
}));

vi.mock('../../lib/api/sessions', () => mocks);
vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

const NOW = new Date('2026-10-20T12:00:00.000Z');
const MFA_TOKEN = `ovm_${'M'.repeat(43)}`;
const PASSWORD = ' correct horse battery staple ';
const ASSERTION = {
  id: 'Y3JlZGVudGlhbA',
  rawId: 'Y3JlZGVudGlhbA',
  type: 'public-key',
  response: { clientDataJSON: 'e30', authenticatorData: 'YXV0aA', signature: 'c2ln' },
  clientExtensionResults: {},
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    mock.mockReset();
  }
  mocks.deleteSession.mockResolvedValue('ended');
  fakeRequest.reset();
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

function form(fields: Record<string, string | Blob>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
}

function challenge(): MfaChallenge {
  return {
    token: MFA_TOKEN,
    factors: ['totp', 'webauthn'],
    expiresAt: NOW.getTime() + 300_000,
  };
}

function withChallenge() {
  fakeRequest.cookies.set(MFA_CHALLENGE_COOKIE, encodeMfaChallenge(challenge()));
}

/** The challenge last written to the cookie. */
function writtenChallenge() {
  const call = fakeRequest.setCookie.mock.calls.find(([name]) => name === MFA_CHALLENGE_COOKIE);
  return call?.[1] as string | undefined;
}

/** The challenge cookie was deleted on its path. */
function expectChallengeCleared() {
  expect(fakeRequest.deleteCookie).toHaveBeenCalledWith({
    name: MFA_CHALLENGE_COOKIE,
    path: '/login',
  });
}

describe('login', () => {
  it('signs in through the API, stores the token in the cookie and opens the console', async () => {
    mocks.createSession.mockResolvedValueOnce({ kind: 'session', session: sessionResponse() });

    const target = await redirectTarget(
      login(INITIAL_LOGIN_STATE, form({ email: '  operator@example.test ', password: PASSWORD })),
    );

    // The home page opens the first console page the operator's role allows.
    expect(target).toBe('/');
    expect(mocks.createSession).toHaveBeenCalledExactlyOnceWith({
      email: 'operator@example.test',
      password: PASSWORD,
    });
    expect(fakeRequest.setCookie).toHaveBeenCalledExactlyOnceWith(
      SESSION_COOKIE,
      SESSION_TOKEN,
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', expires: new Date(EXPIRES_AT) }),
    );
  });

  it('asks for the second factor: the mfa-token goes into the /login cookie, never the URL (C22)', async () => {
    mocks.createSession.mockResolvedValueOnce({
      kind: 'mfa',
      challenge: {
        'mfa-token': MFA_TOKEN,
        factors: [
          { id: 'mfa_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z', type: 'totp' },
          { id: 'mfa_01J9ZK3M5Q7R8S9T0V1W2X3Y50', type: 'totp' },
        ],
      },
    });

    const target = await redirectTarget(
      login(INITIAL_LOGIN_STATE, form({ email: 'operator@example.test', password: PASSWORD })),
    );

    expect(target).toBe('/login/mfa');
    // No attempt count: the API counts wrong attempts (C25.1).
    expect(JSON.parse(Buffer.from(writtenChallenge() ?? '', 'base64url').toString('utf8'))).toEqual(
      { t: MFA_TOKEN, f: ['totp'], e: NOW.getTime() + 300_000 },
    );
    expect(fakeRequest.setCookie.mock.calls.some(([name]) => name === SESSION_COOKIE)).toBe(false);
  });

  it.each(['invalid_credentials', 'rate_limited', 'unavailable', 'no_environment_role'] as const)(
    'reports %s without setting a cookie',
    async (reason) => {
      mocks.createSession.mockResolvedValueOnce({ kind: 'failed', reason });

      await expect(
        login(INITIAL_LOGIN_STATE, form({ email: 'operator@example.test', password: PASSWORD })),
      ).resolves.toEqual({ error: reason });
      expect(fakeRequest.setCookie).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['a missing email', { password: PASSWORD }],
    ['a malformed email', { email: 'operator', password: PASSWORD }],
    ['a missing password', { email: 'operator@example.test' }],
    ['an empty password', { email: 'operator@example.test', password: '' }],
    ['a file as the password', { email: 'operator@example.test', password: new Blob(['x']) }],
  ])('re-validates on the server and refuses %s', async (_case, fields) => {
    await expect(login(INITIAL_LOGIN_STATE, form(fields))).resolves.toEqual({
      error: 'invalid_input',
    });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});

describe('completeMfa (TOTP and recovery codes)', () => {
  it('completes the sign-in with a TOTP code: the session cookie is set, the challenge cleared', async () => {
    withChallenge();
    mocks.completeMfaLogin.mockResolvedValueOnce({ kind: 'session', session: sessionResponse() });

    await expect(
      redirectTarget(completeMfa(null, form({ method: 'totp', code: ' 123456 ' }))),
    ).resolves.toBe('/');

    expect(mocks.completeMfaLogin).toHaveBeenCalledExactlyOnceWith({
      'mfa-token': MFA_TOKEN,
      'totp-code': '123456',
    });
    expect(fakeRequest.setCookie).toHaveBeenCalledWith(
      SESSION_COOKIE,
      SESSION_TOKEN,
      expect.objectContaining({ httpOnly: true }),
    );
    expect(fakeRequest.deleteCookie).toHaveBeenCalledWith({
      name: MFA_CHALLENGE_COOKIE,
      path: '/login',
    });
  });

  it('completes it with a recovery code', async () => {
    withChallenge();
    mocks.completeMfaLogin.mockResolvedValueOnce({ kind: 'session', session: sessionResponse() });

    await redirectTarget(completeMfa(null, form({ method: 'recovery', code: 'abcd-efgh-jkmn' })));

    expect(mocks.completeMfaLogin).toHaveBeenCalledExactlyOnceWith({
      'mfa-token': MFA_TOKEN,
      'recovery-code': 'abcd-efgh-jkmn',
    });
  });

  it('keeps the operator on /login/mfa after a wrong code, and counts nothing itself (C25.1)', async () => {
    withChallenge();
    mocks.completeMfaLogin.mockResolvedValueOnce({ kind: 'failed', reason: 'invalid_code' });

    await expect(completeMfa(null, form({ method: 'totp', code: '000000' }))).resolves.toEqual({
      error: 'invalid_code',
    });
    expect(writtenChallenge()).toBeUndefined();
    expect(fakeRequest.deleteCookie).not.toHaveBeenCalled();
  });

  it.each([
    [
      'the attempts are exhausted (the fifth wrong code revoked the token)',
      'attempts_exhausted',
      '/login?reason=mfa-attempts',
    ],
    [
      'the mfa-token is no longer valid (used, expired or revoked)',
      'token_invalid',
      '/login?reason=mfa-invalid',
    ],
    [
      'the user holds no role in any environment (C167.2; K9-9)',
      'no_environment_role',
      '/login?reason=no-environment-role',
    ],
  ] as const)(
    'returns to sign in with a message when the API says %s (C25.1)',
    async (_case, reason, target) => {
      withChallenge();
      mocks.completeMfaLogin.mockResolvedValueOnce({ kind: 'failed', reason });

      await expect(
        redirectTarget(completeMfa(null, form({ method: 'totp', code: '000000' }))),
      ).resolves.toBe(target);
      expectChallengeCleared();
    },
  );

  it.each([
    ['a TOTP code that is not 6 digits', { method: 'totp', code: '12345' }],
    ['a recovery code that is not one', { method: 'recovery', code: 'nope' }],
    ['an unknown method', { method: 'sms', code: '123456' }],
  ])('refuses %s without calling the API', async (_case, fields) => {
    withChallenge();

    await expect(completeMfa(null, form(fields))).resolves.toEqual({ error: 'invalid_input' });
    expect(mocks.completeMfaLogin).not.toHaveBeenCalled();
    expect(writtenChallenge()).toBeUndefined();
  });

  it('says the API is unavailable and keeps the challenge', async () => {
    withChallenge();
    mocks.completeMfaLogin.mockResolvedValueOnce({ kind: 'failed', reason: 'unavailable' });

    await expect(completeMfa(null, form({ method: 'totp', code: '123456' }))).resolves.toEqual({
      error: 'unavailable',
    });
    expect(writtenChallenge()).toBeUndefined();
  });

  it('sends the operator back to sign in when the challenge expired', async () => {
    await expect(
      redirectTarget(completeMfa(null, form({ method: 'totp', code: '123456' }))),
    ).resolves.toBe('/login?reason=mfa-expired');
    expect(mocks.completeMfaLogin).not.toHaveBeenCalled();
  });
});

describe('the WebAuthn sign-in (C22)', () => {
  it('hands the browser assertion options for the challenge', async () => {
    withChallenge();
    const options = { challenge: 'Y2hhbGxlbmdl', rpId: 'localhost' };
    mocks.webauthnLoginOptions.mockResolvedValueOnce({ kind: 'options', options });

    await expect(startWebauthnLogin()).resolves.toEqual({ ok: true, options });
    expect(mocks.webauthnLoginOptions).toHaveBeenCalledExactlyOnceWith(MFA_TOKEN);
  });

  it('cannot start without a challenge', async () => {
    await expect(startWebauthnLogin()).resolves.toEqual({ ok: false, error: 'expired' });
  });

  it('returns to sign in with a message when the API refuses the token (C25.1)', async () => {
    withChallenge();
    mocks.webauthnLoginOptions.mockResolvedValueOnce({ kind: 'failed', reason: 'rejected' });

    await expect(redirectTarget(startWebauthnLogin())).resolves.toBe('/login?reason=mfa-invalid');
    expectChallengeCleared();
  });

  it('says sign-in is unavailable when the API cannot give options, keeping the challenge', async () => {
    withChallenge();
    mocks.webauthnLoginOptions.mockResolvedValueOnce({ kind: 'failed', reason: 'unavailable' });

    await expect(startWebauthnLogin()).resolves.toEqual({ ok: false, error: 'unavailable' });
    expect(fakeRequest.deleteCookie).not.toHaveBeenCalled();
  });

  it('cannot finish without a challenge', async () => {
    await expect(finishWebauthnLogin(ASSERTION)).resolves.toEqual({ ok: false, error: 'expired' });
    expect(mocks.verifyWebauthnLogin).not.toHaveBeenCalled();
  });

  it('opens the session with a verified assertion', async () => {
    withChallenge();
    mocks.verifyWebauthnLogin.mockResolvedValueOnce({
      kind: 'session',
      session: sessionResponse(),
    });

    await expect(redirectTarget(finishWebauthnLogin(ASSERTION))).resolves.toBe('/');
    expect(mocks.verifyWebauthnLogin).toHaveBeenCalledExactlyOnceWith(MFA_TOKEN, ASSERTION);
    expect(fakeRequest.setCookie).toHaveBeenCalledWith(
      SESSION_COOKIE,
      SESSION_TOKEN,
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it('keeps the operator here after a refused assertion, counting nothing itself (C25.1)', async () => {
    withChallenge();
    mocks.verifyWebauthnLogin.mockResolvedValueOnce({ kind: 'failed', reason: 'invalid_code' });

    await expect(finishWebauthnLogin(ASSERTION)).resolves.toEqual({
      ok: false,
      error: 'rejected',
    });
    expect(writtenChallenge()).toBeUndefined();
  });

  it.each([
    ['attempts_exhausted', '/login?reason=mfa-attempts'],
    ['token_invalid', '/login?reason=mfa-invalid'],
    ['no_environment_role', '/login?reason=no-environment-role'],
  ] as const)('returns to sign in when the API answers %s (C25.1)', async (reason, target) => {
    withChallenge();
    mocks.verifyWebauthnLogin.mockResolvedValueOnce({ kind: 'failed', reason });

    await expect(redirectTarget(finishWebauthnLogin(ASSERTION))).resolves.toBe(target);
    expectChallengeCleared();
  });

  it('refuses something that is not an assertion without calling the API', async () => {
    withChallenge();

    await expect(finishWebauthnLogin({ id: 'x' })).resolves.toEqual({
      ok: false,
      error: 'invalid_input',
    });
    expect(mocks.verifyWebauthnLogin).not.toHaveBeenCalled();
  });
});

describe('cancelMfaLogin', () => {
  it('drops the challenge and returns to sign in', async () => {
    withChallenge();

    await expect(redirectTarget(cancelMfaLogin())).resolves.toBe('/login');
    expect(fakeRequest.deleteCookie).toHaveBeenCalledWith({
      name: MFA_CHALLENGE_COOKIE,
      path: '/login',
    });
  });
});

describe('logout', () => {
  it('revokes the session, clears the cookie and returns to sign in', async () => {
    fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);

    await expect(redirectTarget(logout())).resolves.toBe('/login');

    expect(mocks.deleteSession).toHaveBeenCalledOnce();
    expect(fakeRequest.deleteCookie).toHaveBeenCalledExactlyOnceWith(SESSION_COOKIE);
  });

  it('still clears the cookie, and says the session could not be ended, when the API cannot revoke it (Workflow 2D F005)', async () => {
    fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
    mocks.deleteSession.mockResolvedValueOnce('incomplete');

    await expect(redirectTarget(logout())).resolves.toBe('/login?reason=signout-incomplete');

    expect(fakeRequest.deleteCookie).toHaveBeenCalledExactlyOnceWith(SESSION_COOKIE);
  });
});

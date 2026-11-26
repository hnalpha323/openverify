// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CREATED_AT, IDS, SESSION_TOKEN, sessionResponse } from '../../testing/api-fixtures';
import { BFF_TOKEN, mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { SESSION_COOKIE } from '../session-cookie';
import { markPeerAddressHeaderTrusted } from './peer-address';
import {
  acceptInvitation,
  completeMfaLogin,
  createSession,
  deleteSession,
  verifyWebauthnLogin,
  webauthnLoginOptions,
} from './sessions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

const MARK = Symbol.for('openverify.dashboard.peer-address-header');
const MFA_TOKEN = `ovm_${'M'.repeat(43)}`;
const CREDENTIALS = { email: 'operator@example.test', password: 'correct horse battery staple' };
const CHALLENGE = {
  'mfa-token': MFA_TOKEN,
  factors: [
    { id: 'mfa_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z', type: 'totp' },
    { id: 'mfa_01J9ZK3M5Q7R8S9T0V1W2X3Y50', type: 'webauthn' },
  ],
};
const ASSERTION = {
  id: 'Y3JlZGVudGlhbA',
  rawId: 'Y3JlZGVudGlhbA',
  type: 'public-key',
  response: { clientDataJSON: 'e30', authenticatorData: 'YXV0aA', signature: 'c2ln' },
  clientExtensionResults: {},
};

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.headers.set('x-openverify-peer-ip', '198.51.100.7');
  // A client-chosen X-Forwarded-For is never forwarded (C21).
  fakeRequest.headers.set('x-forwarded-for', '203.0.113.66');
  markPeerAddressHeaderTrusted();
});

afterEach(() => {
  api.restore();
  Reflect.deleteProperty(globalThis, MARK);
});

describe('createSession', () => {
  it("signs in with the operator's address, never a client-chosen X-Forwarded-For", async () => {
    api.reply(201, sessionResponse());

    await expect(createSession(CREDENTIALS)).resolves.toEqual({
      kind: 'session',
      session: sessionResponse(),
    });

    const request = api.last();
    expect(request).toMatchObject({
      method: 'POST',
      path: '/api/v1/dashboard/sessions',
      body: CREDENTIALS,
    });
    expect(request.headers.get('x-openverify-client-ip')).toBe('198.51.100.7');
    expect(request.headers.get('x-openverify-bff-token')).toBe(BFF_TOKEN);
    expect(request.headers.has('x-forwarded-for')).toBe(false);
    expect(request.headers.has('authorization')).toBe(false);
  });

  it('hands back the MFA challenge when the user has a second factor (202)', async () => {
    api.reply(202, CHALLENGE);

    await expect(createSession(CREDENTIALS)).resolves.toEqual({
      kind: 'mfa',
      challenge: CHALLENGE,
    });
  });

  it.each([
    [401, 'invalid_credentials'],
    [400, 'invalid_credentials'],
    [429, 'rate_limited'],
    [500, 'unavailable'],
    [503, 'unavailable'],
  ] as const)('maps a %i answer to %s', async (status, reason) => {
    api.replyProblem(status);

    await expect(createSession(CREDENTIALS)).resolves.toEqual({ kind: 'failed', reason });
  });

  it('says no_environment_role when the API refuses a user with no role in any environment (C167.2; K9-9)', async () => {
    api.replyProblem(403, 'forbidden', { code: 'no_environment_role' });

    await expect(createSession(CREDENTIALS)).resolves.toEqual({
      kind: 'failed',
      reason: 'no_environment_role',
    });
  });

  it('keeps any other 403 unavailable: only the code says why', async () => {
    api.replyProblem(403, 'forbidden', { code: 'step_up_required' });

    await expect(createSession(CREDENTIALS)).resolves.toEqual({
      kind: 'failed',
      reason: 'unavailable',
    });
  });

  it('is unavailable when the API cannot be reached, or answers off contract', async () => {
    api.fail().reply(201, { ...sessionResponse(), token: 'not-a-token' });

    await expect(createSession(CREDENTIALS)).resolves.toEqual({
      kind: 'failed',
      reason: 'unavailable',
    });
    await expect(createSession(CREDENTIALS)).resolves.toEqual({
      kind: 'failed',
      reason: 'unavailable',
    });
  });
});

describe('completeMfaLogin', () => {
  it('presents the code with the MFA token and returns the session', async () => {
    api.reply(201, sessionResponse());

    await expect(
      completeMfaLogin({ 'mfa-token': MFA_TOKEN, 'totp-code': '123456' }),
    ).resolves.toEqual({ kind: 'session', session: sessionResponse() });
    expect(api.last()).toMatchObject({
      path: '/api/v1/dashboard/sessions/mfa',
      body: { 'mfa-token': MFA_TOKEN, 'totp-code': '123456' },
    });
  });

  it.each([
    ['mfa_code_invalid', 'invalid_code'],
    ['mfa_attempts_exhausted', 'attempts_exhausted'],
    ['mfa_token_invalid', 'token_invalid'],
  ] as const)('maps a 401 with the code %s to %s (C25.1)', async (code, reason) => {
    api.replyProblem(401, undefined, { code });

    await expect(
      completeMfaLogin({ 'mfa-token': MFA_TOKEN, 'totp-code': '000000' }),
    ).resolves.toEqual({ kind: 'failed', reason });
  });

  it.each([
    // A 401 without a known code: the token cannot be relied on, so sign-in starts over.
    [401, 'token_invalid'],
    [400, 'invalid_code'],
    [500, 'unavailable'],
  ] as const)('maps a %i answer without a code to %s', async (status, reason) => {
    api.replyProblem(status);

    await expect(
      completeMfaLogin({ 'mfa-token': MFA_TOKEN, 'recovery-code': '0000-1111-2222' }),
    ).resolves.toEqual({ kind: 'failed', reason });
  });
});

describe('no_environment_role after the second factor (C167.2; K9-9)', () => {
  it('is said once both factors passed, by a code or a key', async () => {
    api
      .replyProblem(403, 'forbidden', { code: 'no_environment_role' })
      .replyProblem(403, 'forbidden', { code: 'no_environment_role' });

    await expect(
      completeMfaLogin({ 'mfa-token': MFA_TOKEN, 'totp-code': '123456' }),
    ).resolves.toEqual({ kind: 'failed', reason: 'no_environment_role' });
    await expect(verifyWebauthnLogin(MFA_TOKEN, ASSERTION)).resolves.toEqual({
      kind: 'failed',
      reason: 'no_environment_role',
    });
  });
});

describe('webauthnLoginOptions', () => {
  it('asks for assertion options for the MFA token', async () => {
    const options = { challenge: 'Y2hhbGxlbmdl', rpId: 'localhost', userVerification: 'preferred' };
    api.reply(200, { options });

    await expect(webauthnLoginOptions(MFA_TOKEN)).resolves.toEqual({ kind: 'options', options });
    expect(api.last()).toMatchObject({
      path: '/api/v1/dashboard/sessions/mfa/webauthn/options',
      body: { 'mfa-token': MFA_TOKEN },
    });
  });

  it.each([
    [401, 'rejected'],
    [409, 'unavailable'],
    [503, 'unavailable'],
  ] as const)('maps a %i answer to %s', async (status, reason) => {
    api.replyProblem(status);

    await expect(webauthnLoginOptions(MFA_TOKEN)).resolves.toEqual({ kind: 'failed', reason });
  });
});

describe('verifyWebauthnLogin', () => {
  it('sends the assertion with the MFA token and returns the session', async () => {
    api.reply(201, sessionResponse());

    await expect(verifyWebauthnLogin(MFA_TOKEN, ASSERTION)).resolves.toEqual({
      kind: 'session',
      session: sessionResponse(),
    });
    expect(api.last()).toMatchObject({
      path: '/api/v1/dashboard/sessions/mfa/webauthn/verify',
      body: { 'mfa-token': MFA_TOKEN, credential: ASSERTION },
    });
  });

  it.each([
    ['mfa_code_invalid', 'invalid_code'],
    ['mfa_attempts_exhausted', 'attempts_exhausted'],
    ['mfa_token_invalid', 'token_invalid'],
  ] as const)('maps a 401 with the code %s to %s (C25.1)', async (code, reason) => {
    api.replyProblem(401, undefined, { code });

    await expect(verifyWebauthnLogin(MFA_TOKEN, ASSERTION)).resolves.toEqual({
      kind: 'failed',
      reason,
    });
  });
});

describe('deleteSession', () => {
  it('revokes the session of the cookie', async () => {
    fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
    api.reply(204);

    await expect(deleteSession()).resolves.toBe('ended');

    expect(api.last()).toMatchObject({
      method: 'DELETE',
      path: '/api/v1/dashboard/sessions/current',
    });
    expect(api.last().headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
  });

  it('never throws, and calls nothing without a session: signing out locally always works', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(deleteSession()).resolves.toBe('ended');
    expect(api.requests).toHaveLength(0);

    fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
    api.fail().fail();
    await expect(deleteSession()).resolves.toBe('incomplete');
    log.mockRestore();
  });

  it("logs a failed sign-out with the error's kind and status only, never the token (KP11-80)", async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
    api.replyProblem(503);

    await expect(deleteSession()).resolves.toBe('incomplete');

    expect(log).toHaveBeenCalledExactlyOnceWith(
      'The dashboard could not end a session in the API',
      {
        error: expect.any(String) as unknown,
        status: 503,
      },
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(SESSION_TOKEN);
    log.mockRestore();
  });

  it('counts a 401 as ended: the session is gone already (Workflow 2D F005)', async () => {
    fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
    api.replyProblem(401);

    await expect(deleteSession()).resolves.toBe('ended');
    expect(api.requests).toHaveLength(1);
  });

  it('tries once more after a connection error or a timeout (Workflow 2D F005)', async () => {
    fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
    api.fail().reply(204);

    await expect(deleteSession()).resolves.toBe('ended');
    expect(api.requests).toHaveLength(2);
  });

  it.each([
    ['a 5xx', (mock: MockApi) => mock.replyProblem(503)],
    ['a 429', (mock: MockApi) => mock.replyProblem(429, 'rate-limited')],
    ['two connection errors', (mock: MockApi) => mock.fail().fail()],
  ])(
    'says the revocation is incomplete after %s, and logs it without the token (Workflow 2D F005)',
    async (_case, answer) => {
      fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
      answer(api);
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await expect(deleteSession()).resolves.toBe('incomplete');

      expect(log).toHaveBeenCalledOnce();
      expect(JSON.stringify(log.mock.calls)).not.toContain(SESSION_TOKEN);
      log.mockRestore();
    },
  );
});

describe('acceptInvitation', () => {
  const body = {
    token: `ovi_${'I'.repeat(43)}`,
    password: 'a long synthetic password',
    name: 'Invited Operator',
  };

  it('accepts the invitation and returns the email to sign in with', async () => {
    api.reply(200, {
      data: {
        type: 'user',
        id: IDS.user,
        attributes: {
          email: 'invitee@example.test',
          name: 'Invited Operator',
          status: 'active',
          'created-at': CREATED_AT,
          'updated-at': CREATED_AT,
        },
      },
    });

    await expect(acceptInvitation(body)).resolves.toEqual({
      kind: 'accepted',
      email: 'invitee@example.test',
    });
    expect(api.last()).toMatchObject({
      method: 'POST',
      path: '/api/v1/dashboard/invitations/accept',
      body,
    });
    expect(api.last().headers.has('authorization')).toBe(false);
  });

  it.each([
    [404, 'invalid_token'],
    [400, 'invalid_input'],
    [500, 'unavailable'],
  ] as const)('maps a %i answer to %s', async (status, reason) => {
    api.replyProblem(status);

    await expect(acceptInvitation(body)).resolves.toEqual({ kind: 'failed', reason });
  });
});

describe('the browser’s User-Agent on the calls that open a session (C168.4)', () => {
  const AGENT = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';

  it('forwards it on sign-in, the second factor and an accepted invitation, so “my sessions” can name the device', async () => {
    fakeRequest.headers.set('user-agent', AGENT);
    api
      .reply(201, sessionResponse())
      .reply(201, sessionResponse())
      .reply(200, {
        data: {
          type: 'user',
          id: IDS.user,
          attributes: {
            email: 'new@example.test',
            'created-at': CREATED_AT,
            'updated-at': CREATED_AT,
          },
        },
      });

    await createSession(CREDENTIALS);
    expect(api.last().headers.get('user-agent')).toBe(AGENT);
    await completeMfaLogin({ 'mfa-token': MFA_TOKEN, 'totp-code': '123456' });
    expect(api.last().headers.get('user-agent')).toBe(AGENT);
    await acceptInvitation({
      token: `ovi_${'I'.repeat(43)}`,
      password: 'correct horse battery staple',
      name: 'New Operator',
    });
    expect(api.last().headers.get('user-agent')).toBe(AGENT);
  });

  it('sends none of its own when the browser sent none, and caps a long one at 1,024 characters', async () => {
    api.reply(201, sessionResponse()).reply(201, sessionResponse());

    await createSession(CREDENTIALS);
    expect(api.last().headers.get('user-agent')).toBeNull();
    fakeRequest.headers.set('user-agent', 'A'.repeat(3000));
    await createSession(CREDENTIALS);
    expect(api.last().headers.get('user-agent')).toHaveLength(1024);
  });
});

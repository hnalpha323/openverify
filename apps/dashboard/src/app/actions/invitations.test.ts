// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MFA_CHALLENGE_COOKIE } from '../../lib/mfa-challenge';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN, sessionResponse } from '../../testing/api-fixtures';
import { fakeRequest } from '../../testing/fake-request';
import { redirectTarget } from '../../testing/next-errors';
import { acceptInvitation } from './invitations';

const mocks = vi.hoisted(() => ({ acceptInvitation: vi.fn(), createSession: vi.fn() }));
vi.mock('../../lib/api/sessions', () => mocks);
vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

const TOKEN = `ovi_${'I'.repeat(43)}`;
const PASSWORD = 'a long synthetic password';

function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  const fields = {
    token: TOKEN,
    name: ' Invited Operator ',
    password: PASSWORD,
    'password-confirmation': PASSWORD,
    ...overrides,
  };
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
}

beforeEach(() => {
  mocks.acceptInvitation.mockReset();
  mocks.createSession.mockReset();
  fakeRequest.reset();
});

describe('acceptInvitation', () => {
  it('accepts the invitation, then signs the new operator in', async () => {
    mocks.acceptInvitation.mockResolvedValueOnce({
      kind: 'accepted',
      email: 'invitee@example.test',
    });
    mocks.createSession.mockResolvedValueOnce({ kind: 'session', session: sessionResponse() });

    await expect(redirectTarget(acceptInvitation(null, form()))).resolves.toBe('/');

    expect(mocks.acceptInvitation).toHaveBeenCalledExactlyOnceWith({
      token: TOKEN,
      password: PASSWORD,
      name: 'Invited Operator',
    });
    expect(mocks.createSession).toHaveBeenCalledExactlyOnceWith({
      email: 'invitee@example.test',
      password: PASSWORD,
    });
    expect(fakeRequest.setCookie).toHaveBeenCalledWith(
      SESSION_COOKIE,
      SESSION_TOKEN,
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it('continues to the second factor when the new operator must pass one', async () => {
    mocks.acceptInvitation.mockResolvedValueOnce({
      kind: 'accepted',
      email: 'invitee@example.test',
    });
    mocks.createSession.mockResolvedValueOnce({
      kind: 'mfa',
      challenge: {
        'mfa-token': `ovm_${'M'.repeat(43)}`,
        factors: [{ id: 'mfa_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z', type: 'totp' }],
      },
    });

    await expect(redirectTarget(acceptInvitation(null, form()))).resolves.toBe('/login/mfa');
    expect(fakeRequest.setCookie.mock.calls.some(([name]) => name === MFA_CHALLENGE_COOKIE)).toBe(
      true,
    );
  });

  it('sends the operator to sign in when the account is ready but signing in failed', async () => {
    mocks.acceptInvitation.mockResolvedValueOnce({
      kind: 'accepted',
      email: 'invitee@example.test',
    });
    mocks.createSession.mockResolvedValueOnce({ kind: 'failed', reason: 'rate_limited' });

    await expect(redirectTarget(acceptInvitation(null, form()))).resolves.toBe(
      '/login?reason=invitation-accepted',
    );
  });

  it('refuses passwords that do not match, without calling the API', async () => {
    await expect(
      acceptInvitation(null, form({ 'password-confirmation': 'something else entirely' })),
    ).resolves.toEqual({
      ok: false,
      problem: {
        title: 'Check the values you entered',
        detail: 'Some values are not valid.',
        errors: [{ pointer: '/password-confirmation', detail: 'The passwords do not match.' }],
      },
    });
    expect(mocks.acceptInvitation).not.toHaveBeenCalled();
  });

  it('refuses a password shorter than 12 characters, without calling the API', async () => {
    const result = await acceptInvitation(
      null,
      form({ password: 'short', 'password-confirmation': 'short' }),
    );

    expect(result).toMatchObject({ ok: false, problem: { errors: [{ pointer: '/password' }] } });
    expect(mocks.acceptInvitation).not.toHaveBeenCalled();
  });

  it.each([
    [
      'invalid_token',
      'This invitation is not valid any more. Ask your administrator for a new one.',
    ],
    ['invalid_input', 'Check the name and password, then try again.'],
    ['unavailable', 'The invitation could not be accepted right now. Try again later.'],
  ] as const)('explains %s', async (reason, detail) => {
    mocks.acceptInvitation.mockResolvedValueOnce({ kind: 'failed', reason });

    await expect(acceptInvitation(null, form())).resolves.toMatchObject({
      ok: false,
      problem: { detail },
    });
  });
});

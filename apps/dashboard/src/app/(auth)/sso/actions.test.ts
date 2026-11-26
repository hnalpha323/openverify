// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { fakeRequest } from '../../../testing/fake-request';
import { stepUpWithSso } from './actions';

const mocks = vi.hoisted(() => ({ startSsoStepUp: vi.fn(), redirect: vi.fn() }));

vi.mock('./sso-bff', async (original) => ({
  ...(await original<typeof import('./sso-bff')>()),
  startSsoStepUp: mocks.startSsoStepUp,
}));
vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    mocks.redirect(url);
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));

const BINDING = `ovsb_${'B'.repeat(43)}`;

beforeEach(() => {
  fakeRequest.reset();
  mocks.startSsoStepUp.mockReset();
  mocks.redirect.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const formOf = (returnTo?: string) => {
  const data = new FormData();
  if (returnTo !== undefined) {
    data.set('return-to', returnTo);
  }
  return data;
};

describe('stepUpWithSso (C248.6)', () => {
  it('starts a re-authentication of this session and goes to the provider with the binding set', async () => {
    fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
    fakeRequest.headers.set('user-agent', 'synthetic browser');
    mocks.startSsoStepUp.mockResolvedValueOnce({
      kind: 'redirect',
      authorizationUrl: 'https://idp.example.com/authorize?prompt=login',
      binding: BINDING,
      expiresAt: '2026-11-13T12:10:00.000Z',
    });
    await expect(stepUpWithSso(formOf('/settings/connect'))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.startSsoStepUp).toHaveBeenCalledExactlyOnceWith(
      SESSION_TOKEN,
      'synthetic browser',
    );
    expect(mocks.redirect).toHaveBeenCalledWith('https://idp.example.com/authorize?prompt=login');
    expect(fakeRequest.setCookie).toHaveBeenCalledWith(
      'openverify-sso',
      BINDING,
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 600 }),
    );
    expect(fakeRequest.setCookie).toHaveBeenCalledWith(
      'openverify_sso_return',
      '/settings/connect',
      expect.objectContaining({ httpOnly: true, path: '/sso/', maxAge: 600 }),
    );
  });

  it('keeps no foreign return path, and returns with a notice when the step-up cannot start', async () => {
    fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
    mocks.startSsoStepUp.mockResolvedValueOnce({ kind: 'failed', failure: 'sso_not_configured' });
    await expect(stepUpWithSso(formOf('https://evil.example.org'))).rejects.toThrow(
      'NEXT_REDIRECT',
    );
    expect(mocks.redirect).toHaveBeenCalledWith('/account/security?reason=sso-not-configured');
    expect(fakeRequest.setCookie).not.toHaveBeenCalled();
  });

  it('sends a signed-out browser to sign in', async () => {
    await expect(stepUpWithSso(formOf())).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledWith('/login');
    expect(mocks.startSsoStepUp).not.toHaveBeenCalled();
  });
});

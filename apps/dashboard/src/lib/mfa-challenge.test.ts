// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeRequest } from '../testing/fake-request';
import {
  MFA_CHALLENGE_COOKIE,
  clearMfaChallenge,
  decodeMfaChallenge,
  encodeMfaChallenge,
  getMfaChallenge,
  setMfaChallenge,
  type MfaChallenge,
} from './mfa-challenge';

vi.mock('next/headers', () => import('../testing/fake-request').then((m) => m.nextHeaders));

const NOW = new Date('2026-10-20T12:00:00.000Z');
const CHALLENGE: MfaChallenge = {
  token: `ovm_${'M'.repeat(43)}`,
  factors: ['totp', 'webauthn'],
  expiresAt: NOW.getTime() + 300_000,
};

beforeEach(() => {
  fakeRequest.reset();
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('the MFA challenge cookie (C22)', () => {
  it('is httpOnly, SameSite=Strict, scoped to /login and lives as long as the mfa-token', async () => {
    await setMfaChallenge(CHALLENGE);

    expect(fakeRequest.setCookie).toHaveBeenCalledExactlyOnceWith(
      MFA_CHALLENGE_COOKIE,
      encodeMfaChallenge(CHALLENGE),
      { httpOnly: true, sameSite: 'strict', secure: false, path: '/login', maxAge: 300 },
    );
    expect(MFA_CHALLENGE_COOKIE).toBe('openverify_mfa');
  });

  it('keeps only the time the token has left when it is written again', async () => {
    vi.setSystemTime(NOW.getTime() + 120_000);

    await setMfaChallenge(CHALLENGE);

    expect(fakeRequest.setCookie.mock.lastCall?.[2]).toMatchObject({ maxAge: 180 });
  });

  it('is Secure in production builds', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    await setMfaChallenge(CHALLENGE);

    expect(fakeRequest.setCookie.mock.lastCall?.[2]).toMatchObject({ secure: true });
  });

  it('holds no attempt count: the API counts wrong attempts and says when they ran out (C25.1)', () => {
    const stored = JSON.parse(
      Buffer.from(encodeMfaChallenge(CHALLENGE), 'base64url').toString('utf8'),
    ) as Record<string, unknown>;

    expect(Object.keys(stored).sort()).toEqual(['e', 'f', 't']);
  });

  it('reads back what was written', async () => {
    fakeRequest.cookies.set(MFA_CHALLENGE_COOKIE, encodeMfaChallenge(CHALLENGE));

    await expect(getMfaChallenge()).resolves.toEqual(CHALLENGE);
  });

  it('is gone once the token expired, or when the cookie is missing', async () => {
    await expect(getMfaChallenge()).resolves.toBeNull();

    fakeRequest.cookies.set(MFA_CHALLENGE_COOKIE, encodeMfaChallenge(CHALLENGE));
    vi.setSystemTime(CHALLENGE.expiresAt);
    await expect(getMfaChallenge()).resolves.toBeNull();
  });

  it('is cleared on its path', async () => {
    await clearMfaChallenge();

    expect(fakeRequest.deleteCookie).toHaveBeenCalledExactlyOnceWith({
      name: MFA_CHALLENGE_COOKIE,
      path: '/login',
    });
  });
});

describe('decodeMfaChallenge', () => {
  it.each([
    ['not base64url JSON', 'garbage!'],
    ['JSON that is not a challenge', Buffer.from('{"t":"x"}').toString('base64url')],
    [
      'a token of another kind',
      encodeMfaChallenge({ ...CHALLENGE, token: `ovu_${'S'.repeat(43)}` }),
    ],
    ['an unknown factor type', encodeMfaChallenge({ ...CHALLENGE, factors: ['sms' as 'totp'] })],
  ])('refuses %s', (_case, value) => {
    expect(decodeMfaChallenge(value)).toBeNull();
  });
});

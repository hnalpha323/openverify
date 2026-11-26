// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXPIRES_AT, SESSION_TOKEN } from '../testing/api-fixtures';
import { fakeRequest } from '../testing/fake-request';
import { clearSessionCookie, getSessionToken, setSessionCookie } from './session';
import { SESSION_COOKIE, sessionCookieName } from './session-cookie';

vi.mock('next/headers', () => import('../testing/fake-request').then((m) => m.nextHeaders));

beforeEach(() => {
  fakeRequest.reset();
});

describe('SESSION_COOKIE', () => {
  it('names the httpOnly cookie that carries the user session token', () => {
    expect(SESSION_COOKIE).toBe('openverify_session');
  });
});

describe('getSessionToken', () => {
  it('reads the session cookie', async () => {
    fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);

    await expect(getSessionToken()).resolves.toBe(SESSION_TOKEN);
  });

  it('is null without a cookie, or with an empty one', async () => {
    await expect(getSessionToken()).resolves.toBeNull();
    fakeRequest.cookies.set(SESSION_COOKIE, '');
    await expect(getSessionToken()).resolves.toBeNull();
  });
});

describe('setSessionCookie', () => {
  it('sets an httpOnly, SameSite=Lax cookie that expires with the session', async () => {
    await setSessionCookie(SESSION_TOKEN, EXPIRES_AT);

    expect(fakeRequest.setCookie).toHaveBeenCalledExactlyOnceWith(SESSION_COOKIE, SESSION_TOKEN, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      expires: new Date(EXPIRES_AT),
    });
  });

  describe('Secure flag (F008: decided by the deployment, never by a request header)', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('is always set in a production build, even without X-Forwarded-Proto', async () => {
      vi.stubEnv('NODE_ENV', 'production');

      await setSessionCookie(SESSION_TOKEN, EXPIRES_AT);

      expect(fakeRequest.setCookie.mock.lastCall?.[2]).toMatchObject({ secure: true });
    });

    it('ignores a client-controlled X-Forwarded-Proto: http', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      fakeRequest.headers.set('x-forwarded-proto', 'http');

      await setSessionCookie(SESSION_TOKEN, EXPIRES_AT);

      expect(fakeRequest.setCookie.mock.lastCall?.[2]).toMatchObject({ secure: true });
    });

    it('is not set by a development server, whatever X-Forwarded-Proto says', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      fakeRequest.headers.set('x-forwarded-proto', 'https');

      await setSessionCookie(SESSION_TOKEN, EXPIRES_AT);

      expect(fakeRequest.setCookie.mock.lastCall?.[2]).toMatchObject({ secure: false });
    });

    it('is left off in production only on the explicit plain-http opt-out', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('OPENVERIFY_DASHBOARD_INSECURE_COOKIES', 'true');

      await setSessionCookie(SESSION_TOKEN, EXPIRES_AT);

      expect(fakeRequest.setCookie.mock.lastCall?.[2]).toMatchObject({ secure: false });
    });
  });
});

describe('clearSessionCookie', () => {
  it('deletes the session cookie', async () => {
    await clearSessionCookie();

    expect(fakeRequest.deleteCookie).toHaveBeenCalledExactlyOnceWith(SESSION_COOKIE);
  });
});

describe("the session cookie's prefix (KP11-78; ASVS v5.0.0-3.3.1, 3.3.3)", () => {
  const PREFIXED = '__Host-openverify_session';

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    [{ NODE_ENV: 'production' }, PREFIXED],
    [{ NODE_ENV: 'production', OPENVERIFY_DASHBOARD_INSECURE_COOKIES: 'false' }, PREFIXED],
    [{ NODE_ENV: 'production', OPENVERIFY_DASHBOARD_INSECURE_COOKIES: 'true' }, SESSION_COOKIE],
    [{ NODE_ENV: 'development' }, SESSION_COOKIE],
    [{ NODE_ENV: 'test' }, SESSION_COOKIE],
  ])('is named __Host- exactly when it is Secure (%o)', (env, name) => {
    expect(sessionCookieName(env)).toBe(name);
  });

  it('a production build sets __Host-openverify_session: Secure, path /, no Domain', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    await setSessionCookie(SESSION_TOKEN, EXPIRES_AT);

    expect(fakeRequest.setCookie).toHaveBeenCalledExactlyOnceWith(PREFIXED, SESSION_TOKEN, {
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
      expires: new Date(EXPIRES_AT),
    });
  });

  it('a production build reads only the prefixed cookie: an unprefixed one is no session', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);

    await expect(getSessionToken()).resolves.toBeNull();

    fakeRequest.cookies.set(PREFIXED, SESSION_TOKEN);
    await expect(getSessionToken()).resolves.toBe(SESSION_TOKEN);
  });

  it('a production build clears the prefixed cookie', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    await clearSessionCookie();

    expect(fakeRequest.deleteCookie).toHaveBeenCalledExactlyOnceWith(PREFIXED);
  });
});

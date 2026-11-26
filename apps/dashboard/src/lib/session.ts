import 'server-only';
import { cookies } from 'next/headers';
import { secureCookies, sessionCookieName } from './session-cookie';

/** The user session token from the httpOnly cookie, or `null`. */
export async function getSessionToken(): Promise<string | null> {
  const value = (await cookies()).get(sessionCookieName())?.value ?? '';
  return value === '' ? null : value;
}

/**
 * Stores the token in an httpOnly, SameSite=Lax cookie that expires with the session. It is
 * Secure in every production build (`secureCookies`), whatever the request headers say, and is
 * then named `__Host-openverify_session` (KP11-78, `sessionCookieName`). Only server actions may
 * call it.
 */
export async function setSessionCookie(token: string, expiresAt: string): Promise<void> {
  (await cookies()).set(sessionCookieName(), token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookies(),
    path: '/',
    expires: new Date(expiresAt),
  });
}

/**
 * Where signing out leads when the API could not end the session: the cookie is gone, but the
 * token works until it expires, and the sign-in page says so (Workflow 2D F005).
 */
export const SIGN_OUT_INCOMPLETE_PATH = '/login?reason=signout-incomplete';

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(sessionCookieName());
}

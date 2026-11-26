/**
 * The httpOnly cookie that carries the dashboard user session token (`ovu_...`). Client
 * JavaScript never sees the token: server actions set and clear the cookie, and server
 * components and route handlers read it to call the API.
 *
 * Kept free of server-only imports, because the proxy (`src/proxy.ts`) reads it too.
 */

/** The cookie's name where it cannot be `Secure`: `next dev`, or the plain-http opt-out below. */
export const SESSION_COOKIE = 'openverify_session';

/**
 * KP11-78 (ASVS v5.0.0-3.3.1, 3.3.3): the name of a `Secure` session cookie. A browser keeps a
 * `__Host-` cookie only when it is `Secure`, has `Path=/` and no `Domain`, so neither a sibling
 * host nor a plain-http page can plant or shadow it.
 */
export const SECURE_SESSION_COOKIE = `__Host-${SESSION_COOKIE}`;

/**
 * Server-only opt-out: `true` lets a production build set its session cookie without
 * `Secure`, for a deployment that is reached over plain http on purpose (never in front of
 * real operators).
 */
export const INSECURE_COOKIES_ENV = 'OPENVERIFY_DASHBOARD_INSECURE_COOKIES';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Whether the session cookie is `Secure`. The deployment decides, never a request header
 * (`X-Forwarded-Proto` can be missing behind a TLS proxy, or sent by the client): always in a
 * production build (`server.ts`) unless `OPENVERIFY_DASHBOARD_INSECURE_COOKIES=true`, and
 * never under `next dev`. Browsers keep `Secure` cookies on `http://localhost` and
 * `http://127.0.0.1`, so a local production build still works without the opt-out.
 */
export function secureCookies(env: Env = process.env): boolean {
  return env.NODE_ENV === 'production' && env[INSECURE_COOKIES_ENV] !== 'true';
}

/**
 * The session cookie's name, decided as its `Secure` flag is: `__Host-openverify_session` when it
 * is `Secure`, else `openverify_session`. Each reader reads that one name only, so a production
 * console never accepts an unprefixed cookie.
 */
export function sessionCookieName(env: Env = process.env): string {
  return secureCookies(env) ? SECURE_SESSION_COOKIE : SESSION_COOKIE;
}

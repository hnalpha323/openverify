import 'server-only';

/** Server-only setting: the API the BFF calls. It never reaches client bundles (no `NEXT_PUBLIC_`). */
export const API_URL_ENV = 'OPENVERIFY_API_URL';

const INVALID = `${API_URL_ENV} must be an http(s) URL without credentials, query or fragment`;

/**
 * The OpenVerify API base URL, without a trailing slash, read when a request needs it (not
 * at build time).
 * @throws {Error} when it is missing or not a plain http(s) URL.
 */
export function apiBaseUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const value = env[API_URL_ENV]?.trim() ?? '';
  if (value === '') {
    throw new Error(
      `${API_URL_ENV} is not set: point it at the OpenVerify API, e.g. http://localhost:3000`,
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(INVALID);
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error(INVALID);
  }
  return value.replace(/\/+$/, '');
}

/**
 * The session cookie's `Secure` decision and its opt-out live beside the cookie's name
 * (`session-cookie.ts`), which the proxy reads too; they are re-exported here for the server.
 */
export { INSECURE_COOKIES_ENV, secureCookies } from './session-cookie';

/**
 * Server-only secret the BFF sends as `x-openverify-bff-token` (C15, C21). The API believes the
 * operator's address in `x-openverify-client-ip` only when this equals its own
 * `OPENVERIFY_DASHBOARD_BFF_TOKEN`; without it the API uses the BFF's own address.
 */
export const BFF_TOKEN_ENV = 'OPENVERIFY_DASHBOARD_BFF_TOKEN';

/** The BFF token, or `null` when none is configured (no token is sent). */
export function bffToken(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const value = env[BFF_TOKEN_ENV]?.trim() ?? '';
  return value === '' ? null : value;
}

/**
 * How many reverse proxies in front of the dashboard append to `X-Forwarded-For` (C21). 0, the
 * default, means none: the client is the socket peer, which `server.ts` records, and a
 * client-sent `X-Forwarded-For` is never believed.
 */
export const TRUSTED_PROXY_HOPS_ENV = 'OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS';
const MAX_TRUSTED_PROXY_HOPS = 32;

/**
 * The trusted proxy hop count.
 * @throws {Error} when it is set to anything but a whole number from 0 to 32.
 */
export function trustedProxyHops(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const value = env[TRUSTED_PROXY_HOPS_ENV]?.trim() ?? '';
  if (value === '') {
    return 0;
  }
  const hops = /^\d{1,2}$/.test(value) ? Number(value) : Number.NaN;
  if (!(hops >= 0 && hops <= MAX_TRUSTED_PROXY_HOPS)) {
    throw new Error(
      `${TRUSTED_PROXY_HOPS_ENV} must be a whole number from 0 to ${String(MAX_TRUSTED_PROXY_HOPS)}`,
    );
  }
  return hops;
}

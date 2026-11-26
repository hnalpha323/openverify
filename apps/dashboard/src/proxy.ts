import { NextResponse, type NextRequest } from 'next/server';
import {
  CSP_NONCE_HEADER,
  CSP_REPORT_PATH,
  REPORTING_ENDPOINTS,
  consoleCsp,
  createNonce,
  cspHeaderName,
  cspMode,
  flowPublicOrigin,
} from './lib/csp/policy';
import { sessionCookieName } from './lib/session-cookie';

/**
 * The pages of signing in (C22), reachable without a session, and the CSP report endpoint
 * (C170.2), which browsers often call without the session cookie.
 */
const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  '/login',
  '/login/mfa',
  '/accept-invitation',
  CSP_REPORT_PATH,
]);

/**
 * C248.4 (Workflow 11B `sso-oidc`, a named borrowed edit): single sign-on's route handlers
 * (`/sso/start`, `/sso/<sign-in name>/start`, `/sso/callback/<provider>`) are part of signing in, so
 * the one prefix joins the exact set above; each handler checks what it is given itself.
 */
const PUBLIC_PREFIXES: readonly string[] = ['/sso/'];

const isPublic = (path: string) =>
  PUBLIC_PATHS.has(path) || PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));

/** Both policy headers, so a client-sent one never reaches the render. */
const POLICY_HEADERS = ['content-security-policy', 'content-security-policy-report-only'];

/**
 * Next.js 16 request interception (the `proxy` convention that replaced `middleware`).
 *
 * - The console's script CSP (C170.1): a fresh 128-bit nonce per request, the policy sent on the
 *   response (enforced, or report-only under `OPENVERIFY_DASHBOARD_CSP_MODE`), and the nonce and
 *   policy handed to the render in the request headers, from which Next.js puts the nonce on its
 *   scripts. Every page renders per request (the root layout awaits `connection()`), so no
 *   prerendered page carries a stale nonce.
 * - An optimistic session check only: a visitor without a session cookie is sent to sign in.
 *   Whether the session is still valid is decided by the API on every call, so pages, actions and
 *   route handlers verify it themselves (`withSession`, `getSessionToken`).
 */
export function proxy(request: NextRequest): NextResponse {
  const mode = cspMode();
  const nonce = createNonce();
  const policy = consoleCsp({
    nonce,
    flowOrigin: flowPublicOrigin(),
    development: process.env.NODE_ENV === 'development',
  });
  const header = cspHeaderName(mode);

  const token = request.cookies.get(sessionCookieName())?.value ?? '';
  let response: NextResponse;
  if (isPublic(request.nextUrl.pathname) || token !== '') {
    const headers = new Headers(request.headers);
    for (const name of POLICY_HEADERS) {
      headers.delete(name);
    }
    headers.set(CSP_NONCE_HEADER, nonce);
    headers.set(header, policy);
    response = NextResponse.next({ request: { headers } });
  } else {
    response = NextResponse.redirect(new URL('/login', request.url));
  }
  response.headers.set(header, policy);
  response.headers.set('Reporting-Endpoints', REPORTING_ENDPOINTS);
  return response;
}

export const config = {
  // Everything except build assets. The sign-in pages are matched but always let through.
  // C142.7, F32: the case attachment upload (`app/cases/[id]/attachments/route.ts`) streams up to
  // 10 MiB and checks the session itself, so it never passes through the proxy's buffer.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|cases/[^/]+/attachments/?$).*)'],
};

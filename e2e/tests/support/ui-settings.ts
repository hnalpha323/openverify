/**
 * Helpers of `dashboard-settings`' full-stack specs (Workflow 9C): the console's real script CSP
 * (C170; `ui-csp.spec.ts`) and the settings pages (`ui-settings.spec.ts`).
 *
 * The expected policy is written here again, from C170.1's text, rather than imported from the
 * console: the spec is then an independent check of what the console sends.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page, type Response } from '@playwright/test';
import { E2E_DASHBOARD_DIST_DIR } from '../../src/env.js';
import { REPO_ROOT } from '../../src/paths.js';

/** C170.1's policy for one nonce, as a production build sends it. */
export function expectedConsoleCsp(nonce: string, flowOrigin: string): string {
  return (
    `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'; ` +
    `style-src 'self' 'nonce-${nonce}'; img-src 'self' blob: data:; font-src 'self'; ` +
    `connect-src 'self'; frame-src ${flowOrigin}; worker-src 'none'; object-src 'none'; ` +
    `base-uri 'self'; form-action 'self'; frame-ancestors 'none'; report-uri /csp-reports; ` +
    'report-to csp'
  );
}

/** The nonce of a policy's script-src, or `null`. */
export function nonceOf(policy: string): string | null {
  return /script-src 'self' 'nonce-([A-Za-z0-9+/]+={0,2})'/u.exec(policy)?.[1] ?? null;
}

/**
 * The console's script policy on a document response, checked byte for byte against C170.1 with
 * the nonce it carries (16 bytes), as the one policy header, and `Reporting-Endpoints`. Answers the
 * nonce.
 */
export async function expectConsoleCspHeader(
  response: Response | null,
  flowOrigin: string,
): Promise<string> {
  expect(response, 'a document response').not.toBeNull();
  if (response === null) {
    return '';
  }
  const headers = await response.headersArray();
  const policies = headers
    .filter(({ name }) => name.toLowerCase() === 'content-security-policy')
    .map(({ value }) => value);
  const scriptPolicy = policies.find((value) => value.includes('script-src')) ?? '';
  const nonce = nonceOf(scriptPolicy) ?? '';
  expect(Buffer.from(nonce, 'base64')).toHaveLength(16);
  expect(scriptPolicy).toBe(expectedConsoleCsp(nonce, flowOrigin));
  // The proxy's policy replaces next.config.ts' static `frame-ancestors 'none'` header on the routes
  // it runs on, and carries `frame-ancestors 'none'` itself (C170.4); one policy header is sent.
  expect(policies).toEqual([scriptPolicy]);
  expect(response.headers()['reporting-endpoints']).toBe('csp="/csp-reports"');
  expect(response.headers()['content-security-policy-report-only']).toBeUndefined();
  return nonce;
}

/**
 * Records every CSP violation `page` meets from now on: the document's `securitypolicyviolation`
 * events (registered before any script runs, on every document the page opens) and the console's
 * refusals. Answers a reader of what was recorded.
 */
export async function recordPolicyViolations(page: Page): Promise<() => Promise<string[]>> {
  const refusals: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to/iu.test(message.text())) {
      refusals.push(`console: ${message.text()}`);
    }
  });
  await page.exposeBinding('__openverifyCspViolation', (_source, line: string) => {
    refusals.push(line);
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      const report = (window as unknown as { __openverifyCspViolation: (line: string) => void })
        .__openverifyCspViolation;
      report(`${event.effectiveDirective} ${event.blockedURI} on ${location.pathname}`);
    });
  });
  return () => Promise.resolve([...refusals]);
}

/**
 * Every `<script>` of the document the server sent carries the response's nonce. Scripts that
 * Next.js's runtime adds afterwards need none: `'strict-dynamic'` trusts what a trusted script loads.
 */
export async function expectScriptsCarryNonce(
  response: Response | null,
  nonce: string,
): Promise<void> {
  const html = (await response?.text()) ?? '';
  const scripts = html.match(/<script\b[^>]*>/gu) ?? [];
  expect(scripts.length).toBeGreaterThan(0);
  expect(scripts.filter((tag) => !tag.includes(` nonce="${nonce}"`))).toEqual([]);
}

const DIST = path.join(REPO_ROOT, 'apps', 'dashboard', E2E_DASHBOARD_DIST_DIR);

/**
 * The console's pages from the e2e build's route manifest: every `page` route without a dynamic
 * segment (route handlers and `[id]` pages left out), sorted. Derived, never listed by hand, so a
 * page added later is checked without editing the spec.
 */
export function staticConsolePages(): string[] {
  const manifest = JSON.parse(
    readFileSync(path.join(DIST, 'app-path-routes-manifest.json'), 'utf8'),
  ) as Record<string, string>;
  return Object.entries(manifest)
    .filter(([entry, route]) => entry.endsWith('/page') && !route.includes('['))
    .map(([, route]) => route)
    .filter((route) => !route.startsWith('/_'))
    .sort();
}

/**
 * Next.js's own fallback for a root layout that fails: it renders without the root layout, reads no
 * request data and is prerendered by the framework, so it is the one static route (Workflow 9C
 * Stage 1 amendment, dashboard-settings).
 */
export const FRAMEWORK_STATIC_ROUTES: readonly string[] = ['/_global-error'];

/**
 * The routes the e2e build prerendered as static, the framework's fallback left out (C170.1, F20:
 * there must be none).
 */
export function prerenderedRoutes(): string[] {
  const manifest = JSON.parse(readFileSync(path.join(DIST, 'prerender-manifest.json'), 'utf8')) as {
    routes?: Record<string, unknown>;
  };
  return Object.keys(manifest.routes ?? {})
    .filter((route) => !FRAMEWORK_STATIC_ROUTES.includes(route))
    .sort();
}

/**
 * The dashboard's session cookie (`apps/dashboard/src/lib/session-cookie.ts`): the e2e stack serves
 * a production build, whose session cookie is Secure and so named with the `__Host-` prefix (KP11-78).
 */
const SESSION_COOKIE = '__Host-openverify_session';

/**
 * Opens the console as the operator whose `ovu_` token is given (made by `operatorWithRole`,
 * which signs in through the API once), without another sign-in.
 */
export async function useSessionToken(page: Page, dashboardUrl: string, token: string) {
  await page.context().addCookies([
    {
      name: SESSION_COOKIE,
      value: token,
      // Secure, so by host and path: Chromium refuses a Secure cookie given with an http URL.
      domain: new URL(dashboardUrl).hostname,
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
}

/**
 * The page's HTML as the server sent it, React's server payload included (C21's RSC payload rule):
 * what a principal's browser receives, whatever the page shows.
 */
export async function serverHtml(page: Page, url: string): Promise<string> {
  const response = await page.request.get(url);
  expect(response.status(), url).toBe(200);
  return response.text();
}

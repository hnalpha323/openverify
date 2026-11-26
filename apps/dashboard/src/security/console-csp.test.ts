// @vitest-environment node
/**
 * C255.2 (Workflow 11B, integration-11b): every console route answers with the ENFORCED script CSP,
 * and its script source never holds `'unsafe-inline'` or `'unsafe-eval'`. The proof is in two parts:
 * this test walks every page and route handler under `src/app` (the console's route manifest as files
 * on disk), checks that the proxy's matcher reaches it, and that the proxy answers it with
 * `Content-Security-Policy` (not report-only) whose `script-src` is the request's nonce with
 * `'strict-dynamic'`; `e2e/tests/ui-csp.spec.ts` (the console sweep) reads the real header on every
 * page the seeded stack reaches. The one path the matcher leaves out, the case attachment upload,
 * is a JSON route handler that renders no document (C142.7).
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CSP_MODE_ENV, CSP_NONCE_HEADER } from '../lib/csp/policy';
import { sessionCookieName } from '../lib/session-cookie';
import { config, proxy } from '../proxy';

const APP = fileURLToPath(new URL('../app', import.meta.url));
const ORIGIN = 'http://dashboard.test';
const SESSION = `ovu_${'S'.repeat(43)}`;
/** The upload the matcher leaves out on purpose (it streams 10 MiB and checks the session itself). */
const UNMATCHED = new Set(['/cases/x/attachments']);

/** Every page and route handler file under `src/app`, as the URL path it serves. */
function consoleRoutes(directory = APP): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      routes.push(...consoleRoutes(path));
    } else if (/^(page|route)\.tsx?$/.test(entry)) {
      const segments = relative(APP, directory)
        .split(sep)
        .filter((segment) => segment !== '' && !/^\(.*\)$/.test(segment))
        .map((segment) => (/^\[.*\]$/.test(segment) ? 'x' : segment));
      routes.push(`/${segments.join('/')}`);
    }
  }
  return [...new Set(routes)].sort();
}

const directives = (policy: string) =>
  new Map(
    policy.split(';').map((part) => {
      const [name = '', ...values] = part.trim().split(/\s+/);
      return [name, values] as const;
    }),
  );

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the console CSP on every route (C255.2)', () => {
  const routes = consoleRoutes();

  it('finds the console routes on disk', () => {
    expect(routes.length).toBeGreaterThan(100);
    expect(routes).toContain('/login');
    expect(routes).toContain('/settings');
  });

  it('reaches every route through the proxy, except the attachment upload', () => {
    const unmatched = routes.filter(
      (path) => !unstable_doesMiddlewareMatch({ config, url: `${ORIGIN}${path}` }),
    );
    expect(unmatched).toEqual([...UNMATCHED]);
  });

  it.each(routes.filter((path) => !UNMATCHED.has(path)))(
    '%s answers the enforced policy, its script source the nonce with strict-dynamic only',
    (path) => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv(CSP_MODE_ENV, '');
      const response = proxy(
        new NextRequest(`${ORIGIN}${path}`, {
          headers: { cookie: `${sessionCookieName()}=${SESSION}` },
        }),
      );

      expect(response.headers.get('content-security-policy-report-only')).toBeNull();
      const policy = response.headers.get('content-security-policy') ?? '';
      const nonce = response.headers.get(`x-middleware-request-${CSP_NONCE_HEADER}`) ?? '';
      expect(nonce).not.toBe('');
      const script = directives(policy).get('script-src') ?? [];
      expect(script).toContain(`'nonce-${nonce}'`);
      expect(script).toContain("'strict-dynamic'");
      expect(script).not.toContain("'unsafe-inline'");
      expect(script).not.toContain("'unsafe-eval'");
      expect(script).not.toContain("'unsafe-hashes'");
    },
  );

  /**
   * dast-11f's rule 10055 (ZAP's "CSP: Notices", Low): ZAP notes `report-uri` because CSP Level 3
   * deprecates it. The policy names both: `report-to` with the `Reporting-Endpoints` header for the
   * browsers that read it, and `report-uri`, which a browser with `report-to` ignores and Firefox
   * still needs. This holds both on every console path and on the paths ZAP flagged.
   */
  it.each([...routes.filter((path) => !UNMATCHED.has(path)), '/robots.txt', '/sitemap.xml'])(
    '%s names report-to with its Reporting-Endpoints group beside report-uri',
    (path) => {
      vi.stubEnv('NODE_ENV', 'production');
      const response = proxy(new NextRequest(`${ORIGIN}${path}`));

      const policy = directives(response.headers.get('content-security-policy') ?? '');
      expect(policy.get('report-to')).toEqual(['csp']);
      expect(policy.get('report-uri')).toEqual(['/csp-reports']);
      expect(response.headers.get('reporting-endpoints')).toBe('csp="/csp-reports"');
    },
  );
});

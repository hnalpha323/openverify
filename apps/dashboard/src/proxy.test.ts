// @vitest-environment node
import { getRedirectUrl, unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CSP_MODE_ENV, FLOW_PUBLIC_URL_ENV, consoleCsp } from './lib/csp/policy';
import { SESSION_COOKIE, sessionCookieName } from './lib/session-cookie';
import { config, proxy } from './proxy';

const ORIGIN = 'http://dashboard.test';

function request(path: string, cookie?: string, headers: Record<string, string> = {}) {
  return new NextRequest(`${ORIGIN}${path}`, {
    headers:
      cookie === undefined ? headers : { ...headers, cookie: `${sessionCookieName()}=${cookie}` },
  });
}

const SESSION = `ovu_${'S'.repeat(43)}`;

/** A request header the proxy hands to the render, as `NextResponse.next({ request })` encodes it. */
function forwarded(response: Response, name: string): string | null {
  return response.headers.get(`x-middleware-request-${name}`);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('proxy', () => {
  it.each(['/', '/inquiries', `/inquiries/inq_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z`, '/files/x/content'])(
    'sends a visitor without a session cookie from %s to sign in',
    (path) => {
      const response = proxy(request(path));

      expect(response.status).toBe(307);
      expect(getRedirectUrl(response)).toBe(`${ORIGIN}/login`);
    },
  );

  it('lets a request with a session cookie through; pages verify the session with the API', () => {
    const response = proxy(request('/inquiries', `ovu_${'S'.repeat(43)}`));

    expect(getRedirectUrl(response)).toBeNull();
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('always lets the sign-in page through, so a stale cookie cannot lock anyone out', () => {
    expect(getRedirectUrl(proxy(request('/login')))).toBeNull();
    expect(getRedirectUrl(proxy(request('/login', 'stale')))).toBeNull();
  });

  it.each(['/login/mfa', '/accept-invitation'])(
    'lets %s through without a session: it is part of signing in (C22)',
    (path) => {
      expect(getRedirectUrl(proxy(request(path)))).toBeNull();
    },
  );

  it.each(['/login/other', '/accept-invitation/x', '/loginx'])(
    'still guards %s, which only looks like a sign-in page',
    (path) => {
      expect(getRedirectUrl(proxy(request(path)))).toBe(`${ORIGIN}/login`);
    },
  );

  it('treats an empty cookie as no session', () => {
    expect(getRedirectUrl(proxy(request('/inquiries', '')))).toBe(`${ORIGIN}/login`);
  });

  it.each([
    ['/inquiries', true],
    ['/files/file_01J9ZK3M5Q7R8S9T0V1W2X3Y43/content', true],
    ['/login', true],
    ['/_next/static/chunks/main.js', false],
    ['/_next/image', false],
    ['/favicon.ico', false],
  ])('runs on %s: %s', (url, expected) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(expected);
  });

  // C142.7, F32: the case attachment upload is a streaming route handler that checks the session
  // itself, so a 10 MiB body never passes the proxy's buffer.
  it.each([
    ['/cases/case_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z/attachments', false],
    ['/cases/case_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z/attachments/', false],
    ['/cases/case_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z', true],
    ['/cases/case_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z/attachments/catt_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z', true],
    ['/cases', true],
    ['/cases/attachments', true],
    ['/case-templates/x/attachments', true],
    ['/x/cases/case_1/attachments', true],
  ])('leaves the case attachment upload alone, and runs on the rest: %s %s', (url, expected) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(expected);
  });
});

describe("proxy: the session cookie's prefix (KP11-78)", () => {
  it('in a production build, lets only the __Host- cookie through: an unprefixed one signs in again', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const unprefixed = proxy(
      new NextRequest(`${ORIGIN}/inquiries`, {
        headers: { cookie: `${SESSION_COOKIE}=${SESSION}` },
      }),
    );
    expect(getRedirectUrl(unprefixed)).toBe(`${ORIGIN}/login`);

    const prefixed = proxy(
      new NextRequest(`${ORIGIN}/inquiries`, {
        headers: { cookie: `__Host-openverify_session=${SESSION}` },
      }),
    );
    expect(getRedirectUrl(prefixed)).toBeNull();
  });
});

describe('proxy: the console script CSP (C170)', () => {
  it('sends the plan policy with a fresh nonce, and hands the same nonce and policy to the render', () => {
    vi.stubEnv(FLOW_PUBLIC_URL_ENV, 'http://127.0.0.1:5173');
    vi.stubEnv('NODE_ENV', 'production');

    const response = proxy(request('/inquiries', SESSION));

    const nonce = forwarded(response, 'x-nonce') ?? '';
    expect(Buffer.from(nonce, 'base64')).toHaveLength(16);
    const policy = consoleCsp({ nonce, flowOrigin: 'http://127.0.0.1:5173', development: false });
    expect(response.headers.get('content-security-policy')).toBe(policy);
    expect(forwarded(response, 'content-security-policy')).toBe(policy);
    expect(response.headers.get('content-security-policy-report-only')).toBeNull();
    expect(response.headers.get('reporting-endpoints')).toBe('csp="/csp-reports"');
  });

  it('makes a new nonce for every request', () => {
    const nonces = new Set(
      Array.from({ length: 20 }, () => forwarded(proxy(request('/inquiries', SESSION)), 'x-nonce')),
    );

    expect(nonces.size).toBe(20);
  });

  it("adds 'unsafe-eval' under next dev only", () => {
    vi.stubEnv('NODE_ENV', 'development');

    expect(proxy(request('/inquiries', SESSION)).headers.get('content-security-policy')).toContain(
      "'strict-dynamic' 'unsafe-eval';",
    );
  });

  it('frames nothing when OPENVERIFY_FLOW_PUBLIC_URL is unset', () => {
    vi.stubEnv(FLOW_PUBLIC_URL_ENV, '');

    expect(proxy(request('/inquiries', SESSION)).headers.get('content-security-policy')).toContain(
      "frame-src 'none';",
    );
  });

  it('sends the policy on the redirect to sign in as well', () => {
    const response = proxy(request('/users'));

    expect(response.status).toBe(307);
    expect(response.headers.get('content-security-policy')).toContain("script-src 'self' 'nonce-");
  });

  it('replaces a nonce or policy the client sent with its own', () => {
    const response = proxy(
      request('/inquiries', SESSION, {
        'x-nonce': 'Y2xpZW50LWNob3Nlbg==',
        'content-security-policy': "script-src 'nonce-Y2xpZW50LWNob3Nlbg=='",
        'content-security-policy-report-only': "script-src 'nonce-Y2xpZW50LWNob3Nlbg=='",
      }),
    );

    expect(forwarded(response, 'x-nonce')).not.toBe('Y2xpZW50LWNob3Nlbg==');
    expect(forwarded(response, 'content-security-policy')).not.toContain('Y2xpZW50LWNob3Nlbg==');
    expect(response.headers.get('x-middleware-override-headers') ?? '').not.toContain(
      'content-security-policy-report-only',
    );
  });

  it('only reports in report-only mode: the same policy under the report-only header, to the render too', () => {
    vi.stubEnv(CSP_MODE_ENV, 'report-only');

    const response = proxy(request('/inquiries', SESSION));

    const nonce = forwarded(response, 'x-nonce') ?? '';
    expect(response.headers.get('content-security-policy')).toBeNull();
    expect(response.headers.get('content-security-policy-report-only')).toContain(
      `'nonce-${nonce}'`,
    );
    expect(forwarded(response, 'content-security-policy-report-only')).toContain(
      `'nonce-${nonce}'`,
    );
    expect(forwarded(response, 'content-security-policy')).toBeNull();
  });

  it('takes violation reports without a session: browsers often send them without the cookie', () => {
    const response = proxy(request('/csp-reports'));

    expect(getRedirectUrl(response)).toBeNull();
    expect(unstable_doesMiddlewareMatch({ config, url: '/csp-reports' })).toBe(true);
    expect(getRedirectUrl(proxy(request('/csp-reports/x')))).toBe(`${ORIGIN}/login`);
  });
});

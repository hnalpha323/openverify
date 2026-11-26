// @vitest-environment node
import { SSO_BINDING_COOKIE, SSO_BINDING_COOKIE_INSECURE } from '@openverify/contracts';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionResponse } from '../../../testing/api-fixtures';
import { MFA_CHALLENGE_COOKIE, decodeMfaChallenge } from '../../../lib/mfa-challenge';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { GET as callback } from './callback/[provider]/route';
import { GET as start } from './[slug]/start/route';
import { SSO_RETURN_COOKIE } from './sso-bff';

const mocks = vi.hoisted(() => ({ startSso: vi.fn(), finishSso: vi.fn() }));

vi.mock('./sso-bff', async (original) => ({
  ...(await original<typeof import('./sso-bff')>()),
  startSso: mocks.startSso,
  finishSso: mocks.finishSso,
}));

const ORIGIN = 'http://dashboard.test';
const PROVIDER = 'ssop_01JC0000000000000000000001';
const BINDING = `ovsb_${'B'.repeat(43)}`;
const AGENT = 'Mozilla/5.0 (synthetic test browser)';

beforeEach(() => {
  mocks.startSso.mockReset();
  mocks.finishSso.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

function get(path: string, cookies: Record<string, string> = {}) {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
  return new NextRequest(`${ORIGIN}${path}`, {
    headers: { 'user-agent': AGENT, ...(cookie === '' ? {} : { cookie }) },
  });
}

const startAt = (slug: string, query = '') =>
  start(get(`/sso/${slug}/start${query}`), { params: Promise.resolve({ slug }) });

const callbackOf = (provider: string, query: string, cookies: Record<string, string> = {}) =>
  callback(get(`/sso/callback/${provider}${query}`, cookies), {
    params: Promise.resolve({ provider }),
  });

/** The `Set-Cookie` attributes the response sets for `name`. */
function setCookie(response: Response, name: string): string | undefined {
  return response.headers.getSetCookie().find((line) => line.startsWith(`${name}=`));
}

describe('GET /sso/:slug/start (C248.4)', () => {
  it('sets the binding as a host-only Lax cookie and sends the browser to the provider', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mocks.startSso.mockResolvedValueOnce({
      kind: 'redirect',
      authorizationUrl: 'https://idp.example.com/authorize?client_id=synthetic',
      binding: BINDING,
      expiresAt: '2026-11-13T12:10:00.000Z',
    });
    const response = await startAt('acme-sso', `?provider-id=${PROVIDER}&return-to=%2Finquiries`);
    expect(mocks.startSso).toHaveBeenCalledExactlyOnceWith(
      'acme-sso',
      { providerId: PROVIDER, returnTo: '/inquiries' },
      AGENT,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      'https://idp.example.com/authorize?client_id=synthetic',
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    const binding = setCookie(response, '__Host-openverify-sso') ?? '';
    expect(binding).toContain(`__Host-openverify-sso=${BINDING}`);
    expect(binding).toMatch(/Path=\/(;|$)/);
    expect(binding).toMatch(/HttpOnly/i);
    expect(binding).toMatch(/Secure/i);
    expect(binding).toMatch(/SameSite=lax/i);
    expect(binding).toMatch(/Max-Age=600/);
    expect(binding).not.toMatch(/Domain=/i);
    expect(setCookie(response, SSO_RETURN_COOKIE)).toContain('%2Finquiries');
  });

  it('uses the plain cookie name where cookies cannot be Secure', async () => {
    mocks.startSso.mockResolvedValueOnce({
      kind: 'redirect',
      authorizationUrl: 'http://127.0.0.1:4000/authorize',
      binding: BINDING,
      expiresAt: '2026-11-13T12:10:00.000Z',
    });
    const response = await startAt('acme-sso');
    expect(setCookie(response, SSO_BINDING_COOKIE_INSECURE)).toContain(BINDING);
    expect(setCookie(response, SSO_RETURN_COOKIE)).toBeUndefined();
    expect(mocks.startSso).toHaveBeenCalledWith('acme-sso', {}, AGENT);
  });

  it('asks the sign-in page to choose among several providers', async () => {
    mocks.startSso.mockResolvedValueOnce({ kind: 'choose', providers: [] });
    const response = await startAt('acme-sso');
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login?sso=acme-sso`);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('returns to the sign-in page with one sentence, never calling the API for a bad name', async () => {
    mocks.startSso.mockResolvedValueOnce({ kind: 'failed', failure: 'sso_not_configured' });
    expect((await startAt('nobody')).headers.get('location')).toBe(
      `${ORIGIN}/login?reason=sso-not-configured`,
    );
    for (const [slug, query] of [
      ['Not_A_Name', ''],
      ['acme-sso', '?provider-id=ssop_nope'],
      ['acme-sso', '?return-to=https%3A%2F%2Fevil.example.org'],
    ] as const) {
      const response = await startAt(slug, query);
      expect(response.headers.get('location')).toBe(`${ORIGIN}/login?reason=sso-not-configured`);
    }
    expect(mocks.startSso).toHaveBeenCalledOnce();
  });
});

describe('GET /sso/callback/:provider (C248.4, C248.6)', () => {
  const query = '?code=synthetic-code&state=synthetic-state&iss=https%3A%2F%2Fidp.example.com';

  it('opens the console with the session cookie and clears the binding', async () => {
    mocks.finishSso.mockResolvedValueOnce({ kind: 'session', session: sessionResponse() });
    const response = await callbackOf(PROVIDER, query, {
      [SSO_BINDING_COOKIE_INSECURE]: BINDING,
      [SSO_RETURN_COOKIE]: encodeURIComponent('/inquiries'),
    });
    const [providerId, passed, binding, agent] = mocks.finishSso.mock.calls[0] as [
      string,
      URLSearchParams,
      string | null,
      string | null,
    ];
    expect(providerId).toBe(PROVIDER);
    expect(Object.fromEntries(passed)).toEqual({
      code: 'synthetic-code',
      state: 'synthetic-state',
      iss: 'https://idp.example.com',
    });
    expect(binding).toBe(BINDING);
    expect(agent).toBe(AGENT);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/inquiries`);
    const session = setCookie(response, SESSION_COOKIE) ?? '';
    expect(session).toContain(`${SESSION_COOKIE}=${sessionResponse().token}`);
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=lax/i);
    expect(setCookie(response, SSO_BINDING_COOKIE_INSECURE)).toMatch(
      /Max-Age=0|Expires=Thu, 01 Jan 1970/,
    );
    expect(setCookie(response, SSO_RETURN_COOKIE)).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
  });

  it('in a production build, opens the console with the __Host- session cookie (KP11-78)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mocks.finishSso.mockResolvedValueOnce({ kind: 'session', session: sessionResponse() });
    const response = await callbackOf(PROVIDER, query, { [SSO_BINDING_COOKIE]: BINDING });
    const session = setCookie(response, '__Host-openverify_session') ?? '';
    expect(session).toContain(`__Host-openverify_session=${sessionResponse().token}`);
    expect(session).toMatch(/; Secure/i);
    expect(session).toMatch(/Path=\/(;|$)/);
    expect(session).not.toMatch(/Domain=/i);
    expect(setCookie(response, SESSION_COOKIE)).toBeUndefined();
  });

  it('passes no binding when the cookie is missing or malformed', async () => {
    mocks.finishSso.mockResolvedValue({ kind: 'failed', failure: 'sso_state_invalid' });
    const missing = await callbackOf(PROVIDER, query);
    expect(mocks.finishSso.mock.calls[0]?.[2]).toBeNull();
    expect(missing.headers.get('location')).toBe(`${ORIGIN}/login?reason=sso-state-invalid`);
    await callbackOf(PROVIDER, query, { [SSO_BINDING_COOKIE_INSECURE]: 'not-a-binding' });
    expect(mocks.finishSso.mock.calls[1]?.[2]).toBeNull();
  });

  it('continues to the second factor through a same-site page, so its Strict cookie is sent', async () => {
    const challenge = {
      'mfa-token': `ovm_${'M'.repeat(43)}`,
      factors: [
        { id: 'mfa_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z', type: 'totp' },
        { id: 'mfa_01J9ZK3M5Q7R8S9T0V1W2X3Y50', type: 'totp' },
      ],
    };
    mocks.finishSso.mockResolvedValueOnce({ kind: 'mfa', challenge });
    const response = await callbackOf(PROVIDER, query, { [SSO_BINDING_COOKIE_INSECURE]: BINDING });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/html/);
    const html = await response.text();
    expect(html).toContain('<meta http-equiv="refresh" content="0;url=/login/mfa">');
    expect(html).toContain('href="/login/mfa"');
    expect(html).not.toContain(challenge['mfa-token']);
    const stored = setCookie(response, MFA_CHALLENGE_COOKIE) ?? '';
    expect(stored).toMatch(/Path=\/login/);
    expect(stored).toMatch(/SameSite=strict/i);
    const value = decodeURIComponent(stored.split(';')[0]?.split('=')[1] ?? '');
    expect(decodeMfaChallenge(value)).toMatchObject({
      token: challenge['mfa-token'],
      factors: ['totp'],
    });
  });

  it('returns from a step-up to where it began', async () => {
    mocks.finishSso.mockResolvedValueOnce({ kind: 'stepped-up' });
    const response = await callbackOf(PROVIDER, query, {
      [SSO_BINDING_COOKIE_INSECURE]: BINDING,
      [SESSION_COOKIE]: `ovu_${'S'.repeat(43)}`,
      [SSO_RETURN_COOKIE]: encodeURIComponent('/settings/connect'),
    });
    expect(response.headers.get('location')).toBe(`${ORIGIN}/settings/connect`);
    expect(setCookie(response, SESSION_COOKIE)).toBeUndefined();
  });

  it('keeps a signed-in browser where it was when a step-up fails', async () => {
    mocks.finishSso.mockResolvedValueOnce({ kind: 'failed', failure: 'sso_user_unknown' });
    const response = await callbackOf(PROVIDER, query, {
      [SSO_BINDING_COOKIE_INSECURE]: BINDING,
      [SESSION_COOKIE]: `ovu_${'S'.repeat(43)}`,
    });
    expect(response.headers.get('location')).toBe(`${ORIGIN}/account/security`);
  });

  it('refuses a malformed provider without calling the API', async () => {
    const response = await callbackOf('ssop_nope', query);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login?reason=sso-state-invalid`);
    expect(mocks.finishSso).not.toHaveBeenCalled();
  });
});

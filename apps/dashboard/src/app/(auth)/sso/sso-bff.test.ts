// @vitest-environment node
import { SSO_BINDING_COOKIE, SSO_BINDING_COOKIE_INSECURE } from '@openverify/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionResponse } from '../../../testing/api-fixtures';
import { BFF_TOKEN, mockApi, type MockApi } from '../../../testing/api-mock';
import { fakeRequest } from '../../../testing/fake-request';
import { markPeerAddressHeaderTrusted } from '../../../lib/api/peer-address';
import {
  SSO_FAILURE_WORDS,
  finishSso,
  returnPathOf,
  ssoBindingCookieName,
  ssoFailureOf,
  ssoFailureReason,
  startSso,
  startSsoStepUp,
} from './sso-bff';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));

const MARK = Symbol.for('openverify.dashboard.peer-address-header');
const PROVIDER = 'ssop_01JC0000000000000000000001';
const OTHER = 'ssop_01JC0000000000000000000002';
const BINDING = `ovsb_${'B'.repeat(43)}`;
const AGENT = 'Mozilla/5.0 (synthetic test browser)';
const REDIRECT = {
  kind: 'redirect',
  'authorization-url': 'https://idp.example.com/authorize?client_id=synthetic',
  binding: BINDING,
  'expires-at': '2026-11-13T12:10:00.000Z',
};
const problem = (status: number, code: string) => ({
  type: 'about:blank',
  title: 'Refused',
  status,
  detail: 'synthetic detail',
  code,
});

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.headers.set('x-openverify-peer-ip', '198.51.100.7');
  markPeerAddressHeaderTrusted();
});

afterEach(() => {
  api.restore();
  Reflect.deleteProperty(globalThis, MARK);
  vi.unstubAllEnvs();
});

describe('the SSO BFF calls (C248.4)', () => {
  it('starts with the sign-in name, the provider and the return path, as the BFF', async () => {
    api.reply(200, REDIRECT);
    await expect(
      startSso('acme-sso', { providerId: PROVIDER, returnTo: '/inquiries' }, AGENT),
    ).resolves.toEqual({
      kind: 'redirect',
      authorizationUrl: REDIRECT['authorization-url'],
      binding: BINDING,
      expiresAt: REDIRECT['expires-at'],
    });
    const request = api.last();
    expect(request.method).toBe('GET');
    expect(request.path).toBe('/api/v1/dashboard/sso/acme-sso/start');
    expect(Object.fromEntries(request.query)).toEqual({
      'provider-id': PROVIDER,
      'return-to': '/inquiries',
    });
    expect(request.headers.get('x-openverify-bff-token')).toBe(BFF_TOKEN);
    expect(request.headers.get('x-openverify-client-ip')).toBe('198.51.100.7');
    expect(request.headers.get('user-agent')).toBe(AGENT);
    expect(request.headers.has('authorization')).toBe(false);
  });

  it('answers the providers to choose from', async () => {
    api.reply(200, {
      kind: 'choose',
      providers: [
        { id: PROVIDER, 'display-name': 'Workforce' },
        { id: OTHER, 'display-name': 'Contractors' },
      ],
    });
    await expect(startSso('acme-sso', {}, null)).resolves.toEqual({
      kind: 'choose',
      providers: [
        { id: PROVIDER, displayName: 'Workforce' },
        { id: OTHER, displayName: 'Contractors' },
      ],
    });
    expect(Object.fromEntries(api.last().query)).toEqual({});
  });

  it('turns a refusal or a silence into one generic failure', async () => {
    api.reply(404, problem(404, 'sso_not_configured'));
    await expect(startSso('nobody', {}, null)).resolves.toEqual({
      kind: 'failed',
      failure: 'sso_not_configured',
    });
    api.fail();
    await expect(startSso('acme-sso', {}, null)).resolves.toEqual({
      kind: 'failed',
      failure: 'unavailable',
    });
  });

  it('asks for a step-up of the current session with its token', async () => {
    api.reply(200, REDIRECT);
    const token = `ovu_${'S'.repeat(43)}`;
    await expect(startSsoStepUp(token, AGENT)).resolves.toMatchObject({ kind: 'redirect' });
    const request = api.last();
    expect(request).toMatchObject({
      method: 'POST',
      path: '/api/v1/dashboard/sessions/current/step-up/sso',
      body: {},
    });
    expect(request.headers.get('authorization')).toBe(`Bearer ${token}`);
    api.reply(403, problem(403, 'step_up_required'));
    await expect(startSsoStepUp(token, AGENT)).resolves.toEqual({
      kind: 'failed',
      failure: 'unavailable',
    });
  });

  it('passes the provider’s query on unchanged with the binding in its header', async () => {
    api.reply(201, sessionResponse());
    const query = new URLSearchParams({
      code: 'synthetic-code',
      state: 'synthetic-state',
      iss: 'https://idp.example.com',
    });
    await expect(finishSso(PROVIDER, query, BINDING, AGENT)).resolves.toEqual({
      kind: 'session',
      session: sessionResponse(),
    });
    const request = api.last();
    expect(request.path).toBe(`/api/v1/dashboard/sso/callback/${PROVIDER}`);
    expect(Object.fromEntries(request.query)).toEqual(Object.fromEntries(query));
    expect(request.headers.get('x-openverify-sso-binding')).toBe(BINDING);
    expect(request.headers.get('user-agent')).toBe(AGENT);
  });

  it('reads a second factor, a step-up and a refusal from the callback', async () => {
    const challenge = {
      'mfa-token': `ovm_${'M'.repeat(43)}`,
      factors: [{ id: 'mfa_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z', type: 'totp' }],
    };
    api.reply(202, challenge);
    await expect(
      finishSso(PROVIDER, new URLSearchParams({ state: 's', code: 'c' }), null, null),
    ).resolves.toEqual({
      kind: 'mfa',
      challenge,
    });
    expect(api.last().headers.has('x-openverify-sso-binding')).toBe(false);
    api.reply(200, {
      'mfa-verified-at': '2026-11-13T12:00:00.000Z',
      'step-up-expires-at': '2026-11-13T12:10:00.000Z',
    });
    await expect(
      finishSso(PROVIDER, new URLSearchParams({ state: 's', code: 'c' }), BINDING, null),
    ).resolves.toEqual({ kind: 'stepped-up' });
    api.reply(403, problem(403, 'sso_user_unknown'));
    await expect(
      finishSso(PROVIDER, new URLSearchParams({ state: 's', code: 'c' }), BINDING, null),
    ).resolves.toEqual({ kind: 'failed', failure: 'sso_user_unknown' });
  });

  it('names the binding cookie by whether cookies are Secure', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(ssoBindingCookieName()).toBe(SSO_BINDING_COOKIE);
    vi.stubEnv('OPENVERIFY_DASHBOARD_INSECURE_COOKIES', 'true');
    expect(ssoBindingCookieName()).toBe(SSO_BINDING_COOKIE_INSECURE);
  });

  it('returns only to a path of the console', () => {
    expect(returnPathOf('/inquiries?filter=x')).toBe('/inquiries?filter=x');
    for (const value of [
      '//evil.example.org',
      '/\\evil.example.org',
      'https://evil.example.org',
      '/a b',
      '',
      null,
      undefined,
      `/${'a'.repeat(2048)}`,
    ]) {
      expect(returnPathOf(value)).toBeNull();
    }
  });

  it('maps every failure to one sentence and one login reason', () => {
    expect(ssoFailureReason('sso_user_unknown')).toBe('sso-user-unknown');
    expect(ssoFailureReason('sso_state_invalid')).toBe('sso-state-invalid');
    expect(ssoFailureReason('unavailable')).toBe('sso-unavailable');
    // C167.2's own notice on the sign-in page.
    expect(ssoFailureReason('no_environment_role')).toBe('no-environment-role');
    for (const words of Object.values(SSO_FAILURE_WORDS)) {
      expect(words).not.toMatch(/@|token|subject/i);
    }
    expect(ssoFailureOf(new Error('synthetic'))).toBe('unavailable');
  });
});

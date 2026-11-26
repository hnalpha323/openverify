// @vitest-environment node
import { getRedirectUrl } from 'next/experimental/testing/server';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { proxy } from './proxy';

const ORIGIN = 'http://dashboard.test';
const request = (path: string) => new NextRequest(`${ORIGIN}${path}`);

describe('proxy: single sign-on (C248.4; sso-oidc’s named borrowed edit)', () => {
  it.each([
    '/sso/start?organization=acme-sso',
    '/sso/acme-sso/start',
    '/sso/acme-sso/start?provider-id=ssop_01JC0000000000000000000001',
    '/sso/callback/ssop_01JC0000000000000000000001?code=synthetic&state=synthetic',
  ])('lets %s through without a session: it is part of signing in', (path) => {
    const response = proxy(request(path));
    expect(getRedirectUrl(response)).toBeNull();
    expect(response.headers.get('content-security-policy')).not.toBeNull();
  });

  it.each(['/sso', '/ssox/acme/start', '/settings/security/sso', '/sso-admin'])(
    'still guards %s, which only looks like a single sign-on path',
    (path) => {
      expect(getRedirectUrl(proxy(request(path)))).toBe(`${ORIGIN}/login`);
    },
  );
});

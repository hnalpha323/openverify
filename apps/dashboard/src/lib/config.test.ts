// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  API_URL_ENV,
  BFF_TOKEN_ENV,
  INSECURE_COOKIES_ENV,
  TRUSTED_PROXY_HOPS_ENV,
  apiBaseUrl,
  bffToken,
  secureCookies,
  trustedProxyHops,
} from './config';

describe('apiBaseUrl', () => {
  it('reads the server-only OPENVERIFY_API_URL', () => {
    expect(API_URL_ENV).toBe('OPENVERIFY_API_URL');
    expect(apiBaseUrl({ OPENVERIFY_API_URL: 'http://api:3000' })).toBe('http://api:3000');
  });

  it('drops trailing slashes so paths join cleanly', () => {
    expect(apiBaseUrl({ OPENVERIFY_API_URL: 'https://api.example.test/base//' })).toBe(
      'https://api.example.test/base',
    );
  });

  it.each([undefined, '', '   '])('fails clearly when it is not set (%j)', (value) => {
    expect(() => apiBaseUrl({ OPENVERIFY_API_URL: value })).toThrow(
      'OPENVERIFY_API_URL is not set',
    );
  });

  it.each(['api:3000', 'ftp://api.example.test', 'http://user:secret@api.example.test'])(
    'rejects %j, which is not a plain http(s) URL',
    (value) => {
      expect(() => apiBaseUrl({ OPENVERIFY_API_URL: value })).toThrow(
        'OPENVERIFY_API_URL must be an http(s) URL without credentials, query or fragment',
      );
    },
  );

  it('defaults to the process environment', () => {
    const previous = process.env.OPENVERIFY_API_URL;
    process.env.OPENVERIFY_API_URL = 'http://localhost:3000';
    try {
      expect(apiBaseUrl()).toBe('http://localhost:3000');
    } finally {
      if (previous === undefined) {
        delete process.env.OPENVERIFY_API_URL;
      } else {
        process.env.OPENVERIFY_API_URL = previous;
      }
    }
  });
});

describe('secureCookies', () => {
  it.each([
    [{ NODE_ENV: 'production' }, true],
    [{ NODE_ENV: 'production', OPENVERIFY_DASHBOARD_INSECURE_COOKIES: 'false' }, true],
    [{ NODE_ENV: 'production', OPENVERIFY_DASHBOARD_INSECURE_COOKIES: 'TRUE' }, true],
    [{ NODE_ENV: 'production', OPENVERIFY_DASHBOARD_INSECURE_COOKIES: 'true' }, false],
    [{ NODE_ENV: 'development' }, false],
    [{ NODE_ENV: 'test' }, false],
    [{}, false],
  ])('%j → %s', (env, secure) => {
    expect(INSECURE_COOKIES_ENV).toBe('OPENVERIFY_DASHBOARD_INSECURE_COOKIES');
    expect(secureCookies(env)).toBe(secure);
  });
});

describe('bffToken (C21)', () => {
  it('reads the shared secret the API checks before it trusts a forwarded client address', () => {
    expect(BFF_TOKEN_ENV).toBe('OPENVERIFY_DASHBOARD_BFF_TOKEN');
    expect(bffToken({ OPENVERIFY_DASHBOARD_BFF_TOKEN: ' change-me-synthetic-bff-token ' })).toBe(
      'change-me-synthetic-bff-token',
    );
  });

  it.each([undefined, '', '  '])('is null when it is not set (%j): no token is sent', (value) => {
    expect(bffToken({ OPENVERIFY_DASHBOARD_BFF_TOKEN: value })).toBeNull();
  });
});

describe('trustedProxyHops (C21)', () => {
  it('defaults to 0: the socket peer is the client, whatever X-Forwarded-For says', () => {
    expect(TRUSTED_PROXY_HOPS_ENV).toBe('OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS');
    expect(trustedProxyHops({})).toBe(0);
    expect(trustedProxyHops({ OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS: '' })).toBe(0);
  });

  it.each([
    ['0', 0],
    ['1', 1],
    [' 2 ', 2],
    ['32', 32],
  ])('reads %j as %i', (value, hops) => {
    expect(trustedProxyHops({ OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS: value })).toBe(hops);
  });

  it.each(['-1', '1.5', 'two', '33', '1e1', '0x1'])('refuses %j clearly', (value) => {
    expect(() => trustedProxyHops({ OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS: value })).toThrow(
      'OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS must be a whole number from 0 to 32',
    );
  });
});

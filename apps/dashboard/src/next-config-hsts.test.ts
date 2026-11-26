// @vitest-environment node
/**
 * C255.1 (decision 40; Phase 11, Workflow 11B, platform-ops): `OPENVERIFY_HSTS_MAX_AGE` (0 = off,
 * the default; at most 63,072,000) adds `Strict-Transport-Security: max-age=<n>; includeSubDomains`
 * to every console response the configuration's headers reach. Next.js serves those headers from
 * the build's routes manifest, so the console's value is the one `next build` saw.
 */
import { unstable_getResponseFromNextConfig } from 'next/experimental/testing/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import nextConfig, { HSTS_MAX_AGE_LIMIT, hstsHeaders } from '../next.config';

afterEach(() => {
  vi.unstubAllEnvs();
});

const responseHeaders = async (path: string) =>
  Object.fromEntries(
    (
      await unstable_getResponseFromNextConfig({
        url: `http://dashboard.test${path}`,
        nextConfig,
      })
    ).headers,
  );

describe('OPENVERIFY_HSTS_MAX_AGE in the console (C255.1)', () => {
  it('sends nothing while unset or 0', async () => {
    expect(hstsHeaders({})).toEqual([]);
    expect(hstsHeaders({ OPENVERIFY_HSTS_MAX_AGE: '0' })).toEqual([]);
    expect(hstsHeaders({ OPENVERIFY_HSTS_MAX_AGE: '' })).toEqual([]);
    vi.stubEnv('OPENVERIFY_HSTS_MAX_AGE', '0');
    expect((await responseHeaders('/inquiries'))['strict-transport-security']).toBeUndefined();
  });

  it('sends the header on every route above 0, beside the other security headers', async () => {
    expect(hstsHeaders({ OPENVERIFY_HSTS_MAX_AGE: String(HSTS_MAX_AGE_LIMIT) })).toEqual([
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
    ]);
    vi.stubEnv('OPENVERIFY_HSTS_MAX_AGE', '31536000');
    for (const path of ['/login', '/inquiries', '/files/x/content']) {
      const headers = await responseHeaders(path);
      expect(headers['strict-transport-security'], path).toBe(
        'max-age=31536000; includeSubDomains',
      );
      expect(headers['x-frame-options'], path).toBe('DENY');
    }
  });

  it.each(['-1', '63072001', '1e5', 'a year'])('refuses %j, naming the variable', (value) => {
    expect(() => hstsHeaders({ OPENVERIFY_HSTS_MAX_AGE: value })).toThrow(
      'OPENVERIFY_HSTS_MAX_AGE must be a whole number of seconds from 0 to 63072000',
    );
  });
});

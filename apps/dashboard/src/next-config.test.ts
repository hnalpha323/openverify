// @vitest-environment node
import { unstable_getResponseFromNextConfig } from 'next/experimental/testing/server';
import { describe, expect, it } from 'vitest';
import nextConfig, { DIST_DIR_ENV, buildOutput } from '../next.config';

describe('next.config', () => {
  it('serves images unoptimized, so the optional LGPL sharp binaries are never needed', () => {
    expect(nextConfig.images?.unoptimized).toBe(true);
  });

  it('compiles the shared UI package from source', () => {
    expect(nextConfig.transpilePackages).toContain('@openverify/ui');
  });

  it('writes the standalone output the console image runs its custom server over (C257.1)', () => {
    expect(nextConfig.output).toBe('standalone');
  });

  it('does not advertise the framework', () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it.each([
    '/login',
    '/inquiries',
    '/inquiries/inq_01J9ZK3M5Q7R8S9T0V1W2X3Y4Z',
    '/files/x/content',
  ])('sends the console security headers on %s', async (path) => {
    const response = await unstable_getResponseFromNextConfig({
      url: `http://dashboard.test${path}`,
      nextConfig,
    });

    expect(Object.fromEntries(response.headers)).toMatchObject({
      // The console must never be framed by another site (clickjacking).
      'content-security-policy': "frame-ancestors 'none'",
      'x-frame-options': 'DENY',
      // URLs carry inquiry IDs; they never leave in a Referer.
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    });
  });
});

describe('buildOutput (an isolated build for the e2e stack)', () => {
  it('builds into the default .next without OPENVERIFY_DASHBOARD_DIST_DIR', () => {
    expect(DIST_DIR_ENV).toBe('OPENVERIFY_DASHBOARD_DIST_DIR');
    expect(buildOutput({})).toEqual({});
    expect(buildOutput({ OPENVERIFY_DASHBOARD_DIST_DIR: ' ' })).toEqual({});
  });

  it('builds the e2e stack into .next/e2e, type-checked with its own generated types', () => {
    expect(buildOutput({ OPENVERIFY_DASHBOARD_DIST_DIR: '.next/e2e' })).toEqual({
      distDir: '.next/e2e',
      typescript: { tsconfigPath: 'tsconfig.e2e.json' },
    });
  });

  it.each(['build', '../outside', '.next-e2e'])('refuses %j, which has no tsconfig', (value) => {
    expect(() => buildOutput({ OPENVERIFY_DASHBOARD_DIST_DIR: value })).toThrow(
      'OPENVERIFY_DASHBOARD_DIST_DIR must be unset or .next/e2e',
    );
  });
});

import type { NextConfig } from 'next';

/**
 * Sent on every console response. The script CSP with its per-request nonce is set by
 * `src/proxy.ts` (C170), whose policy replaces this static `frame-ancestors 'none'` on every route
 * the proxy handles; this header stays for the routes the proxy skips (plan DS1).
 */
const SECURITY_HEADERS = [
  // The console must never be framed by another site (clickjacking).
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  // URLs carry inquiry IDs; they never leave in a Referer.
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
];

/** C255.1: the most `OPENVERIFY_HSTS_MAX_AGE` may say (two years). */
export const HSTS_MAX_AGE_LIMIT = 63_072_000;

/**
 * C255.1 (decision 40; Phase 11, Workflow 11B, platform-ops): `Strict-Transport-Security` while
 * `OPENVERIFY_HSTS_MAX_AGE` is above 0 (0 = off, the default), for an install whose TLS terminator
 * cannot add it.
 * @throws {Error} naming the variable for a value that is not 0 to two years.
 */
export function hstsHeaders(
  env: Readonly<Record<string, string | undefined>>,
): { key: string; value: string }[] {
  const text = env.OPENVERIFY_HSTS_MAX_AGE?.trim() ?? '';
  const maxAge = text === '' ? 0 : /^\d{1,8}$/.test(text) ? Number(text) : Number.NaN;
  if (!(maxAge >= 0 && maxAge <= HSTS_MAX_AGE_LIMIT)) {
    throw new Error(
      `OPENVERIFY_HSTS_MAX_AGE must be a whole number of seconds from 0 to ${String(HSTS_MAX_AGE_LIMIT)}`,
    );
  }
  return maxAge === 0
    ? []
    : [
        {
          key: 'Strict-Transport-Security',
          value: `max-age=${String(maxAge)}; includeSubDomains`,
        },
      ];
}

/**
 * A build output other than `.next`, for a build that must not share one: the e2e stack builds
 * into `.next/e2e` (`e2e/setup/stack.ts`), so a developer's or agent's `next typegen` or
 * `next dev`, which write `.next/types` and `.next/dev`, never collides with an e2e run. Each
 * output type-checks with its own generated types, so it has its own tsconfig. Set it for the
 * build and for `server.ts`, which serves that output.
 */
export const DIST_DIR_ENV = 'OPENVERIFY_DASHBOARD_DIST_DIR';
const ISOLATED_OUTPUTS: Readonly<Record<string, string>> = { '.next/e2e': 'tsconfig.e2e.json' };

/**
 * `distDir` and the tsconfig of the build output `OPENVERIFY_DASHBOARD_DIST_DIR` names.
 * @throws {Error} for an output this app has no tsconfig for.
 */
export function buildOutput(
  env: Readonly<Record<string, string | undefined>>,
): Pick<NextConfig, 'distDir' | 'typescript'> {
  const distDir = env[DIST_DIR_ENV]?.trim() ?? '';
  if (distDir === '') {
    return {};
  }
  const tsconfigPath = ISOLATED_OUTPUTS[distDir];
  if (tsconfigPath === undefined) {
    throw new Error(`${DIST_DIR_ENV} must be unset or ${Object.keys(ISOLATED_OUTPUTS).join(', ')}`);
  }
  return { distDir, typescript: { tsconfigPath } };
}

const nextConfig: NextConfig = {
  ...buildOutput(process.env),
  // C257.1 (Phase 11, Workflow 11C): the console image ships the standalone output's traced files
  // and runs the custom server (server.ts, C21) over them, never Next's generated server.js.
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  // Compile the shared UI package from its TypeScript source, as Vite and Vitest do through
  // the `@openverify/source` condition, so dev and build never depend on a stale `dist/`.
  transpilePackages: ['@openverify/ui'],
  turbopack: {
    resolveAlias: { '@openverify/ui': '../../packages/ui/src/index.ts' },
  },
  // Images are served as uploaded, through the authenticated file proxy. Without the image
  // optimizer, next/image never needs `sharp`, whose prebuilt binaries bundle LGPL libvips;
  // pnpm-workspace.yaml also skips installing it (`ignoredOptionalDependencies`).
  images: { unoptimized: true },
  // C255.1: read when the configuration's headers are built (`next build`, or each `next dev`
  // request), so the console sends the value the build saw.
  headers: () =>
    Promise.resolve([
      { source: '/:path*', headers: [...SECURITY_HEADERS, ...hstsHeaders(process.env)] },
    ]),
};

export default nextConfig;

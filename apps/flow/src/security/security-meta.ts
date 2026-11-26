/**
 * Security metadata for the built `index.html`: a Content-Security-Policy `<meta>` whose
 * `connect-src` allows the API origin chosen at build time (or, built without one, leaves
 * `connect-src` to the flow server's header: C257.1). Only applied to production builds,
 * because the Vite dev server injects inline scripts that this policy blocks.
 *
 * `frame-ancestors`, `Permissions-Policy` and `Referrer-Policy` headers must also be sent by the
 * serving layer: browsers ignore `frame-ancestors` in a `<meta>` policy, and there is no
 * `<meta>` form of Permissions-Policy.
 */
import type { Plugin } from 'vite';
import { apiOrigin, buildContentSecurityPolicy } from './csp-policy';

// The policy itself lives in the dependency-free `csp-policy.ts`, which the flow server shares
// (Workflow 9A Stage 1b (F)); this module keeps its export for the build and its callers.
export { buildContentSecurityPolicy, type ContentSecurityPolicyOptions } from './csp-policy';

/**
 * C257.1 (Phase 11, Workflow 11C, images-11c; decision 73): a bundle built without
 * `VITE_OPENVERIFY_API_URL` (the image) learns the API's origin at run time from the flow server,
 * whose header sends `connect-src` with that exact origin. A `<meta>` policy and a header policy
 * intersect, so the `<meta>` must not narrow connections: it keeps every other directive and allows
 * any http(s) origin (without a `connect-src` of its own, `default-src 'self'` would govern them).
 */
function withRunTimeConnectSrc(policy: string): string {
  return policy
    .split('; ')
    .map((directive) =>
      directive.startsWith('connect-src ') ? "connect-src 'self' https: http:" : directive,
    )
    .join('; ');
}

/**
 * Vite plugin that prepends the CSP `<meta>` to `index.html` in production builds.
 * @throws {TypeError} at configuration time when `apiUrl` is invalid, so a bad build fails.
 */
export function securityMetaPlugin(options: { readonly apiUrl: string | undefined }): Plugin {
  const built = buildContentSecurityPolicy({ apiOrigin: apiOrigin(options.apiUrl) });
  const policy = (options.apiUrl?.trim() ?? '') === '' ? withRunTimeConnectSrc(built) : built;
  return {
    name: 'openverify:security-meta',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
        injectTo: 'head-prepend',
      },
    ],
  };
}

/**
 * C107.9 (carried since Phase 1A): the response headers the flow's serving layer sends, beside the
 * CSP `<meta>` of `security-meta.ts`. Browsers ignore `frame-ancestors` in a `<meta>` policy and
 * Permissions-Policy has no `<meta>` form, so `vite preview` (the compose-served flow) sends these
 * itself, and operators who serve the built flow from their own server send the same
 * (docs/flow/README.md). Only the hosted mode exists, so no page may frame the flow.
 */
export const FLOW_RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Content-Security-Policy': "frame-ancestors 'none'",
  'Permissions-Policy': 'camera=(self), geolocation=(), microphone=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
});

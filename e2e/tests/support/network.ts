/**
 * Workflow 7A spec helpers (C93.1, C93.6, F34): a browser context that reaches the API as if from a
 * sandbox address. The stack's API trusts its loopback proxy (`OPENVERIFY_TRUST_PROXY=127.0.0.1`,
 * e2e/src/env.ts), so a standard `X-Forwarded-For` added below CORS by `page.route` becomes the
 * session's `request.ip`. The browser itself sends no such header, the API's CORS list is
 * unchanged (`flowCorsAllowedHeaders` checks it), and no other header is touched.
 */
import type { BrowserContext } from '@playwright/test';
import { withForwardedFor } from '../../src/forwarded-for.js';

/** Every request `context` sends to `apiUrl` carries `X-Forwarded-For: <address>` from here on. */
export async function presentAddress(
  context: BrowserContext,
  apiUrl: string,
  address: string,
): Promise<void> {
  await context.route(`${apiUrl}/**`, async (route) => {
    await route.continue({ headers: withForwardedFor(route.request().headers(), address) });
  });
}

/**
 * The headers the flow API's CORS preflight allows a browser to send, asked for with
 * `X-Forwarded-For` among them: the production list, which must never grow to it.
 */
export async function flowCorsAllowedHeaders(apiUrl: string, origin: string): Promise<string[]> {
  const response = await fetch(`${apiUrl}/api/v1/flow/session`, {
    method: 'OPTIONS',
    headers: {
      origin,
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'authorization, x-forwarded-for',
    },
  });
  await response.body?.cancel();
  return (response.headers.get('access-control-allow-headers') ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name !== '');
}

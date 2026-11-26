/**
 * C255, C250.1, C287.3 (Workflow 11B, integration-11b): the platform's request-level hardening on
 * the real stack. Budget: 90 s.
 *
 * - C255.4: Next.js's own origin check on server actions, which `apps/dashboard/src/security/
 *   origin-checks.test.ts` counts only because this test proves it: a server-action post to a
 *   console page with a foreign `Origin` is refused before any action is looked up (500), while the
 *   same post from the console's own origin reaches the lookup (an unknown action id: 409 "Server
 *   Action unavailable.").
 * - C255.3: the flow server's response headers as Phase 9's C157 and Workflow 7A set them, and no
 *   HSTS header while `OPENVERIFY_HSTS_MAX_AGE` is 0 (the stack's default; C255.1).
 * - C250.1: `GET /ready` answers ready while the API reaches Postgres and Valkey (a store it cannot
 *   reach answers 503 naming it, proved by platform-ops' Testcontainers test). Every value is
 *   synthetic.
 */
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { signIn } from './support/dashboard.js';

/** An action id no build holds (Next.js ids are 40 or 42 hex characters). */
const UNKNOWN_ACTION = '00'.repeat(20) + 'ff';

test('server actions refuse a foreign origin; the flow headers and /ready hold (C255, C250.1)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  await signIn(page, stack.dashboardUrl, stack.operators.viewer);
  const post = (origin: string) =>
    page.request.post(`${stack.dashboardUrl}/inquiries`, {
      headers: {
        origin,
        'next-action': UNKNOWN_ACTION,
        accept: 'text/x-component',
        'content-type': 'text/plain;charset=UTF-8',
      },
      data: '[]',
      maxRedirects: 0,
      failOnStatusCode: false,
    });

  const foreign = await post('https://attacker.example.org');
  const own = await post(new URL(stack.dashboardUrl).origin);
  const seen = `own ${String(own.status())} ${(await own.text()).slice(0, 120)}; foreign ${String(foreign.status())} ${(await foreign.text()).slice(0, 120)}`;
  // From its own origin the post reaches the lookup: 409 "Server Action unavailable." for an id the
  // build does not hold. From a foreign origin Next.js refuses it before any lookup (500, the
  // "Invalid Server Actions request" error, its message withheld in production).
  expect(own.status(), seen).toBe(409);
  expect(await own.text(), seen).toContain('Server Action unavailable');
  expect(foreign.status(), seen).toBe(500);
  expect(await foreign.text(), seen).not.toContain('Server Action unavailable');

  const flow = await page.request.get(`${stack.flowUrl}/`, { failOnStatusCode: false });
  const headers = flow.headers();
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['permissions-policy']).toContain('camera=');
  expect(headers['strict-transport-security']).toBeUndefined();

  const ready = await page.request.get(`${stack.apiUrl}/ready`);
  expect(ready.status()).toBe(200);
  expect(await ready.json()).toEqual({ status: 'ready' });
});

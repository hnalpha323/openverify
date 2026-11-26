/**
 * The console's real script CSP (C170; K16, S17; decision 51), full stack. Budget: 90 s.
 *
 * - Every console page without a dynamic segment (derived from the e2e build's route manifest,
 *   so a page added later is checked too), opened by an admin, answers C170.1's policy byte for
 *   byte with a nonce of 16 bytes that differs on every request, beside the static
 *   `frame-ancestors 'none'`; every script carries that nonce; no page meets a violation.
 * - Every console page with a dynamic segment (Workflow 9C, `integration-9c`), at the first concrete
 *   URL the console links to (`consolePagesOnce`, from the same manifest), does the same; a route no
 *   link reaches fails. This spec runs in the console sweep's project, after every other spec, so
 *   the suite has made an object of each kind.
 * - `/login` (signed out) and the 404 page do the same, and so does the error page (Workflow 9D,
 *   K9-15), reached through `/error-probe`, which throws on purpose only when the dashboard runs
 *   with `OPENVERIFY_MODE=development`, as the e2e stack does (a 404 page otherwise).
 * - No route of the build is prerendered as static (C170.1, F20).
 * - `/csp-reports` takes a report without a session.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { consolePageRoutes, consolePagesOnce, isDynamicRoute } from './support/console-pages.js';
import { sessionTokenAs, signInAs } from './support/ui.js';
import {
  expectConsoleCspHeader,
  expectScriptsCarryNonce,
  prerenderedRoutes,
  recordPolicyViolations,
  staticConsolePages,
} from './support/ui-settings.js';

test('no route of the console build is prerendered as static, so every page gets its nonce (C170.1, F20)', () => {
  expect(staticConsolePages().length).toBeGreaterThan(20);
  expect(prerenderedRoutes()).toEqual([]);
});

test('every console page sends the real policy with a fresh nonce and meets no violation (C170.1, C170.3)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const violations = await recordPolicyViolations(page);
  await signInAs(page, stack, 'admin');
  const nonces = new Set<string>();
  const pages = staticConsolePages().filter(
    (route) => !['/login', '/login/mfa', '/accept-invitation'].includes(route),
  );

  for (const route of pages) {
    const response = await page.goto(`${stack.dashboardUrl}${route}`);
    const nonce = await expectConsoleCspHeader(response, stack.flowUrl);
    await expectScriptsCarryNonce(response, nonce);
    nonces.add(nonce);
  }

  expect(nonces.size).toBe(pages.length);
  expect(await violations()).toEqual([]);
});

test('every dynamic console page sends the real policy with a fresh nonce and meets no violation (C170.3; Workflow 9C)', async ({
  page,
  playwright,
}) => {
  test.setTimeout(240_000);
  const stack = readStackInfo();
  const token = await sessionTokenAs(stack, 'admin');
  const { found } = await consolePagesOnce(
    (cookie) => playwright.request.newContext({ extraHTTPHeaders: { cookie } }),
    stack,
    token,
  );
  const dynamic = consolePageRoutes().filter(isDynamicRoute);
  expect(dynamic.filter((route) => !found.has(route))).toEqual([]);
  const violations = await recordPolicyViolations(page);
  await signInAs(page, stack, 'admin');
  const nonces = new Set<string>();

  for (const route of dynamic) {
    const response = await page.goto(`${stack.dashboardUrl}${found.get(route) ?? route}`);
    expect(response?.status(), route).toBe(200);
    const nonce = await expectConsoleCspHeader(response, stack.flowUrl);
    await expectScriptsCarryNonce(response, nonce);
    nonces.add(nonce);
  }

  expect(nonces.size).toBe(dynamic.length);
  expect(await violations()).toEqual([]);
});

test('the sign-in page and the 404 page carry the policy and meet no violation (C170.1)', async ({
  page,
}) => {
  test.setTimeout(45_000);
  const stack = readStackInfo();
  const violations = await recordPolicyViolations(page);

  const login = await page.goto(`${stack.dashboardUrl}/login`);
  expect(login?.status()).toBe(200);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Sign in to OpenVerify' }),
  ).toBeVisible();
  const loginNonce = await expectConsoleCspHeader(login, stack.flowUrl);
  await expectScriptsCarryNonce(login, loginNonce);

  await signInAs(page, stack, 'admin');
  const missing = await page.goto(`${stack.dashboardUrl}/no-such-page-${randomUUID()}`);
  expect(missing?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  await expectScriptsCarryNonce(missing, await expectConsoleCspHeader(missing, stack.flowUrl));

  expect(await violations()).toEqual([]);
});

test('the error page carries the policy and meets no violation (C170.1, C170.3; K9-15)', async ({
  page,
}) => {
  test.setTimeout(45_000);
  const stack = readStackInfo();
  const violations = await recordPolicyViolations(page);
  await signInAs(page, stack, 'admin');

  const failed = await page.goto(`${stack.dashboardUrl}/error-probe`);
  // Next.js's route announcer is an alert too, so the error boundary's is found by its words.
  await expect(
    page.getByRole('alert').filter({ hasText: 'This page could not be loaded.' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expectScriptsCarryNonce(failed, await expectConsoleCspHeader(failed, stack.flowUrl));

  expect(await violations()).toEqual([]);
});

test('/csp-reports takes a violation report without a session (C170.2)', async ({ request }) => {
  const stack = readStackInfo();

  const answer = await request.post(`${stack.dashboardUrl}/csp-reports`, {
    headers: { 'content-type': 'application/csp-report' },
    data: JSON.stringify({
      'csp-report': {
        'document-uri': `${stack.dashboardUrl}/login`,
        'effective-directive': 'img-src',
        'blocked-uri': 'https://blocked.example.com/pixel.png',
      },
    }),
    maxRedirects: 0,
  });

  expect(answer.status()).toBe(204);
});

/**
 * C171.2 (Workflow 9C, `integration-9c`): axe once per console page, in the console sweep's own
 * project (`console-sweep`, after every other spec; never a shard of the `chromium` project).
 *
 * The pages are every page route of the console's e2e build (`consolePageRoutes`, from its route
 * manifest, never listed by hand), one test each. A route with a dynamic segment opens the first
 * concrete URL the console links to (`consolePagesOnce`), as an admin; a route no link reaches
 * fails its test. The signed-out pages open without a session, `/login/mfa` as the seeded MFA
 * admin between password and code. Each page answers 200 and passes `expectAccessible` (WCAG 2.0
 * to 2.2 A and AA tags, exceptions only in `e2e/a11y-exceptions.json`). No OTP is sent.
 *
 * One page answers 500 on purpose: `/error-probe` (Workflow 9D, K9-15) throws when the dashboard
 * runs with `OPENVERIFY_MODE=development`, as the e2e stack does, so the console's error page is
 * checked by axe here and by the real-header CSP spec (`ui-csp.spec.ts`).
 */
import { expect, test, type Page } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { expectAccessible } from './support/accessible.js';
import {
  SIGNED_OUT_PAGES,
  consolePageRoutes,
  consolePagesOnce,
  isDynamicRoute,
} from './support/console-pages.js';
import { useSessionToken } from './support/ui-settings.js';
import { sessionTokenAs, submitLogin } from './support/ui.js';

/** K9-15: the route that answers the console's error page on purpose. */
const ERROR_PROBE = '/error-probe';

/** Waits for the page's main heading and a quiet network, so client-only parts are drawn. */
async function settled(page: Page) {
  await expect(page.locator('h1').first()).toBeVisible();
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
}

for (const route of consolePageRoutes()) {
  test(`${route} passes axe (C171.2)`, async ({ page, playwright }) => {
    test.setTimeout(180_000);
    const stack = readStackInfo();
    if (route === '/login/mfa') {
      await submitLogin(page, stack, stack.mfaAdmin);
      await expect(page).toHaveURL(/\/login\/mfa$/);
    } else if (SIGNED_OUT_PAGES.includes(route)) {
      const response = await page.goto(`${stack.dashboardUrl}${route}`);
      expect(response?.status()).toBe(200);
    } else {
      const token = await sessionTokenAs(stack, 'admin');
      let target = route;
      if (isDynamicRoute(route)) {
        const { found } = await consolePagesOnce(
          (cookie) => playwright.request.newContext({ extraHTTPHeaders: { cookie } }),
          stack,
          token,
        );
        const url = found.get(route);
        expect(url, `no console link reaches ${route}`).toBeDefined();
        target = url ?? route;
      }
      await useSessionToken(page, stack.dashboardUrl, token);
      const response = await page.goto(`${stack.dashboardUrl}${target}`);
      if (route === ERROR_PROBE) {
        // K9-15: the error page has no page heading; its boundary's alert is what it shows.
        expect(response?.status(), target).toBe(500);
        await expect(
          page.getByRole('alert').filter({ hasText: 'This page could not be loaded.' }),
        ).toBeVisible();
        await expectAccessible(page, { where: route });
        return;
      }
      expect(response?.status(), target).toBe(200);
    }
    await settled(page);
    await expectAccessible(page, { where: route });
  });
}

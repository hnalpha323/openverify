/**
 * C160.9, C178.3 (`api-themes`, Workflow 9B; review F19): the session's theme in the built flow
 * under its production CSP. Tokens go through `setProperty` on one rule of the flow's own same-origin
 * stylesheet (never a style attribute and never an inline style), so the flow itself causes no
 * `securitypolicyviolation` in any engine while a theme set's palette and radius are applied,
 * `prefers-color-scheme` is followed under `auto` and the `style-variant` parameter forces a
 * variant; with no theme, `style-variant=dark` shows the built-in dark palette (flow only).
 *
 * The engine baseline (K9-35, Workflow 9D; orchestrator decision 3 before 9D): WebKit itself reports
 * one `style-src-attr` violation for a native `<select>` under any policy without `'unsafe-inline'`,
 * with no page script at all (CI 42331362147 and 42382549247 failed on it; the theme code was never
 * its cause). Each test therefore also opens, in the same browser context, a script-free control page
 * on the flow's origin, served under the flow's own production policy and holding one native
 * `<select>`: its reports are the engine's baseline. A flow page may report only what matches a
 * baseline entry (same directive, same blocked value, same target element, empty sample), and the
 * baseline itself is pinned per engine by its own test (none in Chromium and Firefox, at most the
 * select's `style-src-attr` in WebKit), so the allowance can never widen silently. The policy keeps
 * no `'unsafe-inline'`, `'unsafe-hashes'` or `style-src-attr` source, and the select stays native.
 *
 * Engines: Chromium everywhere; Firefox and WebKit in CI always, and locally when they start (see
 * `playwright.config.ts`). WebKit runs here without host libraries through Playwright's browser
 * server in Docker, as a local developer step only (test tooling, the image used unmodified, never
 * shipped, not in CI); the image tag must equal `@playwright/test`'s version:
 *
 *   docker run -d --rm --name openverify-webkit --ipc=host -p 127.0.0.1:3555:3555 \
 *     mcr.microsoft.com/playwright:v1.64.1-noble@sha256:2f05f8a734509a7b3f26a912639488ee08f58a7b292d14d62271bcff9038768f \
 *     sh -c 'cd /tmp && npx -y playwright@1.64.1 run-server --port 3555 --host 0.0.0.0'
 *   # wait until `docker logs openverify-webkit` prints "Listening on", then:
 *   PW_TEST_CONNECT_WS_ENDPOINT=ws://127.0.0.1:3555/ PW_TEST_CONNECT_EXPOSE_NETWORK='<loopback>' \
 *     OPENVERIFY_FLOW_E2E_ENGINES=webkit pnpm --filter @openverify/flow e2e --project=webkit theme-csp.spec.ts
 *   docker rm -f openverify-webkit
 */
import { BUILTIN_PALETTES } from '@openverify/core';
import { expect, test, type Page } from '@playwright/test';
import { buildContentSecurityPolicy } from '../src/security/csp-policy';
import { API_ORIGIN, MockFlowApi, flowLink } from './support/mock-flow-api';
import { SYNTHETIC_DARK, serveTheme, syntheticTheme } from './support/mock-themes';
import type { FlowTheme } from '@openverify/contracts';

/** One `securitypolicyviolation` report, with the element it names and its sample. */
interface Violation {
  readonly directive: string;
  readonly blocked: string;
  /** The event target's `nodeName`: `#document` when the report names no element, `none` without one. */
  readonly target: string;
  readonly sample: string;
}

/** Every `securitypolicyviolation` the page reports, from its first script on. */
async function recordViolations(page: Page): Promise<() => Promise<Violation[]>> {
  await page.addInitScript(() => {
    const violations: Violation[] = [];
    (window as unknown as { cspViolations: Violation[] }).cspViolations = violations;
    document.addEventListener('securitypolicyviolation', (event) => {
      violations.push({
        directive: event.violatedDirective,
        blocked: event.blockedURI,
        target: event.target instanceof Node ? event.target.nodeName : 'none',
        sample: event.sample,
      });
    });
  });
  return () =>
    page.evaluate(() => (window as unknown as { cspViolations: Violation[] }).cspViolations);
}

/** Where the control page is served, on the flow's own origin (never a real route of the flow). */
const CONTROL_PATH = '/__csp-control';

/** The control page: no script at all, one native `<select>`, nothing else that a policy governs. */
const CONTROL_PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>CSP control</title></head>
  <body>
    <label for="language">Language</label>
    <select id="language"><option value="en">English</option><option value="es">Español</option></select>
  </body>
</html>`;

/** Lets the page render its frames and run the tasks they queue (violation reports included). */
const settle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)));
      }),
  );

/**
 * The engine's baseline: what a script-free page on the flow's origin, under the flow's production
 * policy (the same builder and API origin as the build under test), reports for one native select.
 * Opened in `page`'s own context, so it is the same engine with the same settings.
 */
async function engineBaseline(page: Page, baseURL: string): Promise<Violation[]> {
  const control = await page.context().newPage();
  try {
    const violations = await recordViolations(control);
    await control.route(`${new URL(baseURL).origin}${CONTROL_PATH}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        headers: {
          'Content-Security-Policy': buildContentSecurityPolicy({ apiOrigin: API_ORIGIN }),
        },
        body: CONTROL_PAGE,
      }),
    );
    await control.goto(CONTROL_PATH, { waitUntil: 'load' });
    await control.locator('select').boundingBox();
    await settle(control);
    return await violations();
  } finally {
    await control.close();
  }
}

/** The one report an engine may make for a native select under the policy (WebKit's). */
const SELECT_STYLE_ATTR: Violation = {
  directive: 'style-src-attr',
  blocked: 'inline',
  target: 'SELECT',
  sample: '',
};

/** The flow page's reports that no baseline entry accounts for. */
function beyondBaseline(
  reported: readonly Violation[],
  baseline: readonly Violation[],
): Violation[] {
  return reported.filter(
    (violation) =>
      violation.sample !== '' ||
      !baseline.some(
        (entry) =>
          entry.sample === '' &&
          entry.directive === violation.directive &&
          entry.blocked === violation.blocked &&
          entry.target === violation.target,
      ),
  );
}

/** Fails on any report of the flow page beyond the engine's measured baseline. */
async function expectNoViolationBeyondBaseline(
  page: Page,
  baseURL: string | undefined,
  violations: () => Promise<Violation[]>,
) {
  if (baseURL === undefined) {
    throw new Error('The flow suite always has a baseURL (playwright.config.ts)');
  }
  await settle(page);
  const reported = await violations();
  const baseline = await engineBaseline(page, baseURL);
  expect(beyondBaseline(reported, baseline)).toEqual([]);
}

/** The value of a custom property on `<html>`, as the page computes it. */
const token = (page: Page, name: string) =>
  page.evaluate(
    (property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(),
    name,
  );

/** Opens the flow on a session that carries `theme` (none for the built-in tokens). */
async function openThemed(page: Page, theme: FlowTheme | null, query = '') {
  const violations = await recordViolations(page);
  const mock = new MockFlowApi();
  if (theme !== null) {
    serveTheme(mock, theme);
  }
  await mock.install(page);
  await page.goto(query === '' ? flowLink() : `/?${query}${flowLink().slice(1)}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  return violations;
}

test('applies a theme set’s palette and radius with no CSP violation', async ({
  page,
  baseURL,
}) => {
  const violations = await openThemed(page, syntheticTheme());

  await expect.poll(() => token(page, '--color-primary')).toBe('#2563eb');
  expect(await token(page, '--radius-md')).toBe('12px');
  expect(await token(page, 'color-scheme')).toBe('light');
  // No inline style on <html> at all: the tokens come from a rule of the same-origin stylesheet.
  expect(await page.evaluate(() => document.documentElement.getAttribute('style'))).toBeNull();
  const ruled = await page.evaluate(() =>
    [...document.styleSheets].some((sheet) =>
      [...sheet.cssRules].some(
        (rule) =>
          rule instanceof CSSStyleRule &&
          rule.style.getPropertyValue('--color-primary') === '#2563eb',
      ),
    ),
  );
  expect(ruled).toBe(true);
  await expectNoViolationBeyondBaseline(page, baseURL, violations);
});

test('follows prefers-color-scheme under auto, and its change', async ({ page, baseURL }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const violations = await openThemed(page, syntheticTheme({ mode: 'auto', dark: SYNTHETIC_DARK }));

  await expect.poll(() => token(page, '--color-surface')).toBe(BUILTIN_PALETTES.dark.surface);
  expect(await token(page, '--color-primary')).toBe(SYNTHETIC_DARK.primary);

  await page.emulateMedia({ colorScheme: 'light' });
  // A media query's `change` event is fired in the page's next rendering update, which an idle
  // headless WebKit may hold back for seconds: ask for frames, so the event is due before the poll.
  await settle(page);
  await expect.poll(() => token(page, '--color-surface')).toBe(BUILTIN_PALETTES.light.surface);
  await expectNoViolationBeyondBaseline(page, baseURL, violations);
});

test('lets style-variant force the dark variant of a theme that has one', async ({
  page,
  baseURL,
}) => {
  const violations = await openThemed(
    page,
    syntheticTheme({ dark: SYNTHETIC_DARK }),
    'style-variant=dark',
  );

  await expect.poll(() => token(page, '--color-surface')).toBe(BUILTIN_PALETTES.dark.surface);
  expect(await token(page, 'color-scheme')).toBe('dark');
  await expectNoViolationBeyondBaseline(page, baseURL, violations);
});

test('shows the built-in dark palette for style-variant=dark with no theme set', async ({
  page,
  baseURL,
}) => {
  const violations = await openThemed(page, null, 'style-variant=dark');

  await expect(page.locator('html')).toHaveAttribute('data-openverify-variant', 'dark');
  expect(await token(page, '--color-surface')).toBe(BUILTIN_PALETTES.dark.surface);
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).toBe('rgb(3, 7, 18)');
  await expectNoViolationBeyondBaseline(page, baseURL, violations);
});

test('keeps the built-in light tokens with no theme and no variant', async ({ page, baseURL }) => {
  const violations = await openThemed(page, null);

  expect(await token(page, '--color-primary')).toBe(BUILTIN_PALETTES.light.primary);
  await expect(page.locator('html')).not.toHaveAttribute('data-openverify-variant', /.*/);
  await expectNoViolationBeyondBaseline(page, baseURL, violations);
});

test('pins the engine baseline: none in Chromium and Firefox, at most WebKit’s select report', async ({
  page,
  baseURL,
  browserName,
}) => {
  if (baseURL === undefined) {
    throw new Error('The flow suite always has a baseURL (playwright.config.ts)');
  }
  const baseline = await engineBaseline(page, baseURL);

  // The control page holds no script and nothing styled inline, so any other report would be a new
  // engine behaviour (or a changed policy), never something this spec may silently allow.
  const allowed = browserName === 'webkit' ? [SELECT_STYLE_ATTR] : [];
  expect(baseline.length).toBeLessThanOrEqual(allowed.length);
  for (const entry of baseline) {
    expect(allowed).toContainEqual(entry);
  }
});

test('counts a report beyond the baseline: a flow page’s own inline style is never allowed', () => {
  const baseline = [SELECT_STYLE_ATTR];

  expect(beyondBaseline([SELECT_STYLE_ATTR], baseline)).toEqual([]);
  expect(beyondBaseline([SELECT_STYLE_ATTR], [])).toEqual([SELECT_STYLE_ATTR]);
  const ownStyle = { ...SELECT_STYLE_ATTR, target: 'HTML' };
  expect(beyondBaseline([ownStyle], baseline)).toEqual([ownStyle]);
  const sampled = { ...SELECT_STYLE_ATTR, sample: 'color: red' };
  expect(beyondBaseline([sampled], baseline)).toEqual([sampled]);
  const script = { directive: 'script-src-elem', blocked: 'inline', target: 'SCRIPT', sample: '' };
  expect(beyondBaseline([script], baseline)).toEqual([script]);
});

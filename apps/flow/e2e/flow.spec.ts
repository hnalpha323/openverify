import { expect, test, type Page } from '@playwright/test';
import {
  API_ORIGIN,
  MockFlowApi,
  SESSION_TOKEN,
  defaultFlow,
  flowLink,
} from './support/mock-flow-api';
import { takeSelfie } from './support/flow-steps';
import { syntheticCardPng } from './support/synthetic-png';

const FRONT = { name: 'front.png', mimeType: 'image/png', buffer: syntheticCardPng() };
const BACK = {
  name: 'back.png',
  mimeType: 'image/png',
  buffer: syntheticCardPng({ background: [236, 230, 214] }),
};

/** Console errors, including Content-Security-Policy violations, collected per page. */
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function giveConsent(page: Page) {
  await expect(
    page.getByRole('heading', { level: 1, name: 'Consent to use your biometric data' }),
  ).toBeVisible();
  await page.getByRole('checkbox', { name: /^I agree/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
}

async function uploadId(page: Page) {
  await expect(page.getByRole('heading', { level: 1, name: 'Photograph your ID' })).toBeVisible();
  await page.getByLabel('Choose a photo of the front of your ID').setInputFiles(FRONT);
  await expect(page.getByRole('img', { name: 'Your photo of the front of your ID' })).toBeVisible();
  await page.getByRole('button', { name: 'Use this photo' }).click();
  await page.getByLabel('Choose a photo of the back of your ID').setInputFiles(BACK);
  await expect(page.getByRole('img', { name: 'Your photo of the back of your ID' })).toBeVisible();
  await page.getByRole('button', { name: 'Use this photo' }).click();
}

test('completes the default flow: consent, ID upload, a guided selfie from the fake camera', async ({
  page,
}) => {
  // The guidance finds no face in the fake camera's pattern: the manual shutter appears after
  // 10 s of the page's clock (C40.11).
  await page.clock.install();
  const errors = collectConsoleErrors(page);
  const api = new MockFlowApi();
  await api.install(page);

  await page.goto(flowLink());

  // The credentials leave the address bar at once and live only in this tab's sessionStorage.
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  expect(
    await page.evaluate(() => window.sessionStorage.getItem('openverify.flow.session')),
  ).toContain(SESSION_TOKEN);

  await giveConsent(page);
  await uploadId(page);
  await takeSelfie(page, ['center']);

  await expect(
    page.getByRole('heading', { level: 1, name: 'Verification submitted' }),
  ).toBeVisible();
  await expect(
    page.getByText('Thank you. Your verification has been submitted, and you can close this page.'),
  ).toBeVisible();

  // C42.3: the optional matching consent was offered and left unticked.
  expect(api.consent).toEqual({
    textKeys: ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
    optionalTextKeys: [],
    locale: 'en',
  });
  expect(api.uploads.map(({ kind, mimeType, fileName }) => ({ kind, mimeType, fileName }))).toEqual(
    [
      { kind: 'front', mimeType: 'image/png', fileName: 'front.png' },
      { kind: 'back', mimeType: 'image/png', fileName: 'back.png' },
      { kind: 'selfie-center', mimeType: 'image/jpeg', fileName: 'selfie-center.jpg' },
    ],
  );
  const [capture] = api.captures;
  expect(api.uploads.map(({ fields }) => fields)).toEqual([
    // C153.2 (Workflow 9A): each upload says how its photo was taken, before the file.
    ['kind', 'capture-method', 'file'],
    ['kind', 'capture-method', 'file'],
    // C40.3: the capture fields come before the file.
    ['kind', 'capture-id', 'nonce', 'client-elapsed-ms', 'capture-method', 'file'],
  ]);
  expect(api.uploads[2]).toMatchObject({ captureId: capture?.id, nonce: capture?.nonce });
  expect(api.submits.at(-1)?.body?.capture).toMatchObject({
    id: capture?.id,
    nonce: capture?.nonce,
    device: { webdriver: true, 'image-mirrored': false },
  });
  expect(api.verifications.map(({ type, status }) => [type, status])).toEqual([
    ['verification/government-id', 'passed'],
    ['verification/selfie', 'passed'],
  ]);
  for (const request of api.requests) {
    expect(request.authorization).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(request.url).not.toContain(SESSION_TOKEN);
    expect(request.referer).toBeUndefined();
    expect(request.cookie).toBeUndefined();
  }
  expect(errors).toEqual([]);
});

test('shows retry hints and counts attempts after a failed attempt', async ({ page }) => {
  const api = new MockFlowApi();
  api.consent = { textKeys: ['consent.biometric', 'consent.processing'], locale: 'en' };
  api.decisions.push({
    status: 'failed',
    hints: [{ name: 'id_glare_detection', reasons: ['glare_present'] }],
  });
  await api.install(page);
  await page.goto(flowLink());

  await expect(page.getByText('Attempt 1 of 3')).toBeVisible();
  await uploadId(page);

  await expect(page.getByText('Attempt 2 of 3')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('There was glare on your ID.');
  await uploadId(page);

  await expect(page.getByRole('heading', { level: 1, name: 'Take a selfie' })).toBeVisible();
  expect(api.verifications.map(({ status }) => status)).toEqual(['failed', 'passed']);
});

test('stops at a step this version cannot run instead of skipping it', async ({ page }) => {
  const api = new MockFlowApi();
  const flow = defaultFlow();
  flow.steps.splice(1, 0, {
    id: 'details',
    type: 'form',
    fields: [{ type: 'text', name: 'name_first', labelKey: 'form.name_first', required: true }],
  });
  api.flow = flow;
  await api.install(page);
  await page.goto(flowLink());

  await giveConsent(page);

  await expect(
    page.getByRole('heading', { level: 1, name: 'This step is not available here' }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('a form');
  expect(api.verifications).toEqual([]);
});

test('resumes after a reload without the link in the address bar', async ({ page }) => {
  const api = new MockFlowApi();
  await api.install(page);
  await page.goto(flowLink());
  await giveConsent(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Photograph your ID' })).toBeVisible();

  await page.reload();

  await expect(page.getByRole('heading', { level: 1, name: 'Photograph your ID' })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test('explains a missing link without calling the API', async ({ page }) => {
  const api = new MockFlowApi();
  await api.install(page);

  await page.goto('/');

  await expect(
    page.getByRole('heading', { level: 1, name: 'We could not open your verification' }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('The link is missing or incomplete.');
  expect(api.requests).toEqual([]);
});

test('explains a malformed link and clears it from the address bar', async ({ page }) => {
  await page.goto(flowLink('ovs_not-a-real-token'));

  await expect(page.getByRole('alert')).toContainText('This verification link is not valid.');
  await expect(page).toHaveURL(/\/$/);
});

test('serves a Content-Security-Policy that allows only the API origin', async ({ page }) => {
  await page.goto('/');

  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(policy).toContain("default-src 'self'");
  // C46.1: the face guidance compiles its WebAssembly from the flow's own origin, and only that.
  expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(policy).not.toMatch(/'unsafe-eval'|'unsafe-inline'/);
  expect(policy).toContain(`connect-src 'self' ${API_ORIGIN}`);
  expect(policy).toContain("img-src 'self' blob: data:");
  expect(policy).toContain("media-src 'self' blob:");
  expect(policy).toContain("object-src 'none'");
  expect(policy).toContain("base-uri 'none'");
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
});

test('outlines the language select with the control colour of the built CSS (Workflow 2D F010, 2E E002)', async ({
  page,
}) => {
  await page.goto('/');

  const colours = await page.getByRole('combobox', { name: 'Language' }).evaluate((select) => {
    const root = getComputedStyle(document.documentElement);
    // A probe whose colour is an undefined property inherits the page's text colour, so each
    // property is read on the root first: '' when the built CSS does not define it.
    const resolve = (property: string): { readonly value: string; readonly colour: string } => {
      const value = root.getPropertyValue(property).trim();
      const probe = document.createElement('span');
      probe.style.color = `var(${property})`;
      document.body.append(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return { value, colour };
    };
    return {
      border: getComputedStyle(select).borderTopColor,
      control: resolve('--color-control'),
      line: resolve('--color-line'),
    };
  });

  expect(colours.control.value).not.toBe('');
  expect(colours.line.value).not.toBe('');
  expect(colours.border).toBe(colours.control.colour);
  // The decorative separator colour is too faint for a control (1.47:1, WCAG 1.4.11).
  expect(colours.border).not.toBe(colours.line.colour);
});

test('runs in Spanish when asked to', async ({ page }) => {
  const api = new MockFlowApi();
  await api.install(page);

  await page.goto(`/?lang=es${flowLink()}`.replace('/#', '#'));

  await expect(
    page.getByRole('heading', { level: 1, name: 'Consentimiento para usar tus datos biométricos' }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
});

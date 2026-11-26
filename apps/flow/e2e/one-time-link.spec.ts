/**
 * C19 one-time links in the browser, against the mocked API: the link is redeemed once, its
 * session lives in memory only, and a used link or a reload is explained without a retry.
 */
import { expect, test } from '@playwright/test';
import { giveConsent, heading, storedInTab, uploadId } from './support/flow-steps';
import {
  MockFlowApi,
  ONE_TIME_TOKEN,
  REDEEM_PATH,
  SESSION_TOKEN,
  oneTimeLink,
} from './support/mock-flow-api';

test('redeems a one-time link once and runs the flow with a session kept in memory', async ({
  page,
}) => {
  const api = new MockFlowApi();
  await api.install(page);

  await page.goto(oneTimeLink());

  // The link leaves the address bar at once.
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  await giveConsent(page);
  await uploadId(page);
  await expect(heading(page, 'Take a selfie')).toBeVisible();

  const redeems = api.requests.filter((request) => request.path === REDEEM_PATH);
  expect(redeems).toHaveLength(1);
  expect(redeems[0]?.authorization).toBeUndefined();
  for (const request of api.requests.filter((r) => r.path !== REDEEM_PATH)) {
    expect(request.authorization).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(request.url).not.toContain(SESSION_TOKEN);
  }
  expect(api.requests.every((request) => !request.url.includes(ONE_TIME_TOKEN))).toBe(true);
  // Nothing secret is stored in the tab.
  const stored = await storedInTab(page);
  expect(stored).not.toContain(SESSION_TOKEN);
  expect(stored).not.toContain(ONE_TIME_TOKEN);
});

test('opening a used link again shows the used-link screen, with no retry', async ({ page }) => {
  const api = new MockFlowApi();
  await api.install(page);
  await page.goto(oneTimeLink());
  await expect(heading(page, 'Consent to use your biometric data')).toBeVisible();

  await page.goto('about:blank');
  await page.goto(oneTimeLink());

  await expect(heading(page, 'We could not open your verification')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('This link has already been used');
  await expect(page.getByRole('button')).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
});

test('a reload after a one-time link explains why it cannot resume', async ({ page }) => {
  const api = new MockFlowApi();
  await api.install(page);
  await page.goto(oneTimeLink());
  await expect(heading(page, 'Consent to use your biometric data')).toBeVisible();
  const requests = api.requests.length;

  await page.reload();

  await expect(page.getByRole('alert')).toContainText('opened from a one-time link');
  expect(api.requests).toHaveLength(requests);
});

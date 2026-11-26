/**
 * 1B F018 in the browser, against the mocked API: a request that never answers ends after its
 * deadline as the usual recoverable error, and the retry works. A retried one-time link (2D
 * F016) and a retried session load (2E follow-up) keep focus on Try again while they run, then
 * move it to the next screen's heading.
 */
import { expect, test } from '@playwright/test';
import { heading } from './support/flow-steps';
import { MockFlowApi, REDEEM_PATH, flowLink, oneTimeLink } from './support/mock-flow-api';

test('a session request that never answers becomes a recoverable error', async ({ page }) => {
  await page.clock.install();
  const api = new MockFlowApi();
  api.hang.push('GET /session');
  await api.install(page);
  await page.goto(flowLink());
  await expect(page.getByRole('status')).toContainText('Loading your verification');

  await page.clock.fastForward(30_000);

  await expect(heading(page, 'Something went wrong')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('took too long to answer');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(heading(page, 'Consent to use your biometric data')).toBeVisible();
});

test('a one-time link redeem that never answers can be retried', async ({ page }) => {
  await page.clock.install();
  const api = new MockFlowApi();
  api.hang.push('POST /one-time-links/redeem');
  await api.install(page);
  await page.goto(oneTimeLink());
  await expect(page.getByRole('status')).toContainText('Loading your verification');

  await page.clock.fastForward(30_000);

  await expect(page.getByRole('alert')).toContainText('took too long to answer');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(heading(page, 'Consent to use your biometric data')).toBeVisible();
});

test('a retried one-time link keeps focus on Try again, then moves it to the next heading (2D F016)', async ({
  page,
}) => {
  await page.clock.install();
  const api = new MockFlowApi();
  api.hang.push('POST /one-time-links/redeem', 'POST /one-time-links/redeem');
  await api.install(page);
  const redeems = () => api.requests.filter((request) => request.path === REDEEM_PATH).length;
  await page.goto(oneTimeLink());
  await expect.poll(redeems).toBe(1);
  await page.clock.fastForward(30_000);
  await expect(heading(page, 'Something went wrong')).toBeFocused();

  const retry = page.getByRole('button', { name: 'Try again' });
  await retry.click();

  await expect(retry).toBeFocused();
  await expect(retry).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('status')).toContainText('Loading your verification');
  await expect.poll(redeems).toBe(2);

  await page.clock.fastForward(30_000);

  await expect(heading(page, 'Something went wrong')).toBeFocused();
  await retry.click();
  await expect(heading(page, 'Consent to use your biometric data')).toBeFocused();
  expect(redeems()).toBe(3);
});

test('a retried session load keeps focus on Try again, then moves it to the next heading (2E follow-up)', async ({
  page,
}) => {
  await page.clock.install();
  const api = new MockFlowApi();
  api.hang.push('GET /session', 'GET /session');
  await api.install(page);
  const loads = () =>
    api.requests.filter((request) => request.path === '/api/v1/flow/session').length;
  await page.goto(flowLink());
  await expect.poll(loads).toBe(1);
  await page.clock.fastForward(30_000);
  await expect(heading(page, 'Something went wrong')).toBeFocused();

  const retry = page.getByRole('button', { name: 'Try again' });
  await retry.click();

  await expect(retry).toBeFocused();
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('Try again');
  await expect(retry).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('status')).toContainText('Loading your verification');
  await expect.poll(loads).toBe(2);

  await page.clock.fastForward(30_000);

  await expect(heading(page, 'Something went wrong')).toBeFocused();
  await retry.click();
  await expect(heading(page, 'Consent to use your biometric data')).toBeFocused();
  expect(loads()).toBe(3);
});

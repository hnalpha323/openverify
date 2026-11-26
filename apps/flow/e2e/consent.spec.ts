import { expect, test } from '@playwright/test';
import { MockFlowApi, flowLink } from './support/mock-flow-api';

// Phase 0 smoke test, adapted for Phase 1: the flow now starts from a link carrying a session
// token, and the step after consent comes from the server (here, the government ID step).
test('loads the consent screen and continues only after consent', async ({ page }) => {
  const api = new MockFlowApi();
  await api.install(page);

  await page.goto(flowLink());

  await expect(page).toHaveURL(/\/$/);
  // C161.2 (Workflow 9A): `lang` names the full tag the browser asked for (Playwright's en-US).
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Consent to use your biometric data' }),
  ).toBeVisible();

  const continueButton = page.getByRole('button', { name: 'Continue' });
  await expect(continueButton).toBeDisabled();

  await page.getByRole('checkbox', { name: /^I agree/ }).check();
  await expect(continueButton).toBeEnabled();
  await continueButton.click();

  await expect(page.getByRole('heading', { level: 1, name: 'Photograph your ID' })).toBeVisible();
});

test('offers the optional matching consent, unticked, naming the retention days, and records it only when ticked (C42.3)', async ({
  page,
}) => {
  const api = new MockFlowApi();
  api.retentionDays = 90;
  await api.install(page);
  await page.goto(flowLink());

  const matching = page.getByRole('checkbox', { name: /^Optional: we also compare your selfie/ });
  await expect(matching).not.toBeChecked();
  await expect(matching).toHaveAccessibleName(/A template of your face is kept for 90 days\./);
  await matching.check();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /^I agree/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Photograph your ID' })).toBeVisible();
  expect(api.consent).toEqual({
    textKeys: ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
    optionalTextKeys: ['consent.biometric-matching'],
    locale: 'en',
  });
});

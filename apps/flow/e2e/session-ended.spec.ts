/**
 * C19 inactive sessions and redaction in the browser, against the mocked API: each ends the
 * flow on its own screen, without a retry. A canceled session's `reason` (C25.8) picks the
 * screen: the link-expired screen, the redacted screen, or the ended screen.
 */
import { expect, test } from '@playwright/test';
import { giveConsent, heading, uploadId } from './support/flow-steps';
import { MockFlowApi, flowLink } from './support/mock-flow-api';

test('an expired session shows the expired-session screen, with no retry', async ({ page }) => {
  const api = new MockFlowApi();
  api.sessionStatus = 'expired';
  await api.install(page);

  await page.goto(flowLink());

  await expect(heading(page, 'Your verification session has expired')).toBeVisible();
  await expect(page.getByRole('button')).toHaveCount(0);
});

test('a session canceled during the flow ends it at the next call', async ({ page }) => {
  const api = new MockFlowApi();
  await api.install(page);
  await page.goto(flowLink());
  await expect(heading(page, 'Consent to use your biometric data')).toBeVisible();

  api.sessionStatus = 'canceled';
  await giveConsent(page);

  await expect(heading(page, 'This verification session has ended')).toBeVisible();
  await expect(heading(page, 'This verification session has ended')).toBeFocused();
  await expect(page.getByRole('button')).toHaveCount(0);
  expect(api.consent).toBeNull();
});

test.describe('why a session was canceled (C25.8)', () => {
  test('an inquiry expired during the flow ends it on the link-expired screen', async ({
    page,
  }) => {
    const api = new MockFlowApi();
    await api.install(page);
    await page.goto(flowLink());
    await expect(heading(page, 'Consent to use your biometric data')).toBeVisible();

    api.sessionStatus = 'canceled';
    api.cancelReason = 'inquiry_expired';
    await giveConsent(page);

    await expect(heading(page, 'This verification link has expired')).toBeFocused();
    await expect(page.getByText('Ask the organization that sent it for a new link.')).toBeVisible();
    await expect(page.getByRole('button')).toHaveCount(0);
    expect(api.consent).toBeNull();
  });

  test('an inquiry redacted during the flow ends it on the redacted screen', async ({ page }) => {
    const api = new MockFlowApi();
    await api.install(page);
    await page.goto(flowLink());
    await giveConsent(page);
    await expect(heading(page, 'Photograph your ID')).toBeVisible();

    api.sessionStatus = 'canceled';
    api.cancelReason = 'inquiry_redacted';
    await uploadId(page);

    await expect(heading(page, 'This verification is no longer available')).toBeFocused();
    await expect(page.getByRole('button')).toHaveCount(0);
    expect(api.uploads).toEqual([]);
  });

  for (const reason of ['inquiry_finished', 'inquiry_archived_by_a_newer_server']) {
    test(`a session canceled with reason ${reason} ends on the ended screen`, async ({ page }) => {
      const api = new MockFlowApi();
      api.sessionStatus = 'canceled';
      api.cancelReason = reason;
      await api.install(page);

      await page.goto(flowLink());

      await expect(heading(page, 'This verification session has ended')).toBeVisible();
      await expect(page.getByRole('button')).toHaveCount(0);
    });
  }
});

test('a redacted inquiry ends the flow when a photo is sent (410)', async ({ page }) => {
  const api = new MockFlowApi();
  await api.install(page);
  await page.goto(flowLink());
  await giveConsent(page);

  api.redacted = true;
  await uploadId(page);

  await expect(heading(page, 'This verification is no longer available')).toBeVisible();
  await expect(page.getByRole('button')).toHaveCount(0);
  expect(api.uploads).toEqual([]);
});

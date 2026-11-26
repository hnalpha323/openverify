/** C19 sandbox in the browser, against the mocked API: a banner, and an uploaded selfie. */
import { expect, test } from '@playwright/test';
import { giveConsent, heading, uploadId, uploadSelfie } from './support/flow-steps';
import { MockFlowApi, flowLink } from './support/mock-flow-api';

test('a sandbox session shows its banner and takes an uploaded selfie', async ({ page }) => {
  const api = new MockFlowApi();
  api.environmentKind = 'sandbox';
  await api.install(page);
  await page.goto(flowLink());
  const banner = page.getByRole('note', { name: 'Sandbox' });

  await expect(banner).toContainText('This is a test verification.');
  await giveConsent(page);
  await expect(banner).toBeVisible();
  await uploadId(page);
  await uploadSelfie(page);

  await expect(heading(page, 'Verification submitted')).toBeVisible();
  await expect(banner).toBeVisible();
  expect(api.uploads.map(({ kind, mimeType }) => [kind, mimeType])).toEqual([
    ['front', 'image/png'],
    ['back', 'image/png'],
    ['selfie-center', 'image/png'],
  ]);
  // C46.1: the fallback still speaks C40, with a capture of method upload.
  expect(api.captures.map(({ method }) => method)).toEqual(['upload']);
});

test('a production session shows no banner and asks for a live selfie', async ({ page }) => {
  const api = new MockFlowApi();
  api.environmentKind = 'production';
  await api.install(page);
  await page.goto(flowLink());
  await giveConsent(page);
  await uploadId(page);

  await expect(heading(page, 'Take a selfie')).toBeVisible();
  await expect(page.getByRole('note', { name: 'Sandbox' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Upload photos' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start the camera' })).toBeVisible();
});

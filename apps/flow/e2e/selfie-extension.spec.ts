/**
 * C171.4 (WCAG 2.2.1; review H11; Workflow 9A, flow-renderer): 20 s before a selfie capture's limit
 * the flow says so in a live region and offers more time in one action; the person takes more time
 * ten times, then uploads, and the server takes the photo. The page's clock is moved by the spec.
 */
import { expect, test } from '@playwright/test';
import { expectAccessible } from './support/accessible';
import { heading } from './support/flow-steps';
import { MockFlowApi, PHASE5_CONSENT_GIVEN, flowLink, phase5Flow } from './support/mock-flow-api';
import { rendererScript } from './support/mock-flow-renderer';
import { syntheticCardPng } from './support/synthetic-png';

const SELFIE = {
  id: 'selfie',
  type: 'selfie',
  poses: ['center'],
  liveness: 'passive',
  maxAttempts: 3,
} as const;
const CAPTURE_MS = 180_000;
const PHOTO = { name: 'selfie.png', mimeType: 'image/png', buffer: syntheticCardPng() };

test('warns 20 seconds ahead, extends ten times, then takes the photo', async ({ page }) => {
  const start = Date.parse('2026-11-05T10:00:00.000Z');
  await page.clock.install({ time: start });
  const mock = new MockFlowApi();
  mock.environmentKind = 'sandbox';
  mock.consent = { ...PHASE5_CONSENT_GIVEN, textKeys: [...PHASE5_CONSENT_GIVEN.textKeys] };
  mock.flow = phase5Flow('selfie', { ...SELFIE, poses: [...SELFIE.poses] });
  await mock.install(page);
  await page.goto(flowLink());

  await expect(heading(page, 'Take a selfie')).toBeVisible();
  // From here the page's time moves only when the spec moves it: the capture opens at start + 30 s.
  await page.clock.pauseAt(start + 30_000);
  await page.getByRole('button', { name: 'Upload photos' }).click();
  await expect(page.getByLabel('Choose a selfie, looking straight ahead')).toBeAttached();

  await page.clock.runFor(CAPTURE_MS - 25_000);
  await expect(page.getByRole('button', { name: 'More time' })).toHaveCount(0);
  await page.clock.runFor(10_000);
  const warning = page.getByRole('alert').filter({ hasText: 'seconds left to take your photos' });
  await expect(warning).toBeVisible();
  // axe needs the page's timers: let time run for the check, then hold it again.
  await page.clock.resume();
  await expectAccessible(page, { where: 'selfie: the 2.2.1 warning (en)' });
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);

  for (let extension = 1; extension <= 10; extension += 1) {
    await page.getByRole('button', { name: 'More time' }).click();
    await expect(page.getByText('You have more time.')).toBeVisible();
    // 15 s before the limit as moved by this extension.
    await page.clock.runFor(CAPTURE_MS);
    if (extension < 10) {
      await expect(page.getByRole('button', { name: 'More time' })).toBeVisible();
    }
  }
  expect(rendererScript(mock).extensions).toHaveLength(10);

  await page.getByLabel('Choose a selfie, looking straight ahead').setInputFiles(PHOTO);
  await page.getByRole('button', { name: 'Use this photo' }).click();
  await expect.poll(() => mock.uploads.map(({ kind }) => kind)).toEqual(['selfie-center']);
  expect(mock.uploads[0]?.fields).toContain('capture-method');
});

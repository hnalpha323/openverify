/**
 * C150.5, C151.2, C158.5, C150.7 (Workflow 9A, flow-renderer): the positions that are not steps, at
 * the server's word: the waiting state read again every 2 s, a halted flow, the completion's
 * announcement and "Continue" (never a timed redirect, WCAG 2.2.1 F41), and the failed screen's
 * contest route; each state through axe in English at 320 CSS px light and Arabic at 320 CSS px dark.
 */
import { expect, test } from '@playwright/test';
import { expectAccessible } from './support/accessible';
import { at, rendererScript, serve, type ServedPosition } from './support/mock-flow-renderer';
import { DONE, openAt } from './support/screens';

const NARROW = { width: 320, height: 720 };
const WAITING: ServedPosition = { position: at('age_route', 'waiting', 'about') };
const REDIRECT = 'https://shop.example.com/verified?inquiry-id=inq_01M5CJXHG07XPHF3HRM6NREDH7';

test.describe('in English at 320 CSS px, light', () => {
  test.use({ viewport: NARROW, colorScheme: 'light' });

  test('the waiting state reads the session every 2 s until the server moves on (C150.5)', async ({
    page,
  }) => {
    const start = Date.parse('2026-11-05T10:00:00.000Z');
    await page.clock.install({ time: start });
    const mock = await openAt(page, WAITING);
    const script = rendererScript(mock);

    await expect(page.getByRole('heading', { level: 1, name: 'One moment' })).toBeVisible();
    await expectAccessible(page, { where: 'waiting (en, 320, light)' });
    // From here the page's time moves only when the test moves it.
    await page.clock.pauseAt(start + 60_000);
    await page.waitForTimeout(500);
    const before = script.declaredSpecs.length;
    await page.clock.runFor(1_900);
    await page.waitForTimeout(300);
    expect(script.declaredSpecs.length).toBe(before);
    await page.clock.runFor(100);
    await expect.poll(() => script.declaredSpecs.length).toBe(before + 1);
    await page.clock.runFor(2_000);
    await expect.poll(() => script.declaredSpecs.length).toBe(before + 2);

    serve(mock, DONE);
    await page.clock.runFor(2_000);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Verification submitted' }),
    ).toBeVisible();
  });

  test('a halted flow says it cannot continue (C151.2)', async ({ page }) => {
    await openAt(page, { position: at('again', 'halted', 'about') });

    await expect(
      page.getByRole('heading', { level: 1, name: 'This verification cannot continue' }),
    ).toBeVisible();
    await expectAccessible(page, { where: 'halted (en, 320, light)' });
  });

  test('the end is announced and the person goes back with Continue, never on a timer (C158.5)', async ({
    page,
  }) => {
    await page.clock.install();
    await openAt(page, { ...DONE, completion: { 'redirect-url': REDIRECT } });

    await expect(
      page.getByRole('heading', { level: 1, name: 'Verification submitted' }),
    ).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Your part is done.' })).toBeVisible();
    await expectAccessible(page, { where: 'completion with redirect (en, 320, light)' });
    const flowUrl = page.url();
    await page.clock.runFor(10 * 60_000);
    expect(page.url()).toBe(flowUrl);

    await page.route('https://shop.example.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Shop</title>' }),
    );
    await page.getByRole('link', { name: 'Continue' }).click();
    await expect(page).toHaveURL(REDIRECT);
  });

  test('the failed screen shows the contest route (C150.7)', async ({ page }) => {
    await openAt(page, {
      position: at('refused', 'ended', 'about'),
      step: { id: 'refused', type: 'failure' },
      'decision-contest-route': {
        url: 'https://help.example.com/review',
        host: 'help.example.com',
        contact: 'reviews@example.com',
      },
      inquiryStatus: 'failed',
    });

    await expect(
      page.getByRole('heading', { level: 1, name: 'Verification not completed' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ask for a review' })).toHaveAttribute(
      'href',
      'https://help.example.com/review',
    );
    await expectAccessible(page, { where: 'failure with contest route (en, 320, light)' });
  });
});

test.describe('in Arabic at 320 CSS px, dark', () => {
  test.use({ viewport: NARROW, colorScheme: 'dark' });

  test('the waiting, halted and redirect states', async ({ page }) => {
    const mock = await openAt(page, WAITING, { language: 'ar', styleVariant: 'dark' });

    await expect(page.getByRole('heading', { level: 1, name: 'لحظة من فضلك' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-openverify-variant', 'dark');
    await expectAccessible(page, { where: 'waiting (ar, 320, dark)' });

    serve(mock, { position: at('again', 'halted', 'about') });
    await expect(
      page.getByRole('heading', { level: 1, name: 'لا يمكن متابعة هذا التحقق' }),
    ).toBeVisible();
    await expectAccessible(page, { where: 'halted (ar, 320, dark)' });
  });

  test('the completion with its Continue', async ({ page }) => {
    await openAt(
      page,
      { ...DONE, completion: { 'redirect-url': REDIRECT } },
      { language: 'ar', styleVariant: 'dark' },
    );

    await expect(page.getByRole('link', { name: 'متابعة' })).toHaveAttribute('href', REDIRECT);
    await expect(page.locator('html')).toHaveAttribute('data-openverify-variant', 'dark');
    await expectAccessible(page, { where: 'completion with redirect (ar, 320, dark)' });
  });
});

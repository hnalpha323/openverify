/**
 * C207.10, C207.9 (Phase 10, Workflow 10C; `api-nfc`): the web flow at an `nfc` step, against the
 * mocked server (`support/mock-nfc.ts`). A browser cannot read a document chip: the screen says
 * that this step needs the organisation's app, never "a phone with NFC", and where the step's
 * client view has `fallbackAvailable` it offers "use another way", which reports
 * `platform_unsupported` through the client-unable route and then shows the position the server
 * moved to. It never says where the other way leads. Each state goes through axe, in English at
 * 320 CSS px light and in Arabic at 320 CSS px dark (Chromium only).
 */
import { expect, test } from '@playwright/test';
import { expectAccessible } from './support/accessible';
import { at, type ServedPosition } from './support/mock-flow-renderer';
import { nfcScript, nfcView } from './support/mock-nfc';
import { DONE, openAt } from './support/screens';

const NARROW = { width: 320, height: 720 };
const TITLE = 'This step needs the organization’s app';
const NEEDS_APP = 'Reading a document chip needs the organization’s app; a browser cannot read it.';

const atChip = (fallbackAvailable: boolean): ServedPosition => ({
  position: at('chip'),
  step: nfcView(fallbackAvailable),
});

/** The position after the fallback: the author's other step, here the end of the flow. */
const AFTER_FALLBACK: ServedPosition = { ...DONE, position: at('done', 'ended', 'chip') };

test.describe('in English at 320 CSS px, light', () => {
  test.use({ viewport: NARROW, colorScheme: 'light' });

  test('with a fallback, the screen offers "use another way" and reports platform_unsupported', async ({
    page,
  }) => {
    const mock = await openAt(page, atChip(true));
    const script = nfcScript(mock);
    script.fallbackTo = AFTER_FALLBACK;

    await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
    await expect(page.getByText(NEEDS_APP)).toBeVisible();
    await expect(page.locator('main')).not.toContainText(/phone with NFC/i);
    await expect(page.locator('main')).not.toContainText(/review/i);
    await expectAccessible(page, { where: 'nfc with a fallback (en, 320, light)' });
    // Nothing is asked of the server before the person chooses.
    expect(script.reports).toEqual([]);
    expect(script.verifications).toEqual([]);

    await page.getByRole('button', { name: 'Use another way' }).click();

    await expect(
      page.getByRole('heading', { level: 1, name: 'Verification submitted' }),
    ).toBeVisible();
    expect(script.verifications.map((one) => one.status)).toEqual(['canceled']);
    expect(script.reports).toEqual([
      { verificationId: script.verifications[0]?.id, body: { reason: 'platform_unsupported' } },
    ]);
  });

  test('without a fallback, the screen offers nothing but the organisation’s app', async ({
    page,
  }) => {
    const mock = await openAt(page, atChip(false));

    await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
    await expect(page.getByText(NEEDS_APP)).toBeVisible();
    await expect(page.getByText(/^Continue in the organization’s app\./)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Use another way' })).toHaveCount(0);
    await expectAccessible(page, { where: 'nfc without a fallback (en, 320, light)' });
    expect(nfcScript(mock).reports).toEqual([]);
  });

  test('a refused report shows an error, and the next try reuses the verification', async ({
    page,
  }) => {
    const mock = await openAt(page, atChip(true));
    const script = nfcScript(mock);
    script.fallbackTo = AFTER_FALLBACK;
    script.refuse = 1;

    await page.getByRole('button', { name: 'Use another way' }).click();

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Use another way' })).toBeEnabled();
    await expectAccessible(page, { where: 'nfc after a refused report (en, 320, light)' });

    await page.getByRole('button', { name: 'Use another way' }).click();

    await expect(
      page.getByRole('heading', { level: 1, name: 'Verification submitted' }),
    ).toBeVisible();
    expect(script.verifications).toHaveLength(1);
    expect(script.reports.map((report) => report.verificationId)).toEqual([
      script.verifications[0]?.id,
      script.verifications[0]?.id,
    ]);
  });
});

test.describe('in Arabic at 320 CSS px, dark', () => {
  test.use({ viewport: NARROW, colorScheme: 'dark' });

  test('the screen reads right to left and takes the other way', async ({ page }) => {
    const mock = await openAt(page, atChip(true), { language: 'ar', styleVariant: 'dark' });
    const script = nfcScript(mock);
    script.fallbackTo = AFTER_FALLBACK;

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(
      page.getByRole('heading', { level: 1, name: 'تتطلب هذه الخطوة تطبيق الجهة' }),
    ).toBeVisible();
    await expectAccessible(page, { where: 'nfc with a fallback (ar, 320, dark)' });

    await page.getByRole('button', { name: 'استخدام طريقة أخرى' }).click();

    await expect.poll(() => script.reports.length).toBe(1);
    expect(script.reports[0]?.body).toEqual({ reason: 'platform_unsupported' });
  });
});

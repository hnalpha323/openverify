/**
 * C161.3, C161.4 (Workflow 9A, flow-renderer): Arabic, right to left, in the built flow: the page's
 * direction, the icons (only directional ones mirror; the QR code never does), and a phone number and
 * a code typed in Arabic-Indic digits reaching the server in ASCII; each state through axe at 320 CSS px
 * in the built-in dark palette (`style-variant=dark`, Workflow 9D).
 */
import { expect, test } from '@playwright/test';
import { expectAccessible } from './support/accessible';
import { INQUIRY_ID, defaultFlow, phase5Flow } from './support/mock-flow-api';
import { at } from './support/mock-flow-renderer';
import { openAt } from './support/screens';

test.use({ viewport: { width: 320, height: 720 }, colorScheme: 'dark' });

const PHONE = { id: 'phone', type: 'phone_otp', allowedCountries: ['US'] } as const;
const DIRECTIONAL = new Set(['back', 'next', 'chevron-start', 'chevron-end']);

test('a phone number and a code typed in Arabic-Indic digits reach the server in ASCII', async ({
  page,
}) => {
  const mock = await openAt(
    page,
    { position: at('phone'), step: PHONE },
    {
      language: 'ar',
      styleVariant: 'dark',
      flow: phase5Flow('rtl', { ...PHONE, allowedCountries: ['US'] }),
    },
  );

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expectAccessible(page, { where: 'phone (ar, 320, dark)' });
  await page.getByRole('textbox', { name: 'رقم الهاتف' }).fill('٢٠٢٥٥٥٠١٤٣');
  await page.getByRole('button', { name: 'إرسال الرمز' }).click();

  const code = page.getByRole('textbox', { name: 'الرمز' });
  await expect(code).toBeVisible();
  await expectAccessible(page, { where: 'code (ar, 320, dark)' });
  await code.fill(
    mock.otpCode.replace(/\d/gu, (digit) => String.fromCodePoint(0x0660 + Number(digit))),
  );
  await expect(code).toHaveValue(mock.otpCode);
  await page.getByRole('button', { name: 'تأكيد', exact: true }).click();

  await expect
    .poll(() => mock.otpConfirms.map(({ body }) => body))
    .toEqual([{ code: mock.otpCode }]);
  expect(mock.otpSends.map(({ body }) => body)).toEqual([{ 'phone-number': '+12025550143' }]);
});

test('only directional icons mirror: the QR code of a handoff never does', async ({ page }) => {
  const flow = defaultFlow();
  const [consent, ...rest] = flow.steps;
  flow.steps = [consent ?? {}, { id: 'device_handoff', type: 'device_handoff' }, ...rest];
  await openAt(
    page,
    { position: at('device_handoff'), step: { id: 'device_handoff', type: 'device_handoff' } },
    {
      language: 'ar',
      styleVariant: 'dark',
      flow,
      configure: (mock) => {
        mock.handoff = { 'step-id': 'device_handoff', state: 'pending' };
        mock.handoffAnswers.issue = {
          status: 201,
          body: {
            id: 'hnd_01M5CK16P0D13FXHZSS4TCFBVH',
            method: 'qr',
            'expires-at': new Date(Date.now() + 300_000).toISOString(),
            'url-fragment': `#inquiry-id=${INQUIRY_ID}&handoff-token=ovh_${'E2eSyntheticHandoffToken'.padEnd(43, 'x')}`,
          },
        };
        mock.handoffAnswers.current = {
          status: 200,
          body: { status: 'issued', 'redeemed-at': null, 'os-name': null, 'browser-name': null },
        };
      },
    },
  );

  const icons = page.locator('svg[data-icon]');
  await expect(icons.first()).toBeVisible();
  const kinds = await icons.evaluateAll((svgs) =>
    svgs.map((svg) => ({
      kind: svg.getAttribute('data-icon') ?? '',
      mirrored: svg.getAttribute('class')?.includes('rtl:-scale-x-100') ?? false,
    })),
  );
  expect(kinds.length).toBeGreaterThan(0);
  for (const { kind, mirrored } of kinds) {
    expect(mirrored, kind).toBe(DIRECTIONAL.has(kind));
  }
  await expectAccessible(page, { where: 'handoff (ar, 320, dark)' });
});

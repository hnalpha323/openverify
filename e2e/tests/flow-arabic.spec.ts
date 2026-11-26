/**
 * C178.4, C161 (Workflow 9A): an Arabic flow on the full stack, right to left, with the code typed
 * in Arabic-Indic digits. Budget: 90 s.
 *
 * A flow-spec 2 version enables `en` and `ar` (machine-drafted, so sandbox only warns, C161.5):
 * consent, an email confirmation, completion. The hosted flow is opened with `language=ar-EG` in
 * its fragment: the page is `lang="ar-EG"` and `dir="rtl"`, every heading and control reads the
 * Arabic catalog (`contracts/fixtures/i18n/ar.json`), axe finds no WCAG A or AA violation on the
 * Arabic consent screen, and the six-digit code Mailpit received is typed as Arabic-Indic digits,
 * which the field turns into ASCII as they are typed (C161.4), so the address is confirmed and the
 * inquiry completes. The browser presents a documentation address of its own for the OTP send
 * (the stack's `otp-ip-hour` limit, e2e/README.md). Every value is synthetic.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_EMAIL_ADDRESS_CHECKS } from '@openverify/contracts';
import { expect, test } from '@playwright/test';
import { waitForMail } from '../src/mailpit.js';
import { REPO_ROOT } from '../src/paths.js';
import { readStackInfo } from '../src/stack-info.js';
import { expectAccessible } from './support/accessible.js';
import {
  consentStep,
  publishV2,
  settledInquiry,
  signedInAdmin,
  startV2Inquiry,
} from './support/flow-v2.js';
import { presentAddress } from './support/network.js';
import { typeConfig } from './support/phase5.js';

/** A documentation address of the sandbox's residential range: no listed risk (C93.5). */
const ADDRESS = '198.51.100.77';

/** The Arabic catalog the flow ships, flattened to dotted keys (C161.8's export). */
function arabic(): Readonly<Record<string, string>> {
  const exported = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'contracts/fixtures/i18n/ar.json'), 'utf8'),
  ) as { messages: Record<string, unknown> };
  const flat: Record<string, string> = {};
  const walk = (node: unknown, prefix: string) => {
    if (typeof node === 'string') {
      flat[prefix] = node;
    } else if (node !== null && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        walk(value, prefix === '' ? key : `${prefix}.${key}`);
      }
    }
  };
  walk(exported.messages, '');
  return flat;
}

/** ASCII digits as Arabic-Indic digits (U+0660 to U+0669). */
const arabicIndic = (digits: string): string =>
  digits.replace(/[0-9]/gu, (digit) => String.fromCodePoint(0x0660 + Number(digit)));

test('an Arabic flow runs right to left and takes a code typed in Arabic-Indic digits (C161.1-C161.4)', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const ar = arabic();
  const text = (key: string): string => {
    const value = ar[key];
    if (value === undefined) throw new Error(`no Arabic text for ${key}`);
    return value;
  };
  const run = randomUUID().slice(0, 8);
  const admin = await signedInAdmin(stack);
  const template = await publishV2(
    stack,
    admin,
    `e2e arabic ${run}`,
    {
      metadata: { specVersion: 2, id: `e2e-arabic-${run}`, version: 1, name: 'Arabic' },
      entry: 'consent',
      steps: [
        consentStep(),
        { id: 'email', type: 'email_otp' },
        { id: 'done', type: 'completion' },
      ],
      edges: [
        { id: 'e1', from: 'consent', port: 'next', to: 'email' },
        { id: 'e2', from: 'email', port: 'next', to: 'done' },
      ],
    },
    {
      'verification-config': { 'email-address': typeConfig(DEFAULT_EMAIL_ADDRESS_CHECKS) },
      'enabled-locales': ['en', 'ar'],
      'default-locale': 'en',
    },
  );
  const started = await startV2Inquiry(stack, template.templateId, `e2e-arabic-${run}`);
  const context = await browser.newContext();
  await presentAddress(context, stack.apiUrl, ADDRESS);
  const page = await context.newPage();
  try {
    await page.goto(`${started.flowUrl}&language=ar-EG`);
    await expect(
      page.getByRole('heading', { level: 1, name: text('consent.title') }),
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar-EG');
    await expectAccessible(page, { where: 'the Arabic consent screen' });
    await page.getByRole('checkbox', { name: text('consent.checkbox') }).check();
    await page.getByRole('button', { name: text('consent.continue') }).click();

    await expect(
      page.getByRole('heading', { level: 1, name: text('otp.email.title') }),
    ).toBeVisible();
    // Synthetic: `.test` is reserved (RFC 2606); the local part is this run's.
    const address = `e2e-ar-${run}@disposable.test`;
    await page.getByLabel(text('otp.email.address'), { exact: true }).fill(address);
    await page.getByRole('button', { name: text('otp.send') }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: text('otp.code.title') }),
    ).toBeVisible();

    const mail = await waitForMail(stack.mailpitUrl, address, { timeoutMs: 30_000 });
    const code = /(\d{6})/u.exec(mail.text)?.[1] ?? '';
    expect(code).toMatch(/^\d{6}$/u);
    const field = page.getByLabel(text('otp.code.label'), { exact: true });
    await field.pressSequentially(arabicIndic(code));
    // C161.4: the digits are ASCII as soon as they are typed.
    await expect(field).toHaveValue(code);
    await page.getByRole('button', { name: text('otp.code.confirm') }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: text('completion.title') }),
    ).toBeVisible({ timeout: 60_000 });
  } finally {
    await context.close();
  }
  await settledInquiry(stack, started.inquiryId, ['completed']);
});

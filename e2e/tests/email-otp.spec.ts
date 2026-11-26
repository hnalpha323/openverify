/**
 * C55, C56, C65.5 (Workflow 5A): an email address confirmed with a one-time code, full stack. The
 * template's email step keeps its default checks, with the advisory disposable check denying
 * `disposable.test` (`deny-domains`). The end user enters an address at that domain in the hosted
 * flow; the API sends the code through the stack's mailer to Mailpit (a `.test` domain is
 * reserved in a sandbox environment, so the MX check makes no DNS query, C56), the user enters
 * it, and the confirmed code is submitted at once. The required OTP comparison passes, the
 * advisory disposable check fails with `disposable_domain`, and the verification and its inquiry
 * still pass: an advisory failure never decides (C30.1). The code is in no document or event.
 */
import { randomUUID } from 'node:crypto';
import { DEFAULT_EMAIL_ADDRESS_CHECKS } from '@openverify/contracts';
import { isVerificationOfType } from '@openverify/node';
import { expect, test } from '@playwright/test';
import { waitForMail } from '../src/mailpit.js';
import { readStackInfo } from '../src/stack-info.js';
import { startWebhookReceiver } from '../src/webhook-receiver.js';
import { collectConsoleErrors, giveConsent } from './support/flow.js';
import { phase5Template, startInquiry, typeConfig } from './support/phase5.js';
import { createServerApi } from './support/server-api.js';
import { verifyDelivery, waitForEvent } from './support/webhooks.js';

test('an email address at a denied disposable domain is confirmed with the code Mailpit received, and passes on its required check (C55, C56, C65.5)', async ({
  page,
}) => {
  const stack = readStackInfo();
  const api = createServerApi(stack.apiUrl, stack.apiKey);
  const receiver = await startWebhookReceiver();
  const webhook = await api.createWebhook(receiver.url, ['*']);
  try {
    const run = randomUUID();
    // Synthetic: `.test` is reserved (RFC 2606); the local part is this run's.
    const address = `e2e-${run.slice(0, 8)}@disposable.test`;
    const { inquiryId, flowUrl } = await startInquiry(
      stack,
      phase5Template(`e2e-email-otp-${run}`, [{ id: 'email', type: 'email_otp' }], {
        'email-address': typeConfig(DEFAULT_EMAIL_ADDRESS_CHECKS, {
          email_address_disposable_detection: {
            enabled: true,
            required: false,
            config: { 'deny-domains': ['disposable.test'] },
          },
        }),
      }),
      `e2e-email-otp-${run}`,
    );

    // The end user.
    const errors = collectConsoleErrors(page);
    await page.goto(flowUrl);
    await giveConsent(page);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Confirm your email address' }),
    ).toBeVisible();
    await page.getByLabel('Email address', { exact: true }).fill(address);
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Enter the code' })).toBeVisible();
    // C52.2: the flow shows the address masked.
    await expect(page.getByRole('main')).not.toContainText(address);

    // The code, from the email Mailpit received: plain text, no link (C55.9).
    const mail = await waitForMail(stack.mailpitUrl, address, { timeoutMs: 30_000 });
    expect(mail.subject).toMatch(/verification code$/u);
    const code = /Your verification code is (\d{6})\./u.exec(mail.text)?.[1] ?? '';
    expect(code).toMatch(/^\d{6}$/u);
    expect(mail.text).not.toMatch(/https?:\/\//u);
    await page.getByLabel('Code', { exact: true }).fill(code);
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Verification submitted' }),
    ).toBeVisible({ timeout: 60_000 });
    expect(errors).toEqual([]);

    // The result: the required comparison passed, the advisory disposable check failed.
    const completed = await waitForEvent(receiver, 'inquiry.completed', inquiryId);
    expect(verifyDelivery(completed, webhook.attributes.secret)).toBeGreaterThan(0);
    const document = await api.getInquiry(inquiryId);
    expect(document.data.attributes.status).toBe('completed');
    const [verification] = document.included ?? [];
    if (
      verification === undefined ||
      !isVerificationOfType(verification, 'verification/email-address')
    ) {
      throw new Error(`The inquiry holds no email verification: ${JSON.stringify(document)}`);
    }
    expect(verification.attributes).toMatchObject({
      status: 'passed',
      'email-address': address,
      sends: 1,
      'failed-attempts': 0,
    });
    const checks = Object.fromEntries(
      verification.attributes.checks.map((check) => [check.name, check]),
    );
    expect(checks.email_address_otp_comparison).toMatchObject({
      status: 'passed',
      requirement: 'required',
      metadata: { channel: 'email', sends: 1, 'failed-attempts': 0 },
    });
    expect(checks.email_address_disposable_detection).toMatchObject({
      status: 'failed',
      requirement: 'not_required',
      reasons: ['disposable_domain'],
      metadata: { match: 'denied' },
    });
    // C56: a reserved sandbox name takes mail without a DNS query.
    expect(checks.email_address_mx_detection).toMatchObject({
      status: 'passed',
      metadata: { route: 'reserved' },
    });
    // C51.4: no check copies the address; C55.12: the code is nowhere.
    expect(JSON.stringify(verification.attributes.checks)).not.toContain(address);
    expect(JSON.stringify(document)).not.toContain(`"${code}"`);
    expect(completed.request.body).not.toContain(`"${code}"`);
  } finally {
    await api.disableWebhook(webhook.id);
    await receiver.close();
  }
});

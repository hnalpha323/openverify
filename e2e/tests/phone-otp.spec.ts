/**
 * C55, C56, C65.5 (Workflow 5A): a phone number confirmed with a one-time code, full stack. A
 * customer backend makes a template with one phone step and its default checks, and an inquiry;
 * the end user enters a synthetic US number in the hosted flow, and the sandbox SMS sender (bound
 * for sandbox environments in the e2e stack, C63) keeps the code in its sink instead of sending
 * it. A test harness reads the code with a `sandbox:read` key (C55.11); the user first types a
 * wrong code (one try is counted), then the right one, and the confirmed code is submitted at
 * once. The worker judges `phone_number_otp_comparison` passed, a signed `verification.passed`
 * and `inquiry.completed` arrive, the customer reads the number unmasked, and in the console a
 * viewer (no `pii:view`) sees it hidden while a reviewer reads it. The code itself appears in no
 * event, document or console page. Cooldowns, limits and expiry are covered by Testcontainers and
 * the mocked flow suite; this spec sends one code from 127.0.0.1 (C65.5).
 */
import { randomUUID } from 'node:crypto';
import { DEFAULT_PHONE_NUMBER_CHECKS } from '@openverify/contracts';
import { isVerificationOfType } from '@openverify/node';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { startWebhookReceiver } from '../src/webhook-receiver.js';
import { collectConsoleErrors, giveConsent } from './support/flow.js';
import {
  evidenceValue,
  newestSandboxSmsCode,
  phase5Template,
  startInquiry,
  typeConfig,
  wrongCode,
} from './support/phase5.js';
import { createServerApi } from './support/server-api.js';
import { signInAs } from './support/ui.js';
import { verifyDelivery, waitForEvent } from './support/webhooks.js';

/** Synthetic: the NANP 555-01xx range is kept for fiction; no one holds this number. */
const PHONE_NUMBER = '+12025550147';

test('a phone number is confirmed with the code the sandbox sender kept, after one wrong code (C55, C65.5)', async ({
  page,
  browser,
}) => {
  const stack = readStackInfo();
  const api = createServerApi(stack.apiUrl, stack.apiKey);
  const receiver = await startWebhookReceiver();
  const webhook = await api.createWebhook(receiver.url, ['*']);
  try {
    const run = randomUUID();
    const { inquiryId, flowUrl } = await startInquiry(
      stack,
      phase5Template(
        `e2e-phone-otp-${run}`,
        [{ id: 'phone', type: 'phone_otp', allowedCountries: ['US'] }],
        { 'phone-number': typeConfig(DEFAULT_PHONE_NUMBER_CHECKS) },
      ),
      `e2e-phone-otp-${run}`,
    );

    // The end user: the number in national form, the country being the only one allowed.
    const errors = collectConsoleErrors(page);
    await page.goto(flowUrl);
    await giveConsent(page);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Confirm your phone number' }),
    ).toBeVisible();
    await page.getByLabel('Phone number', { exact: true }).fill('202 555 0147');
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Enter the code' })).toBeVisible();
    // C52.2: the flow shows the destination masked, never whole.
    await expect(page.getByText(/^We sent a code to \+1 \D*0147\.$/u)).toBeVisible();
    await expect(page.getByRole('main')).not.toContainText('555 0147');

    // The code, from the sandbox sink.
    const code = await newestSandboxSmsCode(stack, PHONE_NUMBER);
    expect(code).toMatch(/^\d{6}$/u);
    const codeField = page.getByLabel('Code', { exact: true });
    await codeField.fill(wrongCode(code));
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('That code is not correct. Check it and try again.')).toBeVisible();
    await expect(page.getByText('Tries left for this code: 4')).toBeVisible();
    await codeField.fill(code);
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Verification submitted' }),
    ).toBeVisible({ timeout: 60_000 });
    // The wrong code's 422 (C55.5 `otp_incorrect`) is the one failed request, as Chromium logs it.
    expect(errors).toEqual([
      'Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)',
    ]);

    // The customer's endpoint: a signed verification.passed, then inquiry.completed.
    const completed = await waitForEvent(receiver, 'inquiry.completed', inquiryId);
    expect(verifyDelivery(completed, webhook.attributes.secret)).toBeGreaterThan(0);
    const document = await api.getInquiry(inquiryId);
    expect(document.data.attributes.status).toBe('completed');
    const [verification] = document.included ?? [];
    if (
      verification === undefined ||
      !isVerificationOfType(verification, 'verification/phone-number')
    ) {
      throw new Error(
        `The inquiry holds no phone number verification: ${JSON.stringify(document)}`,
      );
    }
    const passed = await waitForEvent(receiver, 'verification.passed', verification.id);
    expect(verifyDelivery(passed, webhook.attributes.secret)).toBeGreaterThan(0);

    // C52.8, C56: the key reads the number; one send, one wrong entry, the code confirmed.
    expect(verification.attributes).toMatchObject({
      status: 'passed',
      'phone-number': PHONE_NUMBER,
      sends: 1,
      'failed-attempts': 1,
      'confirmed-at': expect.any(String),
    });
    const comparison = verification.attributes.checks.find(
      (check) => check.name === 'phone_number_otp_comparison',
    );
    expect(comparison).toMatchObject({
      status: 'passed',
      requirement: 'required',
      metadata: { channel: 'sms', sends: 1, 'failed-attempts': 1 },
    });
    // C55.12: the code is in no document or event (searched as a JSON string of its own).
    for (const text of [JSON.stringify(document), passed.request.body, completed.request.body]) {
      expect(text).not.toContain(`"${code}"`);
    }

    // The console: a viewer sees the number hidden, a reviewer reads it.
    const verificationUrl = `${stack.dashboardUrl}/verifications/${verification.id}`;
    const viewerContext = await browser.newContext();
    try {
      const viewer = await viewerContext.newPage();
      await signInAs(viewer, stack, 'viewer');
      await viewer.goto(verificationUrl);
      await expect(viewer.getByRole('heading', { level: 1 })).toContainText(
        `Phone number verification ${verification.id}`,
      );
      await expect(
        evidenceValue(viewer, 'Phone number', 'Phone number').getByText('Hidden', { exact: true }),
      ).toBeVisible();
      await expect(viewer.getByRole('main')).not.toContainText('5550147');
    } finally {
      await viewerContext.close();
    }
    await signInAs(page, stack, 'reviewer');
    await page.goto(verificationUrl);
    await expect(evidenceValue(page, 'Phone number', 'Phone number')).toHaveText(PHONE_NUMBER);
    await expect(page.getByRole('main')).not.toContainText(code);
  } finally {
    await api.disableWebhook(webhook.id);
    await receiver.close();
  }
});

/**
 * C96.8 (Workflow 7A): device handoff by QR across two browser contexts, full stack. Budget: 90 s
 * per test.
 *
 * The environment's `organization-display-name` is set (the phone's context screen shows it, and a
 * template with a `device_handoff` step needs it to publish). The template: consent, the handoff
 * step (QR, the default), then the database step. The desktop reaches the API from `203.0.113.10`
 * and the phone from `203.0.113.200`, two fictional points of the sandbox network (C93.6), through
 * the stack's trusted proxy.
 *
 * 1. The desktop consents and shows the QR with its link; the phone (a phone's user agent) opens
 *    the link, sees the context screen (the organisation, nothing consumed), continues, records its
 *    own consent, completes the database step; the desktop shows "Continuing on your phone", then
 *    the template's completion screen. The phone's session records the method, the issuing session
 *    and the distance facts (C96.4, C96.7), and the inquiry's `handoff_count` is 1.
 * 2. The phone redeems and consents and creates a database verification; the desktop says "this was
 *    not me": the phone's session is canceled, its unfinished verification canceled, and the step
 *    shows again on the desktop (C96.3, V02).
 * 3. By email (K7A-2): the desktop confirms an address with the code Mailpit received, then sends
 *    the handoff link to it; the phone opens the link in its own context, records its own consent
 *    and completes, and the method reads `email`. The OTP mail and the handoff mail reach one `.test`
 *    address, so the second is read apart by `exceptIds`.
 * Every value is synthetic; no message leaves the stack.
 */
import { randomUUID } from 'node:crypto';
import { DEFAULT_DATABASE_CHECKS, DEFAULT_EMAIL_ADDRESS_CHECKS } from '@openverify/contracts';
import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import { waitForMail } from '../src/mailpit.js';
import { readStackInfo, type StackInfo } from '../src/stack-info.js';
import { giveConsent } from './support/flow.js';
import { presentAddress } from './support/network.js';
import { phase5Flow, phase5Template, typeConfig } from './support/phase5.js';
import { dashboardRequest, recordingClient } from './support/platform.js';
import { sessionTokenAs } from './support/ui.js';

type Steps = Parameters<typeof phase5Template>[1];

const ORGANIZATION = 'Example Verification Ltd';
const DESKTOP_ADDRESS = '203.0.113.10';
const PHONE_ADDRESS = '203.0.113.200';

const RECORDS: Steps[number] = {
  id: 'records',
  type: 'database',
  fields: [
    'name_first',
    'name_last',
    'birthdate',
    'address_street_1',
    'address_city',
    'address_postal_code',
    'address_country_code',
  ],
};
const STEPS: Steps = [{ id: 'handoff', type: 'device_handoff', methods: ['qr'] }, RECORDS];

const heading = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

/** C107.7, F30: the environment's display name, set by its admin through the dashboard API. */
async function nameTheOrganization(stack: StackInfo): Promise<void> {
  const token = await sessionTokenAs(stack, 'admin');
  const answer = await dashboardRequest(stack, 'PATCH', '/settings', {
    token,
    body: { 'organization-display-name': ORGANIZATION },
  });
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
}

/** A new inquiry on the handoff template, and its desktop flow URL. */
async function startHandoffInquiry(
  stack: StackInfo,
  run: string,
  attributes = phase5Template(`e2e-handoff-${run}`, STEPS, {
    database: typeConfig(DEFAULT_DATABASE_CHECKS),
  }),
) {
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const { data: template } = await client.inquiryTemplates.create(attributes);
  const { data: inquiry } = await client.inquiries.create({
    'inquiry-template-id': template.id,
    'reference-id': `e2e-handoff-${run} sandbox-database-nickname`,
  });
  const resumed = await client.inquiries.resume(inquiry.id);
  return { client, inquiryId: inquiry.id, flowUrl: resumed.meta['flow-url'] };
}

/** The desktop and the phone, each in its own context and from its own sandbox address. */
async function desktopAndPhone(browser: Browser, apiUrl: string) {
  const desktopContext = await browser.newContext();
  await presentAddress(desktopContext, apiUrl, DESKTOP_ADDRESS);
  const phoneContext = await browser.newContext({ ...devices['Pixel 7'] });
  await presentAddress(phoneContext, apiUrl, PHONE_ADDRESS);
  return {
    desktop: await desktopContext.newPage(),
    phone: await phoneContext.newPage(),
    close: async () => {
      await desktopContext.close();
      await phoneContext.close();
    },
  };
}

/** The desktop consents and shows the QR; answers the link it offers beside it. */
async function issueQr(desktop: Page, flowUrl: string): Promise<string> {
  await desktop.goto(flowUrl);
  await giveConsent(desktop);
  await expect(heading(desktop, 'Continue on your phone')).toBeVisible();
  await expect(
    desktop.getByRole('img', { name: 'QR code that opens this verification on your phone' }),
  ).toBeVisible();
  const link = await desktop
    .getByRole('textbox', { name: 'Or open this link on your phone' })
    .inputValue();
  expect(link).toMatch(/#inquiry-id=inq_[0-9A-Z]{26}&handoff-token=ovh_[A-Za-z0-9_-]+$/);
  return link;
}

/** The phone opens the link, reads the context screen and continues (redeeming the token). */
async function redeemOnPhone(phone: Page, link: string): Promise<void> {
  await phone.goto(link);
  await expect(heading(phone, 'Continue your verification')).toBeVisible();
  await expect(phone.getByText(`${ORGANIZATION} asked to verify your identity.`)).toBeVisible();
  await expect(phone.getByRole('button', { name: 'Decline' })).toBeVisible();
  await phone.getByRole('button', { name: 'Continue', exact: true }).click();
  // C96.5: the phone records its own consent before anything else.
  await giveConsent(phone);
}

/** The phone's database step, filled with a fictional person. */
async function completeRecords(phone: Page): Promise<void> {
  await expect(heading(phone, 'Enter your details')).toBeVisible();
  await phone.getByRole('textbox', { name: 'First name' }).fill('Bob');
  await phone.getByRole('textbox', { name: 'Last name' }).fill('Quillon');
  await phone.getByLabel('Date of birth', { exact: true }).fill('1984-07-09');
  const address = phone.getByRole('group', { name: 'Address' });
  await address.getByRole('textbox', { name: 'Address line 1' }).fill('12 Example Street');
  await address.getByRole('textbox', { name: 'Town or city' }).fill('Exampleton');
  await address.getByRole('textbox', { name: 'Postal code' }).fill('00000');
  await address.getByRole('combobox', { name: 'Country' }).selectOption('US');
  await phone.getByRole('button', { name: 'Continue' }).click();
  await expect(heading(phone, 'Verification submitted')).toBeVisible({ timeout: 60_000 });
}

test.beforeAll(async () => {
  await nameTheOrganization(readStackInfo());
});

test('the desktop shows a QR, the phone previews, continues, consents and completes, and the desktop shows the completion (C96.8)', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const { client, inquiryId, flowUrl } = await startHandoffInquiry(stack, randomUUID());
  const { desktop, phone, close } = await desktopAndPhone(browser, stack.apiUrl);
  try {
    const link = await issueQr(desktop, flowUrl);
    await redeemOnPhone(phone, link);
    await expect(heading(desktop, 'Continuing on your phone')).toBeVisible({ timeout: 15_000 });

    await completeRecords(phone);
    // The desktop polls while the phone works. The completion ends every session of the inquiry,
    // and a finished inquiry's session may still read, so the desktop reaches the template's
    // completion screen and stays on it (K7A-4).
    await expect(heading(desktop, 'Verification submitted')).toBeVisible({ timeout: 30_000 });
    await desktop.waitForLoadState('networkidle');
    await expect(heading(desktop, 'Verification submitted')).toBeVisible();
  } finally {
    await close();
  }

  const { data: inquiry } = await client.inquiries.retrieve(inquiryId);
  expect(inquiry.attributes.status).toBe('completed');
  const { data: sessions } = await client.inquirySessions.list({
    filter: { 'inquiry-id': inquiryId },
  });
  expect(sessions).toHaveLength(2);
  const handedOff = sessions.find(
    (session) => session.attributes['device-handoff-method'] !== null,
  );
  const issuing = sessions.find((session) => session.id !== handedOff?.id);
  expect(handedOff?.attributes).toMatchObject({
    'device-handoff-method': 'qr',
    'handoff-from-session-id': issuing?.id,
    'handoff-redeemed-at': expect.any(String),
    'handoff-country-changed': false,
    'handoff-asn-changed': false,
    'device-type': 'smartphone',
  });
  // C95, C96.7: two fictional points of the sandbox city data, measured in whole meters.
  const distance = handedOff?.attributes['handoff-distance-meters'];
  expect(Number.isInteger(distance) && (distance ?? 0) > 0, String(distance)).toBe(true);
  expect(issuing?.attributes['device-handoff-method']).toBeNull();

  await expect
    .poll(
      async () => {
        const { data } = await client.inquiries.retrieve(inquiryId);
        return (data.attributes.signals ?? []).find(({ name }) => name === 'inquiry/handoff_count')
          ?.value;
      },
      { timeout: 30_000, intervals: [500, 1000] },
    )
    .toBe(1);
});

test('"this was not me" on the desktop ends the phone session, cancels its unfinished verification and shows the step again (C96.3, V02)', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const { client, inquiryId, flowUrl } = await startHandoffInquiry(stack, randomUUID());
  const { desktop, phone, close } = await desktopAndPhone(browser, stack.apiUrl);
  try {
    const link = await issueQr(desktop, flowUrl);
    const redeemed = phone.waitForResponse(
      (response) => response.url().endsWith('/api/v1/flow/handoffs/redeem') && response.ok(),
    );
    await redeemOnPhone(phone, link);
    const { 'session-token': phoneToken } = (await (await redeemed).json()) as {
      'session-token': string;
    };
    await expect(heading(phone, 'Enter your details')).toBeVisible();
    // The phone's verification, still initiated when the desktop rejects it.
    const verificationId = await phase5Flow(stack, phoneToken).create('database');

    await expect(heading(desktop, 'Continuing on your phone')).toBeVisible({ timeout: 15_000 });
    await desktop.getByRole('button', { name: 'This was not me' }).click();
    await expect(desktop.getByText(/We ended the session on the other device/)).toBeVisible();
    await expect(desktop.getByRole('button', { name: 'Get a new code' })).toBeVisible();

    const { data: verification } = await client.verifications.retrieve(verificationId);
    expect(verification.attributes.status).toBe('canceled');
    const { data: sessions } = await client.inquirySessions.list({
      filter: { 'inquiry-id': inquiryId },
    });
    const handedOff = sessions.find(
      (session) => session.attributes['device-handoff-method'] === 'qr',
    );
    expect(handedOff?.attributes.status).toBe('canceled');
    const { data: inquiry } = await client.inquiries.retrieve(inquiryId);
    expect(inquiry.attributes.status).toBe('pending');
  } finally {
    await close();
  }
});

test('by email: the desktop confirms an address, the link reaches it, and the phone consents and completes in its own context (C96.8, K7A-2)', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const run = randomUUID();
  // Synthetic: `.test` is reserved, so the sandbox MX check makes no DNS query (C56).
  const destination = `e2e-handoff-${run.slice(0, 8)}@example.test`;
  const { client, inquiryId, flowUrl } = await startHandoffInquiry(
    stack,
    run,
    phase5Template(
      `e2e-handoff-email-${run}`,
      [
        { id: 'email', type: 'email_otp' },
        { id: 'handoff', type: 'device_handoff', methods: ['email'] },
        RECORDS,
      ],
      {
        'email-address': typeConfig(DEFAULT_EMAIL_ADDRESS_CHECKS),
        database: typeConfig(DEFAULT_DATABASE_CHECKS),
      },
    ),
  );
  const { desktop, phone, close } = await desktopAndPhone(browser, stack.apiUrl);
  try {
    // The destination is confirmed by the code Mailpit received (C96.3).
    await desktop.goto(flowUrl);
    await giveConsent(desktop);
    await expect(heading(desktop, 'Confirm your email address')).toBeVisible();
    await desktop.getByLabel('Email address', { exact: true }).fill(destination);
    await desktop.getByRole('button', { name: 'Send code' }).click();
    await expect(heading(desktop, 'Enter the code')).toBeVisible();
    const otpMail = await waitForMail(stack.mailpitUrl, destination, { timeoutMs: 30_000 });
    const code = /Your verification code is (\d{6})\./u.exec(otpMail.text)?.[1] ?? '';
    await desktop.getByLabel('Code', { exact: true }).fill(code);
    await desktop.getByRole('button', { name: 'Confirm' }).click();

    // The step offers no QR, so it opens on the email form.
    await expect(heading(desktop, 'Continue on your phone')).toBeVisible({ timeout: 30_000 });
    await desktop.getByLabel('Email address', { exact: true }).fill(destination);
    await desktop.getByRole('button', { name: 'Send link' }).click();
    await expect(desktop.getByRole('status').filter({ hasText: /email/i })).toBeVisible();

    // One address, two messages: the link's is read apart from the code's.
    const linkMail = await waitForMail(stack.mailpitUrl, destination, {
      timeoutMs: 30_000,
      exceptIds: [otpMail.id],
    });
    expect(linkMail.subject).toBe(`Continue your verification with ${ORGANIZATION}`);
    const link = /https?:\/\/\S+#inquiry-id=inq_\S+/u.exec(linkMail.text)?.[0] ?? '';
    expect(link).toContain('&handoff-token=ovh_');

    await redeemOnPhone(phone, link);
    await expect(heading(desktop, 'Continuing on your phone')).toBeVisible({ timeout: 15_000 });
    await completeRecords(phone);
    await expect(heading(desktop, 'Verification submitted')).toBeVisible({ timeout: 30_000 });
  } finally {
    await close();
  }

  const { data: inquiry } = await client.inquiries.retrieve(inquiryId);
  expect(inquiry.attributes.status).toBe('completed');
  const { data: sessions } = await client.inquirySessions.list({
    filter: { 'inquiry-id': inquiryId },
  });
  const handedOff = sessions.find(
    (session) => session.attributes['device-handoff-method'] !== null,
  );
  expect(handedOff?.attributes['device-handoff-method']).toBe('email');
  expect(handedOff?.attributes['device-type']).toBe('smartphone');
});

/**
 * C66 in the console for the people types, full stack (Workflow 5C, `dashboard-people`). Each test
 * makes its own data through the flow API with the stack's sandbox providers (C63): the sandbox
 * SMS sink for a phone code (read with a `sandbox:read` key), Mailpit for an email code to a
 * reserved `.test` address, and the sandbox EVM RPC's contract wallet (C57.5), signed by its owner
 * key, which `tests/support/wallets.ts` derives from its label. Then operators read the
 * verification page:
 * - phone: the number, its confirmation, one send and one wrong entry, the channel, the check's
 *   category and what a pass means; a viewer (no `pii:view`) sees the number hidden;
 * - email: the template's deny list matched the domain, so the advisory disposable check failed and
 *   says it does not decide the verification, which passed; the MX check read a reserved name;
 * - crypto: a contract wallet, flagged and sent to review (`contract_wallet_not_allowed`), the
 *   chain, scheme, address type and absent checksum in words; a viewer sees the address hidden;
 * - settings: an admin changes the text message budget, the API refuses one above the installation
 *   ceiling on the field, and the original is restored; a viewer reads it read-only; the chip trust
 *   store is linked for both, not for a reviewer.
 * The run sends two codes from 127.0.0.1 (C65.5), to its own destinations.
 */
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_CRYPTO_WALLET_CHECKS,
  DEFAULT_EMAIL_ADDRESS_CHECKS,
  DEFAULT_PHONE_NUMBER_CHECKS,
  OTP_SMS_MAX_PER_HOUR,
  dashboardSettingsSchema,
} from '@openverify/contracts';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { waitForMail } from '../src/mailpit.js';
import { readStackInfo, type StackInfo } from '../src/stack-info.js';
import { checkRowOnPage, evidenceTerm, openFoldedChecks, peopleFlow } from './support/people.js';
import {
  newestSandboxSmsCode,
  phase5Template,
  startInquiry,
  typeConfig,
  wrongCode,
} from './support/phase5.js';
import { dashboardRequest } from './support/platform.js';
import { type SeededRole, sessionTokenAs, signInAs } from './support/ui.js';
import { personalSign, testPrivateKey } from './support/wallets.js';

/** Synthetic: the NANP 555-01xx range is kept for fiction; phone-otp.spec.ts uses 0147. */
const PHONE_NUMBER = '+12025550163';
const ETHEREUM = 'eip155:1';
/** The sandbox `evmRpc` provider's contract wallet (C57.5, `docs/checks/sandbox-providers.md`). */
const SANDBOX_CONTRACT_WALLET = '0x00000000000000000000000000000000000c0de5';

/** A fresh browser context signed in as `role`, opened on `path`. */
async function consolePage(
  browser: Browser,
  stack: StackInfo,
  role: SeededRole,
  path: string,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAs(page, stack, role);
  await page.goto(`${stack.dashboardUrl}${path}`);
  return { page, close: () => context.close() };
}

test('a reviewer reads a phone number verification: the number, its confirmation, the sends and the wrong entries, the category and what a pass means; a viewer sees the number hidden (C55, C66)', async ({
  browser,
}) => {
  const stack = readStackInfo();
  const run = randomUUID();
  const { sessionToken } = await startInquiry(
    stack,
    phase5Template(
      `ui-people-phone-${run}`,
      [{ id: 'phone', type: 'phone_otp', allowedCountries: ['US'] }],
      { 'phone-number': typeConfig(DEFAULT_PHONE_NUMBER_CHECKS) },
    ),
    `ui-people-phone-${run}`,
  );
  const flow = peopleFlow(stack, sessionToken);
  await flow.consent();
  const id = await flow.create('phone-number');
  await flow.sendCode(id, { 'phone-number': PHONE_NUMBER });
  const code = await newestSandboxSmsCode(stack, PHONE_NUMBER);
  expect(await flow.confirmCode(id, wrongCode(code))).toBe(422);
  expect(await flow.confirmCode(id, code)).toBe(200);
  await flow.submit(id);
  expect((await flow.decided(id)).attributes.status).toBe('passed');

  const reviewer = await consolePage(browser, stack, 'reviewer', `/verifications/${id}`);
  try {
    const { page } = reviewer;
    const term = (name: string) => evidenceTerm(page, 'Phone number', name);
    await expect(term('Phone number')).toHaveText(PHONE_NUMBER);
    await expect(term('Confirmed (UTC)').locator('time')).toHaveAttribute('datetime', /^\d{4}-/u);
    await expect(term('Sends')).toHaveText('1');
    await expect(term('Failed attempts')).toHaveText('1');
    await expect(term('Channel')).toHaveText('Text message (SMS)');
    // ADR 0002 §3d: the e2e stack's sandbox SMS sender is labelled as one.
    await expect(term('Sent through')).toContainText('sandbox');
    await expect(term('Sent through')).toContainText('The sandbox sender sends no text message');
    await expect(page.getByRole('group', { name: 'Phone number evidence' })).toContainText(
      'What a pass means: The user entered the code that was sent by text message to that number',
    );
    await openFoldedChecks(page);
    const comparison = checkRowOnPage(page, 'phone_number_otp_comparison');
    await expect(comparison).toContainText('Passed');
    await expect(comparison).toContainText('Required');
    await expect(comparison).toContainText('User action required');
    await expect(page.getByRole('main')).not.toContainText(code);
  } finally {
    await reviewer.close();
  }

  const viewer = await consolePage(browser, stack, 'viewer', `/verifications/${id}`);
  try {
    const { page } = viewer;
    await expect(
      evidenceTerm(page, 'Phone number', 'Phone number').getByText('Hidden', { exact: true }),
    ).toBeVisible();
    await expect(evidenceTerm(page, 'Phone number', 'Sends')).toHaveText('1');
    await expect(page.getByRole('main')).not.toContainText('5550163');
  } finally {
    await viewer.close();
  }
});

test('a reviewer reads an email address verification: the denied domain, an advisory failure that does not decide the verification, and a reserved mail domain (C56, C66)', async ({
  browser,
}) => {
  const stack = readStackInfo();
  const run = randomUUID();
  // Synthetic: `.test` is reserved (RFC 2606); the local part is this run's.
  const address = `ui-people-${run.slice(0, 8)}@denied.test`;
  const { sessionToken } = await startInquiry(
    stack,
    phase5Template(`ui-people-email-${run}`, [{ id: 'email', type: 'email_otp' }], {
      'email-address': typeConfig(DEFAULT_EMAIL_ADDRESS_CHECKS, {
        email_address_disposable_detection: {
          enabled: true,
          required: false,
          config: { 'deny-domains': ['denied.test'] },
        },
      }),
    }),
    `ui-people-email-${run}`,
  );
  const flow = peopleFlow(stack, sessionToken);
  await flow.consent();
  const id = await flow.create('email-address');
  await flow.sendCode(id, { 'email-address': address });
  const mail = await waitForMail(stack.mailpitUrl, address, { timeoutMs: 30_000 });
  const code = /Your verification code is (\d{6})\./u.exec(mail.text)?.[1] ?? '';
  expect(code).toMatch(/^\d{6}$/u);
  expect(await flow.confirmCode(id, code)).toBe(200);
  await flow.submit(id);
  expect((await flow.decided(id)).attributes.status).toBe('passed');

  const reviewer = await consolePage(browser, stack, 'reviewer', `/verifications/${id}`);
  try {
    const { page } = reviewer;
    const term = (name: string) => evidenceTerm(page, 'Email address', name);
    await expect(term('Email address')).toHaveText(address);
    await expect(term('Disposable-domain lists')).toContainText("On the template's deny list");
    await expect(term('Disposable-domain lists')).toContainText(
      "Matched on the address's own domain",
    );
    await expect(term('Mail domain')).toContainText('A reserved sandbox name');
    // C30.1: an advisory failure stays in view, and says it does not decide the verification.
    const disposable = checkRowOnPage(page, 'email_address_disposable_detection');
    await expect(disposable).toContainText('Failed');
    await expect(disposable).toContainText('Advisory');
    await expect(disposable).toContainText('Does not decide the verification');
    await expect(disposable).toContainText('Disposable email domain');
    await expect(disposable).toContainText('Fraud');
    await expect(page.getByRole('main')).not.toContainText(code);
  } finally {
    await reviewer.close();
  }
});

test('a reviewer reads a contract wallet sent to review, its chain, scheme, address type, checksum and flag in words; a viewer sees the address hidden (C57, C66)', async ({
  browser,
}) => {
  const stack = readStackInfo();
  const run = randomUUID();
  const { sessionToken } = await startInquiry(
    stack,
    phase5Template(
      `ui-people-wallet-${run}`,
      [{ id: 'wallet', type: 'crypto_wallet', chains: [ETHEREUM], signing: ['paste'] }],
      { 'crypto-wallet': typeConfig(DEFAULT_CRYPTO_WALLET_CHECKS) },
    ),
    `ui-people-wallet-${run}`,
  );
  const flow = peopleFlow(stack, sessionToken);
  await flow.consent();
  const id = await flow.create('crypto-wallet');
  const challenge = await flow.cryptoChallenge(id, ETHEREUM, SANDBOX_CONTRACT_WALLET);
  // The contract's owner key signs; the signature recovers to the owner, not the contract, so
  // the server asks the sandbox RPC, whose ERC-1271 answer accepts it (C57.4, C57.5).
  const signature = personalSign(
    new TextEncoder().encode(challenge.message),
    testPrivateKey('sandbox/contract-wallet-owner'),
  );
  await flow.submit(id, { crypto: { 'challenge-id': challenge.id, signature, scheme: 'eip191' } });
  expect((await flow.decided(id)).attributes.status).toBe('needs_review');

  const reviewer = await consolePage(browser, stack, 'reviewer', `/verifications/${id}`);
  try {
    const { page } = reviewer;
    const term = (name: string) => evidenceTerm(page, 'Crypto wallet', name);
    await expect(term('Wallet address')).toHaveText(SANDBOX_CONTRACT_WALLET);
    await expect(term('Chain')).toContainText('EVM network 1');
    await expect(term('Chain')).toContainText(ETHEREUM);
    await expect(term('Signature scheme')).toContainText('EIP-191 personal message');
    await expect(term('Address type')).toHaveText('EVM account');
    await expect(term('Checksum')).toContainText('Absent');
    await expect(term('Flags')).toContainText('Contract wallet (ERC-1271)');
    await expect(term('Flags')).toContainText('proves control of a contract, not of a person');
    await expect(term('Contract checked by')).toContainText('never a real chain');
    await expect(page.getByRole('group', { name: 'Crypto wallet evidence' })).toContainText(
      "What a pass means: Whoever answered the challenge controlled the claimed address's key at signing time",
    );
    // C57.4, decision 20: a contract wallet goes to review, never to a failure.
    await expect(page.getByRole('note', { name: 'Why it needs review' })).toContainText(
      'crypto_wallet_address_comparison (Contract wallet, not allowed)',
    );
    const address = checkRowOnPage(page, 'crypto_wallet_address_comparison');
    await expect(address).toContainText('Not applicable');
    await expect(address).toContainText('Fraud');
  } finally {
    await reviewer.close();
  }

  const viewer = await consolePage(browser, stack, 'viewer', `/verifications/${id}`);
  try {
    const { page } = viewer;
    await expect(
      evidenceTerm(page, 'Crypto wallet', 'Wallet address').getByText('Hidden', { exact: true }),
    ).toBeVisible();
    await expect(evidenceTerm(page, 'Crypto wallet', 'Chain')).toContainText('EVM network 1');
    await expect(page.getByRole('main')).not.toContainText('c0de5');
  } finally {
    await viewer.close();
  }
});

test('an admin changes the text message budget, a budget above the installation ceiling is refused on its field, and the original is restored; a viewer reads it, and the chip trust store is linked for settings readers (C55.7, C66)', async ({
  page,
  browser,
}) => {
  const stack = readStackInfo();
  const token = await sessionTokenAs(stack, 'admin');
  const read = async () =>
    dashboardSettingsSchema.parse(
      (await dashboardRequest(stack, 'GET', '/settings', { token })).body,
    );
  const initial = await read();
  const original = initial['otp-sms-max-per-hour'];
  if (original === undefined) {
    throw new Error('The API does not serve otp-sms-max-per-hour');
  }
  const changed = original === 150 ? 151 : 150;
  try {
    await signInAs(page, stack, 'admin');
    await page.goto(`${stack.dashboardUrl}/settings`);
    const budget = page.getByRole('group', { name: 'Text message codes in Sandbox' });
    const field = budget.getByLabel('Text messages per hour');
    await expect(field).toHaveValue(String(original));
    const tripped = initial['otp-sms-budget-tripped-at'] ?? null;
    const trippedValue = budget.locator('dt:text-is("Budget last tripped (UTC)") + dd');
    if (tripped === null) {
      await expect(trippedValue).toHaveText('Never');
    } else {
      await expect(trippedValue.locator('time')).toHaveAttribute('datetime', tripped);
    }

    // Within the contract, above the installation's ceiling: the API's 422 lands on the field.
    await field.fill(String(OTP_SMS_MAX_PER_HOUR.max));
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(field).toHaveAccessibleDescription(/must be at most \d+$/u);
    expect((await read())['otp-sms-max-per-hour']).toBe(original);

    await field.fill(String(changed));
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Settings saved.' })).toBeVisible();
    expect((await read())['otp-sms-max-per-hour']).toBe(changed);

    const viewer = await consolePage(browser, stack, 'viewer', '/settings');
    try {
      const region = viewer.page.getByRole('region', { name: 'Text message codes in Sandbox' });
      await expect(region.locator('dt:text-is("Text messages per hour") + dd')).toHaveText(
        `${String(changed)} text messages`,
      );
      await expect(viewer.page.getByRole('spinbutton')).toHaveCount(0);
      await expect(
        viewer.page
          .getByRole('navigation', { name: 'Console' })
          .getByRole('link', { name: 'Chip trust store', exact: true }),
      ).toHaveAttribute('href', '/trust-anchors');
    } finally {
      await viewer.close();
    }
  } finally {
    await dashboardRequest(stack, 'PATCH', '/settings', {
      token,
      body: { 'otp-sms-max-per-hour': original },
    });
  }
  expect((await read())['otp-sms-max-per-hour']).toBe(original);

  const reviewer = await consolePage(browser, stack, 'reviewer', '/inquiries');
  try {
    await expect(
      reviewer.page
        .getByRole('navigation', { name: 'Console' })
        .getByRole('link', { name: 'Chip trust store', exact: true }),
    ).toHaveCount(0);
  } finally {
    await reviewer.close();
  }
});

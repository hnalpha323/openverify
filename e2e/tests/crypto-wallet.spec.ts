/**
 * C57, C64.1, C65.5 (Workflow 5A): proving control of a crypto wallet, full stack, on templates
 * with one crypto wallet step and its default checks. The e2e stack binds the sandbox `evmRpc`
 * provider for sandbox environments (C63), so an EVM signature that recovers no matching key is
 * judged on `eth_getCode` rather than sent to review.
 * - An EIP-6963 wallet injected into the hosted flow gives its account, the server builds the
 *   EIP-4361 message, the wallet signs it with `personal_sign` (a binding to this process, so no
 *   key enters the page), and every required check passes.
 * - A Bitcoin P2WPKH address on the paste path: the user copies the server's message, signs it
 *   with BIP-322 simple elsewhere and pastes the `smp` signature; it passes.
 * - A wallet that reports one account but signs with another key: the address check fails
 *   `signature_address_mismatch`, a user-behaviour failure, so the flow offers attempt 2 of 3 with
 *   the retry hint, and the inquiry stays open.
 * Keys come from fixed labels (`tests/support/wallets.ts`); none is committed.
 */
import { randomUUID } from 'node:crypto';
import { DEFAULT_CRYPTO_WALLET_CHECKS } from '@openverify/contracts';
import { isVerificationOfType, type CryptoWalletVerification } from '@openverify/node';
import { expect, test, type Page } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { collectConsoleErrors, giveConsent } from './support/flow.js';
import { phase5Template, startInquiry, typeConfig } from './support/phase5.js';
import { recordingClient } from './support/platform.js';
import { createServerApi } from './support/server-api.js';
import {
  bip322SimpleSignature,
  bitcoinP2wpkhAddress,
  evmAddress,
  injectWallet,
  testPrivateKey,
} from './support/wallets.js';

const ETHEREUM = 'eip155:1';
const BITCOIN = 'bip122:000000000019d6689c085ae165831e93';
const WALLET_NAME = 'E2E Test Wallet';

type CryptoWalletStep = Extract<
  Parameters<typeof phase5Template>[1][number],
  { type: 'crypto_wallet' }
>;

/** An inquiry on a new one-step crypto wallet template, opened in the hosted flow. */
async function openWalletStep(page: Page, step: Omit<CryptoWalletStep, 'id' | 'type'>) {
  const stack = readStackInfo();
  const run = randomUUID();
  const { inquiryId, flowUrl } = await startInquiry(
    stack,
    phase5Template(`e2e-crypto-wallet-${run}`, [{ id: 'wallet', type: 'crypto_wallet', ...step }], {
      'crypto-wallet': typeConfig(DEFAULT_CRYPTO_WALLET_CHECKS),
    }),
    `e2e-crypto-wallet-${run}`,
  );
  await page.goto(flowUrl);
  await giveConsent(page);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Prove that you control your crypto wallet' }),
  ).toBeVisible();
  return { stack, inquiryId };
}

/** The inquiry's latest crypto wallet verification, as the customer's key reads it. */
async function walletVerification(inquiryId: string): Promise<CryptoWalletVerification> {
  const stack = readStackInfo();
  const document = await createServerApi(stack.apiUrl, stack.apiKey).getInquiry(inquiryId);
  const verification = (document.included ?? []).at(-1);
  if (
    verification === undefined ||
    !isVerificationOfType(verification, 'verification/crypto-wallet')
  ) {
    throw new Error(`The inquiry holds no crypto wallet verification: ${JSON.stringify(document)}`);
  }
  return verification;
}

const checksOf = (verification: CryptoWalletVerification) =>
  Object.fromEntries(verification.attributes.checks.map((check) => [check.name, check]));

test('an injected EIP-6963 wallet signs the server’s EIP-4361 message, and every required check passes (C57, C64.1)', async ({
  page,
}) => {
  const key = testPrivateKey('e2e/eip6963-wallet');
  const account = evmAddress(key);
  const signs = await injectWallet(page, { name: WALLET_NAME, account, signingKey: key });
  const errors = collectConsoleErrors(page);
  const { stack, inquiryId } = await openWalletStep(page, {
    chains: [ETHEREUM],
    signing: ['wallet', 'paste'],
  });

  await expect(page.getByText('Network: Ethereum')).toBeVisible();
  await page.getByRole('button', { name: `Connect ${WALLET_NAME}` }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Verification submitted' })).toBeVisible(
    { timeout: 60_000 },
  );
  expect(signs).toEqual(['personal_sign']);
  expect(errors).toEqual([]);

  const verification = await walletVerification(inquiryId);
  expect(verification.attributes).toMatchObject({
    status: 'passed',
    'wallet-address': account,
    'chain-id': ETHEREUM,
    'signature-scheme': 'eip191',
  });
  const checks = checksOf(verification);
  expect(checks.crypto_wallet_validity_detection).toMatchObject({
    status: 'passed',
    metadata: { checksum: 'absent', 'address-type': 'evm' },
  });
  expect(checks.crypto_wallet_address_comparison).toMatchObject({
    status: 'passed',
    metadata: { scheme: 'eip191' },
  });
  expect(checks.crypto_wallet_statement_comparison).toMatchObject({ status: 'passed' });
  // C51.2: no allowlist is configured, a non-blocking answer.
  expect(checks.crypto_wallet_disallowed_chain_detection).toMatchObject({
    status: 'not_applicable',
    reasons: ['no_allowlist'],
  });
  // C51.4: no check copies the address or the signature.
  expect(JSON.stringify(verification.attributes.checks)).not.toContain(account.slice(2));
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  expect((await client.inquiries.retrieve(inquiryId)).data.attributes.status).toBe('completed');
});

test('a pasted BIP-322 simple signature of a Bitcoin P2WPKH address passes (C57.3, C57.4)', async ({
  page,
}) => {
  const key = testPrivateKey('e2e/bip322-wallet');
  const address = bitcoinP2wpkhAddress(key);
  const errors = collectConsoleErrors(page);
  const { inquiryId } = await openWalletStep(page, { chains: [BITCOIN], signing: ['paste'] });

  await expect(page.getByText('Network: Bitcoin')).toBeVisible();
  await page.getByRole('textbox', { name: 'Wallet address' }).fill(address);
  await page.getByRole('button', { name: 'Get the message to sign' }).click();
  const messageField = page.getByRole('textbox', { name: 'Message to sign' });
  await expect(messageField).toHaveValue(/wants you to sign in with your Bitcoin account:/u);
  const message = await messageField.inputValue();
  // C57.2: the server's message names the address and ten minutes, with a fresh nonce.
  expect(message).toContain(address);
  expect(message).toMatch(/\nNonce: [0-9A-Za-z]{16}\n/u);
  await page
    .getByRole('textbox', { name: 'Signature' })
    .fill(bip322SimpleSignature(new TextEncoder().encode(message), key));
  await page.getByRole('button', { name: 'Submit signature' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Verification submitted' })).toBeVisible(
    { timeout: 60_000 },
  );
  expect(errors).toEqual([]);

  const verification = await walletVerification(inquiryId);
  expect(verification.attributes).toMatchObject({
    status: 'passed',
    'wallet-address': address,
    'chain-id': BITCOIN,
    'signature-scheme': 'bip322-simple',
  });
  const checks = checksOf(verification);
  expect(checks.crypto_wallet_validity_detection).toMatchObject({
    status: 'passed',
    metadata: { 'address-type': 'p2wpkh' },
  });
  expect(checks.crypto_wallet_address_comparison).toMatchObject({
    status: 'passed',
    metadata: { scheme: 'bip322-simple' },
  });
});

test('a wallet that signs with another key fails signature_address_mismatch, and the flow offers another attempt with the hint (C57.4, C64.1)', async ({
  page,
}) => {
  const account = evmAddress(testPrivateKey('e2e/claimed-account'));
  await injectWallet(page, {
    name: WALLET_NAME,
    account,
    signingKey: testPrivateKey('e2e/another-key'),
  });
  const { inquiryId } = await openWalletStep(page, {
    chains: [ETHEREUM],
    signing: ['wallet', 'paste'],
  });

  await page.getByRole('button', { name: `Connect ${WALLET_NAME}` }).click();
  // The server answered no code at the account (sandbox evmRpc), so the user can try again.
  await expect(page.getByText('Attempt 2 of 3')).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByRole('heading', { level: 1, name: 'Prove that you control your crypto wallet' }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(
    'The message was signed by a different wallet address. Sign it with the address you entered.',
  );
  await expect(page.getByRole('main')).not.toContainText(/photo/u);

  const verification = await walletVerification(inquiryId);
  expect(verification.attributes.status).toBe('failed');
  expect(checksOf(verification).crypto_wallet_address_comparison).toMatchObject({
    status: 'failed',
    reasons: ['signature_address_mismatch'],
    // C50.8: a user-behaviour check (hence the retry hint) whose category is fraud.
    category: 'fraud',
  });
});

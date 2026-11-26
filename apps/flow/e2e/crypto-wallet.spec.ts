/**
 * C57, C64.1 in the browser, against the mocked API: proving control of a crypto wallet. A fake
 * EIP-1193 provider (installed before the flow loads, announced through EIP-6963 or injected as
 * `window.ethereum`) answers a fixed synthetic signature: it holds no key and runs no
 * cryptography, and the mocked API checks no signature (the full-stack spec does). The paste path
 * copies the server's message and takes a pasted signature. The built flow carries no
 * cryptography library.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { MockFlowApi, PHASE5_CONSENT_GIVEN, flowLink, phase5Flow } from './support/mock-flow-api';
import {
  collectUnexpectedErrors,
  expectTargetSize,
  freezeClock,
  heading,
  installFakeWallet,
  utf8Hex,
  walletCalls,
} from './support/phase5';

const ETHEREUM = 'eip155:1';
const BITCOIN = 'bip122:000000000019d6689c085ae165831e93';
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
/** Synthetic values: no key exists for this account, and nothing checks the signature here. */
const ACCOUNT = '0x5a1e5a1e5a1e5a1e5a1e5a1e5a1e5a1e5a1e5a1e';
const SIGNATURE = `0x${'5e'.repeat(65)}`;
const BITCOIN_ADDRESS = 'bc1qsyntheticaddressforflowtestsonly000000';
const PASTED_SIGNATURE = `smp${'A'.repeat(88)}`;
const SOLANA_ADDRESS = 'So1anaSyntheticAddressForFlowTestsOnly1111';

function walletApi(chains: string[], signing: ('wallet' | 'paste')[]): MockFlowApi {
  const api = new MockFlowApi();
  api.flow = phase5Flow('wallet', { id: 'wallet', type: 'crypto_wallet', chains, signing });
  api.consent = { ...PHASE5_CONSENT_GIVEN, textKeys: [...PHASE5_CONSENT_GIVEN.textKeys] };
  return api;
}

test('signs the server’s message in a wallet announced through EIP-6963, then submits it (C57, C64.1)', async ({
  page,
}) => {
  const errors = collectUnexpectedErrors(page);
  const api = walletApi([ETHEREUM], ['wallet', 'paste']);
  await installFakeWallet(page, {
    via: 'eip6963',
    account: ACCOUNT,
    signature: SIGNATURE,
    name: 'Test Wallet',
  });
  await api.install(page);
  await freezeClock(page, api);
  await page.goto(flowLink());

  await expect(heading(page, 'Prove that you control your crypto wallet')).toBeVisible();
  await expect(page.getByText('Attempt 1 of 3')).toBeVisible();
  await expect(page.getByText('Network: Ethereum')).toBeVisible();
  const connect = page.getByRole('button', { name: 'Connect Test Wallet' });
  await expectTargetSize(connect);
  await expect(page.getByRole('button', { name: 'Paste a signature instead' })).toBeVisible();
  await connect.click();

  await expect(heading(page, 'Verification submitted')).toBeFocused();
  const [challenge] = api.verifications[0]?.challenges ?? [];
  expect(api.challengeRequests.map(({ body }) => body)).toEqual([
    { 'chain-id': ETHEREUM, 'wallet-address': ACCOUNT },
  ]);
  // The wallet gave the account, then signed the server's message as its UTF-8 bytes.
  expect(await walletCalls(page)).toEqual([
    { method: 'eth_requestAccounts' },
    { method: 'personal_sign', params: [utf8Hex(challenge?.message ?? ''), ACCOUNT] },
  ]);
  expect(api.submits).toEqual([
    {
      verificationId: api.verifications[0]?.id,
      body: { crypto: { 'challenge-id': challenge?.id, signature: SIGNATURE, scheme: 'eip191' } },
    },
  ]);
  expect(challenge?.status).toBe('submitted');
  expect(errors).toEqual([]);
});

test('uses an injected window.ethereum when no wallet announces itself (EIP-1193)', async ({
  page,
}) => {
  const errors = collectUnexpectedErrors(page);
  const api = walletApi([ETHEREUM], ['wallet']);
  await installFakeWallet(page, { via: 'injected', account: ACCOUNT, signature: SIGNATURE });
  await api.install(page);
  await freezeClock(page, api);
  await page.goto(flowLink());

  await page.getByRole('button', { name: 'Connect your wallet' }).click();

  await expect(heading(page, 'Verification submitted')).toBeVisible();
  expect((await walletCalls(page)).map(({ method }) => method)).toEqual([
    'eth_requestAccounts',
    'personal_sign',
  ]);
  expect(api.submits[0]?.body?.crypto).toMatchObject({ signature: SIGNATURE, scheme: 'eip191' });
  expect(errors).toEqual([]);
});

test('says when the user declined in the wallet, then signs on the next try (EIP-1193 4001)', async ({
  page,
}) => {
  const errors = collectUnexpectedErrors(page);
  const api = walletApi([ETHEREUM], ['wallet', 'paste']);
  await installFakeWallet(page, {
    via: 'eip6963',
    account: ACCOUNT,
    signature: SIGNATURE,
    declines: 1,
  });
  await api.install(page);
  await freezeClock(page, api);
  await page.goto(flowLink());

  const connect = page.getByRole('button', { name: 'Connect Test Wallet' });
  await connect.click();
  await expect(page.getByRole('alert')).toHaveText(
    'You declined the request in your wallet. Try again when you are ready.',
  );
  await connect.click();

  await expect(heading(page, 'Verification submitted')).toBeVisible();
  // A new challenge supersedes the one that was never signed (C57.2).
  expect(api.verifications[0]?.challenges?.map(({ status }) => status)).toEqual([
    'superseded',
    'submitted',
  ]);
  expect(errors).toEqual([]);
});

test('pastes a signature: the network chosen, an address refused with focus on it, the message copied, the signature submitted (C57.2, C64.1)', async ({
  page,
  context,
}) => {
  const errors = collectUnexpectedErrors(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const api = walletApi([BITCOIN, SOLANA], ['paste']);
  api.refusals['crypto-challenges'] = [{ code: 'crypto_address_invalid' }];
  await api.install(page);
  await freezeClock(page, api);
  await page.goto(flowLink());

  // The step's networks, a radio group named Network.
  const network = page.getByRole('radiogroup', { name: 'Network' });
  await expect(network.getByRole('radio')).toHaveCount(2);
  await expect(network.getByRole('radio', { name: 'Bitcoin' })).toBeChecked();
  await expect(network.getByRole('radio', { name: 'Solana' })).not.toBeChecked();
  await expectTargetSize(page.locator('label').filter({ hasText: 'Solana' }));

  // An address the browser refuses, then one the server refuses: each takes focus.
  const address = page.getByRole('textbox', { name: 'Wallet address' });
  await expect(address).toHaveAccessibleDescription(
    'Copy it from your wallet, then paste it here.',
  );
  const getMessage = page.getByRole('button', { name: 'Get the message to sign' });
  await getMessage.click();
  await expect(address).toBeFocused();
  await expect(address).toHaveAccessibleDescription(
    'Copy it from your wallet, then paste it here. Enter your wallet address.',
  );
  await address.fill(BITCOIN_ADDRESS);
  await getMessage.click();
  await expect(address).toBeFocused();
  await expect(address).toHaveAttribute('aria-invalid', 'true');
  await expect(address).toHaveAccessibleDescription(
    'Copy it from your wallet, then paste it here. This wallet address is not valid for the network you chose. Check that you copied the whole address.',
  );
  await getMessage.click();

  // The server's message, read-only, with its expiry, copied for the wallet. The mock records the
  // challenge when the request arrives, which a busy machine does after the click returns, so wait
  // for it before reading it (Workflow 10C: the read raced the request at load 14).
  await expect.poll(() => api.verifications[0]?.challenges?.length ?? 0).toBe(1);
  const [challenge] = api.verifications[0]?.challenges ?? [];
  const message = page.getByRole('textbox', { name: 'Message to sign' });
  await expect(message).toHaveValue(challenge?.message ?? '');
  await expect(message).toHaveAttribute('readonly', '');
  await expect(message).toHaveAccessibleDescription(
    /^Sign this exact message in your wallet, then paste the signature below\. Sign it before /u,
  );
  await page.getByRole('button', { name: 'Copy the message' }).click();
  await expect(page.getByRole('status')).toHaveText('Message copied.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(challenge?.message);
  // Bitcoin has no signed-message field: only a Solana wallet may wrap what it signs.
  await expect(page.getByRole('textbox', { name: 'Signed message (optional)' })).toHaveCount(0);

  // A signature the browser refuses takes focus; then the pasted one is submitted.
  const submit = page.getByRole('button', { name: 'Submit signature' });
  await submit.click();
  const signature = page.getByRole('textbox', { name: 'Signature' });
  await expect(signature).toBeFocused();
  await expect(signature).toHaveAccessibleDescription('Paste the signature from your wallet.');
  await signature.fill(` ${PASTED_SIGNATURE} `);
  await submit.click();

  await expect(heading(page, 'Verification submitted')).toBeVisible();
  expect(api.challengeRequests.map(({ body }) => body)).toEqual([
    { 'chain-id': BITCOIN, 'wallet-address': BITCOIN_ADDRESS },
    { 'chain-id': BITCOIN, 'wallet-address': BITCOIN_ADDRESS },
  ]);
  // The server reads the scheme from the signature: the browser names none.
  expect(api.submits).toEqual([
    {
      verificationId: api.verifications[0]?.id,
      body: { crypto: { 'challenge-id': challenge?.id, signature: PASTED_SIGNATURE } },
    },
  ]);
  expect(errors).toEqual([]);
});

test('takes the bytes a Solana wallet signed with the pasted signature (C57.3)', async ({
  page,
}) => {
  const errors = collectUnexpectedErrors(page);
  const api = walletApi([BITCOIN, SOLANA], ['paste']);
  await api.install(page);
  await freezeClock(page, api);
  await page.goto(flowLink());

  await page.getByRole('radio', { name: 'Solana' }).check();
  await page.getByRole('textbox', { name: 'Wallet address' }).fill(SOLANA_ADDRESS);
  await page.getByRole('button', { name: 'Get the message to sign' }).click();
  const signed = page.getByRole('textbox', { name: 'Signed message (optional)' });
  await expect(signed).toHaveAccessibleDescription(
    'Some Solana wallets show the bytes they signed. If yours does, paste them here.',
  );
  await signed.fill('c2lnbmVkIGJ5dGVz');
  await page.getByRole('textbox', { name: 'Signature' }).fill('5ynthetic5ignature');
  await page.getByRole('button', { name: 'Submit signature' }).click();

  await expect(heading(page, 'Verification submitted')).toBeVisible();
  expect(api.submits[0]?.body?.crypto).toEqual({
    'challenge-id': api.verifications[0]?.challenges?.[0]?.id,
    signature: '5ynthetic5ignature',
    'signed-message': 'c2lnbmVkIGJ5dGVz',
  });
  expect(errors).toEqual([]);
});

test('offers to start again after a canceled attempt (C57.2, C64.1 resume)', async ({ page }) => {
  const errors = collectUnexpectedErrors(page);
  const api = walletApi([BITCOIN], ['paste']);
  // The eleventh challenge canceled the first attempt (a retryable one).
  api.verifications.push({
    type: 'verification/crypto-wallet',
    id: 'ver_01M5CK16P0D13FXHZSS4TCFB00',
    status: 'canceled',
    hints: [],
  });
  await api.install(page);
  await freezeClock(page, api);
  await page.goto(flowLink());

  await expect(heading(page, 'Prove that you control your crypto wallet')).toBeVisible();
  await expect(page.getByText('Attempt 2 of 3')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText(
    'Your last attempt ended because too many messages to sign were asked for. Start again.',
  );
  await page.getByRole('textbox', { name: 'Wallet address' }).fill(BITCOIN_ADDRESS);
  await page.getByRole('button', { name: 'Get the message to sign' }).click();
  await expect(page.getByRole('textbox', { name: 'Message to sign' })).toBeVisible();
  expect(api.verifications.map(({ status }) => status)).toEqual(['canceled', 'initiated']);
  expect(errors).toEqual([]);
});

test('the built flow carries no cryptography library: no secp256k1 or ed25519 constant (C64.1)', () => {
  // The webServer built `dist` for this run; every chunk is read, the lazy ones too.
  const assets = new URL('../dist/assets/', import.meta.url);
  const scripts = readdirSync(assets).filter((name) => name.endsWith('.js'));
  expect(scripts.length).toBeGreaterThan(0);
  const fingerprints = [
    // secp256k1's field prime and group order, as every implementation spells them.
    'fffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f',
    'fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141',
    // ed25519's field prime, 2^255 - 19.
    '7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed',
  ];
  for (const name of scripts) {
    const source = readFileSync(new URL(name, assets), 'utf8').toLowerCase();
    for (const fingerprint of fingerprints) {
      expect(source.includes(fingerprint), `${name} holds ${fingerprint}`).toBe(false);
    }
  }
});

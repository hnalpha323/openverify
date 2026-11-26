import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { phase5Verification } from '../../testing/phase5-fixtures';
import { CRYPTO_WALLET_PASS_MEANS, SANDBOX_RPC_TEXT } from '../../lib/crypto-wallet-words';
import {
  SANDBOX_CONTRACT_WALLET,
  WALLET_ADDRESS,
  contractWalletVerification,
  cryptoWalletVerification,
  looseBitcoinVerification,
  solanaEnvelopeVerification,
  solanaProgramAccountVerification,
  walletChecks,
} from '../../testing/fixtures/crypto-wallet';
import { CryptoWalletEvidence } from './crypto-wallet';
import type { EvidenceState } from './generic';

function evidence(verification = cryptoWalletVerification(), state: EvidenceState = 'visible') {
  return render(
    <CryptoWalletEvidence verification={verification} label="Crypto wallet" state={state} />,
  );
}

const group = () => screen.getByRole('group', { name: 'Crypto wallet evidence' });

/** The value a term of the evidence names. */
function value(term: string): HTMLElement {
  const dd = within(group()).getByText(term, { selector: 'dt' }).nextElementSibling;
  if (!(dd instanceof HTMLElement)) throw new Error(`No value for ${term}`);
  return dd;
}

/** The flags listed, in words. */
const flags = () =>
  within(value('Flags'))
    .queryAllByRole('listitem')
    .map((item) => item.firstElementChild?.textContent);

describe('CryptoWalletEvidence (C52.8, C57, C66)', () => {
  it('shows the address, the chain and the scheme in words with their codes', () => {
    evidence();

    expect(value('Wallet address').textContent).toBe(WALLET_ADDRESS);
    expect(value('Expected address')).toHaveTextContent('None');
    const chain = value('Chain');
    expect(chain).toHaveTextContent('EVM network 1');
    expect(within(chain).getByText('eip155:1').tagName).toBe('CODE');
    const scheme = value('Signature scheme');
    expect(scheme).toHaveTextContent('EIP-191 personal message');
    expect(within(scheme).getByText('eip191').tagName).toBe('CODE');
  });

  it('says the address type and an absent checksum in words, and why it still passed (C57.1)', () => {
    evidence();

    expect(value('Address type')).toHaveTextContent(/^EVM account$/);
    const checksum = value('Checksum');
    expect(checksum).toHaveTextContent('Absent');
    expect(checksum).toHaveTextContent(/single-case EVM address carries no EIP-55 checksum/);
  });

  it('raises no flag for a low-s EIP-191 signature', () => {
    evidence();

    expect(flags()).toEqual([]);
    expect(value('Flags')).toHaveTextContent(/^None raised$/);
  });

  it('says a contract wallet, and that it proves control of a contract, not of a person (C57.4)', () => {
    evidence(contractWalletVerification());

    expect(value('Wallet address').textContent).toBe(SANDBOX_CONTRACT_WALLET);
    expect(flags()).toEqual(['Contract wallet (ERC-1271)']);
    expect(value('Flags')).toHaveTextContent(/control of a contract, not of a person/);
  });

  it('says a high-s signature and a loose BIP-137 header in words (C57.4)', () => {
    evidence(looseBitcoinVerification());

    expect(value('Chain')).toHaveTextContent('Bitcoin');
    expect(value('Signature scheme')).toHaveTextContent('BIP-137 signed message');
    expect(value('Address type')).toHaveTextContent('Pay to public key hash (P2PKH)');
    expect(value('Checksum')).toHaveTextContent(/^Valid$/);
    expect(flags()).toEqual(['High-s signature', 'Loose BIP-137 header']);
  });

  it('says whether a Solana address is on the curve, and an unwrapped envelope (C57.1, C57.4)', () => {
    const { unmount } = evidence(solanaProgramAccountVerification());
    expect(value('Chain')).toHaveTextContent('Solana');
    expect(value('Checksum')).toHaveTextContent('None in this format');
    expect(flags()).toEqual(['Off the ed25519 curve']);
    expect(value('Flags')).toHaveTextContent(/program account/);
    unmount();

    evidence(solanaEnvelopeVerification());
    expect(flags()).toEqual(['On the ed25519 curve', 'Solana off-chain message, version 1']);
  });

  it('says what a pass means, as the docs do', () => {
    evidence();

    expect(within(group()).getByText(CRYPTO_WALLET_PASS_MEANS).closest('p')).toHaveTextContent(
      /^What a pass means: Whoever answered the challenge/,
    );
  });

  it('shows "Hidden" for both addresses the API masked, and the rest as they are (C53.7)', () => {
    evidence(
      cryptoWalletVerification({
        masked: true,
        attributes: { 'expected-address': WALLET_ADDRESS },
      }),
      'hidden',
    );

    expect(within(value('Wallet address')).getByText('Hidden')).toBeVisible();
    expect(within(value('Expected address')).getByText('Hidden')).toBeVisible();
    expect(group()).not.toHaveTextContent(WALLET_ADDRESS.slice(2));
    expect(value('Chain')).toHaveTextContent('EVM network 1');
    expect(value('Checksum')).toHaveTextContent('Absent');
  });

  it('shows the expected address the inquiry set', () => {
    evidence(cryptoWalletVerification({ attributes: { 'expected-address': WALLET_ADDRESS } }));

    expect(value('Expected address').textContent).toBe(WALLET_ADDRESS);
  });

  it('shows "Redacted" for both addresses once the inquiry was redacted', () => {
    evidence(cryptoWalletVerification({ masked: true }), 'redacted');

    expect(value('Wallet address')).toHaveTextContent(/^Redacted$/);
    expect(value('Expected address')).toHaveTextContent(/^Redacted$/);
  });

  it('says what is not recorded yet before the checks ran', () => {
    evidence(
      cryptoWalletVerification({
        attributes: { status: 'initiated', 'signature-scheme': null, checks: [] },
      }),
    );

    for (const term of ['Signature scheme', 'Address type', 'Checksum', 'Flags']) {
      expect(value(term), term).toHaveTextContent(/^Not recorded yet$/);
    }
    expect(value('Chain')).toHaveTextContent('EVM network 1');
  });

  it('shows a value it has no words for as its code', () => {
    evidence(
      cryptoWalletVerification({
        attributes: {
          'signature-scheme': null,
          checks: walletChecks({
            validity: { metadata: { checksum: 'crc32', 'address-type': 'p2qrs' } },
            address: { metadata: { scheme: 'quantum-v1' } },
          }),
        },
      }),
    );

    expect(within(value('Signature scheme')).getByText('quantum-v1').tagName).toBe('CODE');
    expect(within(value('Address type')).getByText('p2qrs').tagName).toBe('CODE');
    expect(within(value('Checksum')).getByText('crc32').tagName).toBe('CODE');
  });
  it('shows a verification of another type in the generic view, never as this one', () => {
    render(
      <CryptoWalletEvidence
        verification={phase5Verification('verification/phone-number')}
        label="Synthetic"
        state="visible"
      />,
    );

    expect(screen.getByRole('group', { name: 'Synthetic evidence' })).toBeVisible();
    expect(screen.queryByText(/^What a pass means/)).not.toBeInTheDocument();
  });

  it('names the EVM RPC asked about a contract wallet, and says when it is the sandbox one (C57.5, ADR 0002 §3d)', () => {
    const { unmount } = evidence(contractWalletVerification());
    const rpc = value('Contract checked by');
    expect(within(rpc).getByText('sandbox').tagName).toBe('CODE');
    expect(rpc).toHaveTextContent(SANDBOX_RPC_TEXT);
    unmount();

    evidence();
    expect(within(group()).queryByText('Contract checked by')).not.toBeInTheDocument();
  });
});

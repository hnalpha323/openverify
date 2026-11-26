/** C57.4, C57.5, C57.6: `crypto_wallet_address_comparison`, the contract-wallet path included. */
import { base58, base64 } from '@scure/base';
import { describe, expect, it } from 'vitest';
import type { ProviderOutcome } from '../government-id/inputs.js';
import { utf8 } from './bytes.js';
import { cryptoWalletContext } from './context.js';
import { cryptoWalletAddressComparison } from './crypto-wallet-address-comparison.js';
import type { ContractWalletResult, CryptoWalletCheckInput } from './inputs.js';
import {
  BITCOIN_CHAIN,
  SANDBOX_CONTRACT_WALLET,
  SOLANA_CHAIN,
  TEST_CHALLENGE,
  XRPL_CHAIN,
  bitcoinTestAddresses,
  evmCryptoInput,
  evmTestAddress,
  signBip137,
  signBip322Simple,
  signPersonalMessage,
  signSolanaMessage,
  solanaOffchainEnvelope,
  solanaProgramDerivedAddress,
  solanaTestKey,
  testPrivateKey,
} from './testing.js';

const CHECK = 'crypto_wallet_address_comparison';
const SANDBOX_RPC = { id: 'sandbox', sandbox: true };
const DEFAULT_THRESHOLDS = {
  'bip137-mode': 'loose',
  'allow-high-s': true,
  'allow-contract-wallets': false,
};
const DEFAULT_BASIS = {
  'bip137-mode': 'provisional',
  'allow-high-s': 'provisional',
  'allow-contract-wallets': 'provisional',
};

const compare = (input: CryptoWalletCheckInput, config?: Record<string, unknown>) =>
  cryptoWalletAddressComparison(
    cryptoWalletContext(input, {
      checks: {
        [CHECK]: { enabled: true, required: true, ...(config === undefined ? {} : { config }) },
      },
    }),
  );

const rpc = (result: ContractWalletResult): ProviderOutcome<ContractWalletResult> => ({
  kind: 'result',
  provider: SANDBOX_RPC,
  result,
});

/** A Safe-shaped submission: the contract wallet is claimed, an owner key signed. */
const safeShaped = (overrides: Partial<CryptoWalletCheckInput> = {}): CryptoWalletCheckInput =>
  evmCryptoInput('address/claimed', {
    walletAddress: SANDBOX_CONTRACT_WALLET,
    submission: {
      signature: signPersonalMessage(utf8(TEST_CHALLENGE), testPrivateKey('address/safe-owner')),
    },
    ...overrides,
  });

describe('crypto_wallet_address_comparison: keys (C57.4)', () => {
  it('passes the claimed key’s EIP-191 signature, with its scheme and flags', () => {
    expect(compare(evmCryptoInput('address/alice'))).toEqual({
      name: CHECK,
      status: 'passed',
      type: 'user_behavior',
      reasons: [],
      metadata: { scheme: 'eip191', 'high-s': false },
      stage: 'ga',
      confidence: null,
      provenance: {
        'implementation-version': 1,
        thresholds: DEFAULT_THRESHOLDS,
        'threshold-basis': DEFAULT_BASIS,
      },
    });
  });

  it('passes a high-s signature flagged, and fails it when the template refuses high s', () => {
    const key = testPrivateKey('address/high-s');
    const input = evmCryptoInput('address/high-s', {
      submission: { signature: signPersonalMessage(utf8(TEST_CHALLENGE), key, { highS: true }) },
    });
    expect(compare(input)).toMatchObject({ status: 'passed', metadata: { 'high-s': true } });
    expect(compare(input, { 'allow-high-s': false })).toMatchObject({
      status: 'failed',
      reasons: ['signature_invalid'],
      metadata: { 'high-s': true },
      provenance: { thresholds: { 'allow-high-s': false } },
    });
  });

  it('passes a loose BIP-137 header flagged, and fails it in strict mode', () => {
    const key = testPrivateKey('address/btc');
    const input = {
      ...evmCryptoInput('address/btc'),
      chainId: BITCOIN_CHAIN,
      walletAddress: bitcoinTestAddresses(key, 'bitcoin').p2wpkh,
      submission: { signature: signBip137('bitcoin', utf8(TEST_CHALLENGE), key, 'p2pkh') },
    };
    expect(compare(input)).toMatchObject({
      status: 'passed',
      metadata: { scheme: 'bip137', 'high-s': false, 'bip137-loose': true },
    });
    expect(compare(input, { 'bip137-mode': 'strict' })).toMatchObject({
      status: 'failed',
      reasons: ['signature_invalid'],
    });
  });

  it('passes a BIP-322 simple signature and a Solana signature, without an ECDSA flag', () => {
    const key = testPrivateKey('address/btc322');
    expect(
      compare({
        ...evmCryptoInput('x'),
        chainId: BITCOIN_CHAIN,
        walletAddress: bitcoinTestAddresses(key, 'bitcoin').p2tr,
        submission: { signature: signBip322Simple('p2tr', utf8(TEST_CHALLENGE), key) },
      }),
    ).toMatchObject({ status: 'passed', metadata: { scheme: 'bip322-simple' } });
    const alice = solanaTestKey('address/alice');
    const solana = compare({
      ...evmCryptoInput('x'),
      chainId: SOLANA_CHAIN,
      walletAddress: alice.address,
      submission: { signature: signSolanaMessage(utf8(TEST_CHALLENGE), alice.seed) },
    });
    expect(solana).toMatchObject({ status: 'passed', metadata: { scheme: 'solana-ed25519' } });
    expect(solana.metadata).not.toHaveProperty('high-s');
  });

  it('fails another key’s signature as a user mistake with a hint, not as fraud', () => {
    const key = testPrivateKey('address/btc-claimed');
    const result = compare({
      ...evmCryptoInput('x'),
      chainId: BITCOIN_CHAIN,
      walletAddress: bitcoinTestAddresses(key, 'bitcoin').p2pkh,
      submission: {
        signature: signBip137(
          'bitcoin',
          utf8(TEST_CHALLENGE),
          testPrivateKey('address/other'),
          'p2pkh',
        ),
      },
    });
    expect(result).toMatchObject({
      status: 'failed',
      type: 'user_behavior',
      reasons: ['signature_address_mismatch'],
    });
  });

  it('fails a signature that does not verify', () => {
    const alice = solanaTestKey('address/sol');
    expect(
      compare({
        ...evmCryptoInput('x'),
        chainId: SOLANA_CHAIN,
        walletAddress: alice.address,
        submission: { signature: signSolanaMessage(utf8('another text'), alice.seed) },
      }),
    ).toMatchObject({ status: 'failed', reasons: ['signature_invalid'] });
  });

  it('fails a claimed address other than the inquiry’s expected one, before any signature', () => {
    expect(
      compare(
        evmCryptoInput('address/alice', { expectedAddress: evmTestAddress(testPrivateKey('bob')) }),
      ),
    ).toMatchObject({ status: 'failed', reasons: ['expected_address_mismatch'], metadata: {} });
    const alice = evmCryptoInput('address/alice');
    expect(
      compare({
        ...alice,
        expectedAddress: alice.walletAddress?.toUpperCase().replace('0X', '0x'),
      }),
    ).toMatchObject({
      status: 'passed',
    });
  });

  it('calls forms it cannot verify inconclusive and proofs that cannot exist unsupported (review)', () => {
    const key = testPrivateKey('address/inconclusive');
    expect(
      compare({
        ...evmCryptoInput('x'),
        chainId: BITCOIN_CHAIN,
        walletAddress: bitcoinTestAddresses(key, 'bitcoin').p2wsh,
        submission: { signature: signBip322Simple('p2wpkh', utf8(TEST_CHALLENGE), key) },
      }),
    ).toMatchObject({ status: 'not_applicable', reasons: ['signature_inconclusive'] });
    expect(
      compare(
        evmCryptoInput('x', {
          submission: { signature: `0x${'11'.repeat(96)}${'6492'.repeat(16)}` },
        }),
      ),
    ).toMatchObject({ status: 'not_applicable', reasons: ['signature_inconclusive'] });
    expect(
      compare({
        ...evmCryptoInput('x'),
        chainId: XRPL_CHAIN,
        walletAddress: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
      }),
    ).toMatchObject({ status: 'not_applicable', reasons: ['ownership_proof_unsupported'] });
    const pda = base58.encode(
      solanaProgramDerivedAddress([utf8('a')], solanaTestKey('p').publicKey),
    );
    expect(
      compare({ ...evmCryptoInput('x'), chainId: SOLANA_CHAIN, walletAddress: pda }),
    ).toMatchObject({
      status: 'not_applicable',
      reasons: ['ownership_proof_unsupported'],
    });
  });

  it.each([
    ['no challenge', { challenge: null }],
    ['no submission', { submission: null }],
    ['no address', { walletAddress: null }],
    ['no chain', { chainId: null }],
    ['an invalid address', { walletAddress: '0x1234' }],
  ])('answers input_missing with %s', (_why, overrides) => {
    expect(compare(evmCryptoInput('address/missing', overrides))).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });
});

// Workflow 5C review P004: ownership is proven over our single-use challenge, so a valid
// signature over other bytes the client names (a public forum post, an older sign-in) proves
// nothing here, even with the statement check advisory or disabled.
describe('crypto_wallet_address_comparison: the challenge binding (C57.4)', () => {
  const key = testPrivateKey('address/binding');
  const forum = utf8('I own this address. Posted on a public forum last year.');

  it('fails signature_invalid for the claimed key’s valid signature over bytes other than our challenge', () => {
    expect(
      compare(
        evmCryptoInput('address/binding', {
          submission: {
            signature: signPersonalMessage(forum, key),
            signedMessage: base64.encode(forum),
          },
        }),
      ),
    ).toMatchObject({ status: 'failed', reasons: ['signature_invalid'] });
  });

  it('passes the claimed key’s signature over exactly our challenge, named as its signed message', () => {
    const challenge = utf8(TEST_CHALLENGE);
    expect(
      compare(
        evmCryptoInput('address/binding', {
          submission: {
            signature: signPersonalMessage(challenge, key),
            signedMessage: base64.encode(challenge),
          },
        }),
      ),
    ).toMatchObject({ status: 'passed' });
  });

  it('passes a Solana off-chain envelope of our challenge naming the key, and no other envelope', () => {
    const alice = solanaTestKey('address/binding-solana');
    const solana = (signed: Uint8Array): CryptoWalletCheckInput => ({
      ...evmCryptoInput('x'),
      chainId: SOLANA_CHAIN,
      walletAddress: alice.address,
      submission: {
        signature: signSolanaMessage(signed, alice.seed),
        signedMessage: base64.encode(signed),
      },
    });

    expect(
      compare(solana(solanaOffchainEnvelope(1, utf8(TEST_CHALLENGE), [alice.publicKey]))),
    ).toMatchObject({ status: 'passed' });
    expect(compare(solana(solanaOffchainEnvelope(1, forum, [alice.publicKey])))).toMatchObject({
      status: 'failed',
      reasons: ['signature_invalid'],
    });
    expect(compare(solana(forum))).toMatchObject({
      status: 'failed',
      reasons: ['signature_invalid'],
    });
  });

  it('fails signature_invalid for a contract wallet that accepts bytes other than our challenge', () => {
    const owner = testPrivateKey('address/safe-owner');
    expect(
      compare(
        safeShaped({
          submission: {
            signature: signPersonalMessage(forum, owner),
            signedMessage: base64.encode(forum),
          },
          contractWallet: rpc({ hasCode: true, signatureValid: true }),
        }),
        { 'allow-contract-wallets': true },
      ),
    ).toMatchObject({ status: 'failed', reasons: ['signature_invalid'] });
  });
});

describe('crypto_wallet_address_comparison: EVM contract wallets (C57.4, C57.5)', () => {
  it('answers provider_not_configured for an unmatched EVM signature without a bound RPC', () => {
    for (const contractWallet of [undefined, { kind: 'not_configured' } as const]) {
      expect(compare(safeShaped({ contractWallet }))).toMatchObject({
        status: 'not_applicable',
        reasons: ['provider_not_configured'],
        metadata: { scheme: 'eip191', 'high-s': false },
      });
    }
  });

  it('answers execution_error when the RPC failed', () => {
    expect(compare(safeShaped({ contractWallet: { kind: 'error' } }))).toMatchObject({
      status: 'not_applicable',
      reasons: ['execution_error'],
    });
  });

  it('fails signature_address_mismatch when the address holds no code', () => {
    const result = compare(
      safeShaped({ contractWallet: rpc({ hasCode: false, signatureValid: null }) }),
    );
    expect(result).toMatchObject({
      status: 'failed',
      reasons: ['signature_address_mismatch'],
      provenance: { provider: SANDBOX_RPC },
    });
  });

  it('fails signature_invalid for bytes no key made at an address without code', () => {
    expect(
      compare(
        evmCryptoInput('address/bytes', {
          submission: { signature: `0x${'ab'.repeat(130)}` },
          contractWallet: rpc({ hasCode: false, signatureValid: null }),
        }),
      ),
    ).toMatchObject({ status: 'failed', reasons: ['signature_invalid'] });
  });

  it('sends a contract wallet’s valid ERC-1271 answer to review unless the template allows it', () => {
    const contractWallet = rpc({ hasCode: true, signatureValid: true });
    expect(compare(safeShaped({ contractWallet }))).toMatchObject({
      status: 'not_applicable',
      reasons: ['contract_wallet_not_allowed'],
      metadata: { scheme: 'eip191', 'contract-wallet': true },
      provenance: { provider: SANDBOX_RPC },
    });
    expect(
      compare(safeShaped({ contractWallet }), { 'allow-contract-wallets': true }),
    ).toMatchObject({
      status: 'passed',
      metadata: { 'contract-wallet': true },
      provenance: { thresholds: { 'allow-contract-wallets': true } },
    });
    expect(
      compare(
        safeShaped({
          contractWallet,
          expectedAddress: SANDBOX_CONTRACT_WALLET.toUpperCase().replace('0X', '0x'),
        }),
      ),
    ).toMatchObject({ status: 'passed', metadata: { 'contract-wallet': true } });
  });

  it('fails signature_invalid when the contract refuses the signature', () => {
    expect(
      compare(safeShaped({ contractWallet: rpc({ hasCode: true, signatureValid: false }) })),
    ).toMatchObject({ status: 'failed', reasons: ['signature_invalid'] });
    expect(
      compare(safeShaped({ contractWallet: rpc({ hasCode: true, signatureValid: null }) })),
    ).toMatchObject({ status: 'not_applicable', reasons: ['execution_error'] });
  });

  it('never copies an address, a signature or the challenge into the result', () => {
    const serialized = JSON.stringify(
      compare(safeShaped({ contractWallet: rpc({ hasCode: true, signatureValid: true }) })),
    );
    expect(serialized).not.toContain('c0de5');
    expect(serialized).not.toContain('Nonce');
  });
});

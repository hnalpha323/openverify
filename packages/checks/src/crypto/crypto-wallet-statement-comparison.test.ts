/** C57.4: `crypto_wallet_statement_comparison`: the verified signature covers exactly our challenge. */
import { base64 } from '@scure/base';
import { describe, expect, it } from 'vitest';
import type { ProviderOutcome } from '../government-id/inputs.js';
import { utf8 } from './bytes.js';
import { cryptoWalletContext } from './context.js';
import { cryptoWalletStatementComparison } from './crypto-wallet-statement-comparison.js';
import type { ContractWalletResult, CryptoWalletCheckInput } from './inputs.js';
import {
  SANDBOX_CONTRACT_WALLET,
  SOLANA_CHAIN,
  TEST_CHALLENGE,
  evmCryptoInput,
  signPersonalMessage,
  signSolanaMessage,
  solanaOffchainEnvelope,
  solanaTestKey,
  testPrivateKey,
} from './testing.js';

const CHECK = 'crypto_wallet_statement_comparison';
const compare = (input: CryptoWalletCheckInput) =>
  cryptoWalletStatementComparison(
    cryptoWalletContext(input, { checks: { [CHECK]: { enabled: true, required: true } } }),
  );

const alice = solanaTestKey('statement/alice');
const solana = (signedBytes: Uint8Array, signer = alice): CryptoWalletCheckInput => ({
  ...evmCryptoInput('x'),
  chainId: SOLANA_CHAIN,
  walletAddress: alice.address,
  submission: {
    signature: signSolanaMessage(signedBytes, signer.seed),
    signedMessage: base64.encode(signedBytes),
  },
});

describe('crypto_wallet_statement_comparison (C57.4)', () => {
  it('passes a verified signature over exactly the challenge', () => {
    expect(compare(evmCryptoInput('statement/evm'))).toEqual({
      name: CHECK,
      status: 'passed',
      type: 'fraud',
      reasons: [],
      metadata: {},
      stage: 'ga',
      confidence: null,
      provenance: { 'implementation-version': 1, thresholds: {} },
    });
  });

  it('fails statement_mismatch for a verified signature over other bytes', () => {
    const key = testPrivateKey('statement/evm');
    const other = utf8('a message from another session');
    expect(
      compare(
        evmCryptoInput('statement/evm', {
          submission: {
            signature: signPersonalMessage(other, key),
            signedMessage: base64.encode(other),
          },
        }),
      ),
    ).toMatchObject({ status: 'failed', reasons: ['statement_mismatch'] });
  });

  it('unwraps a Solana off-chain envelope that names the claimed key', () => {
    for (const version of [0, 1] as const) {
      expect(
        compare(solana(solanaOffchainEnvelope(version, utf8(TEST_CHALLENGE), [alice.publicKey]))),
      ).toMatchObject({
        status: 'passed',
        metadata: { envelope: `solana-offchain-v${String(version)}` },
      });
    }
    expect(compare(solana(utf8(TEST_CHALLENGE)))).toMatchObject({ status: 'passed', metadata: {} });
  });

  it('fails an envelope around other content or without the claimed key', () => {
    expect(
      compare(solana(solanaOffchainEnvelope(1, utf8('other'), [alice.publicKey]))),
    ).toMatchObject({
      status: 'failed',
      reasons: ['statement_mismatch'],
    });
    const bob = solanaTestKey('statement/bob');
    expect(
      compare(solana(solanaOffchainEnvelope(1, utf8(TEST_CHALLENGE), [bob.publicKey]))),
    ).toMatchObject({
      status: 'failed',
      reasons: ['statement_mismatch'],
    });
  });

  it('compares a contract wallet’s bytes once its ERC-1271 answer verified them', () => {
    const contractWallet: ProviderOutcome<ContractWalletResult> = {
      kind: 'result',
      provider: { id: 'sandbox', sandbox: true },
      result: { hasCode: true, signatureValid: true },
    };
    const input = evmCryptoInput('statement/safe', {
      walletAddress: SANDBOX_CONTRACT_WALLET,
      submission: {
        signature: signPersonalMessage(utf8(TEST_CHALLENGE), testPrivateKey('statement/owner')),
      },
      contractWallet,
    });
    expect(compare(input).status).toBe('passed');
    expect(compare({ ...input, contractWallet: undefined })).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });

  it.each([
    [
      'another key’s signature',
      { submission: { signature: signPersonalMessage(utf8(TEST_CHALLENGE), testPrivateKey('z')) } },
    ],
    ['a malformed signature', { submission: { signature: '0x12' } }],
    ['no submission', { submission: null }],
    ['no challenge', { challenge: null }],
  ])('answers input_missing with %s: no verified signature', (_why, overrides) => {
    expect(compare(evmCryptoInput('statement/evm', overrides))).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });
});

/** C57.4: `crypto_wallet_disallowed_chain_detection` over the type-level `allowed-chains`. */
import { describe, expect, it } from 'vitest';
import { cryptoWalletContext } from './context.js';
import { cryptoWalletDisallowedChainDetection } from './crypto-wallet-disallowed-chain-detection.js';
import { SOLANA_CHAIN, evmCryptoInput } from './testing.js';

const CHECK = 'crypto_wallet_disallowed_chain_detection';
const checks = { [CHECK]: { enabled: true, required: true } };

const detect = (allowedChains?: string[], chainId: string | null = 'eip155:1') =>
  cryptoWalletDisallowedChainDetection(
    cryptoWalletContext(evmCryptoInput('chains', { chainId }), {
      checks,
      ...(allowedChains === undefined ? {} : { 'allowed-chains': allowedChains }),
    }),
  );

describe('crypto_wallet_disallowed_chain_detection (C57.4)', () => {
  it('answers the non-blocking no_allowlist without an allowlist', () => {
    expect(detect()).toEqual({
      name: CHECK,
      status: 'not_applicable',
      type: 'fraud',
      reasons: ['no_allowlist'],
      metadata: {},
      stage: 'ga',
      confidence: null,
      provenance: { 'implementation-version': 1, thresholds: {} },
    });
  });

  it('passes a chain on the allowlist and records the list', () => {
    expect(detect(['eip155:1', SOLANA_CHAIN])).toMatchObject({
      status: 'passed',
      provenance: { thresholds: { 'allowed-chains': ['eip155:1', SOLANA_CHAIN] } },
    });
  });

  it('fails a chain off the allowlist', () => {
    expect(detect([SOLANA_CHAIN])).toMatchObject({
      status: 'failed',
      reasons: ['chain_not_allowed'],
    });
    expect(detect(['eip155:137'])).toMatchObject({
      status: 'failed',
      reasons: ['chain_not_allowed'],
    });
  });

  it('answers input_missing without a chain', () => {
    expect(detect([SOLANA_CHAIN], null)).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });
});

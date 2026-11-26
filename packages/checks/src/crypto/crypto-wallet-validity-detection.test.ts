/** C57.4: `crypto_wallet_validity_detection`. */
import { base58 } from '@scure/base';
import { describe, expect, it } from 'vitest';
import { cryptoWalletContext } from './context.js';
import { cryptoWalletValidityDetection } from './crypto-wallet-validity-detection.js';
import type { CryptoWalletCheckInput } from './inputs.js';
import {
  BITCOIN_CHAIN,
  SOLANA_CHAIN,
  bitcoinTestAddresses,
  evmCryptoInput,
  solanaProgramDerivedAddress,
  solanaTestKey,
  testPrivateKey,
} from './testing.js';

const CHECK = 'crypto_wallet_validity_detection';
const TEMPLATE = { checks: { [CHECK]: { enabled: true, required: true } } };

const detect = (
  overrides: Partial<CryptoWalletCheckInput> = {},
  config?: Record<string, unknown>,
) =>
  cryptoWalletValidityDetection(
    cryptoWalletContext(
      evmCryptoInput('validity', overrides),
      config === undefined
        ? TEMPLATE
        : { checks: { [CHECK]: { enabled: true, required: true, config } } },
    ),
  );

const PUBLISHED = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';

describe('crypto_wallet_validity_detection (C57.4)', () => {
  it('passes an EIP-55 address, recording the checksum and the default it was judged with', () => {
    expect(detect({ walletAddress: PUBLISHED })).toEqual({
      name: CHECK,
      status: 'passed',
      type: 'user_behavior',
      reasons: [],
      metadata: { checksum: 'valid', 'address-type': 'evm' },
      stage: 'ga',
      confidence: null,
      provenance: {
        'implementation-version': 1,
        thresholds: { 'require-evm-checksum': false },
        'threshold-basis': { 'require-evm-checksum': 'provisional' },
      },
    });
  });

  it('passes an unchecksummed EVM address, flagged, unless the template requires the checksum', () => {
    expect(detect({ walletAddress: PUBLISHED.toLowerCase() })).toMatchObject({
      status: 'passed',
      metadata: { checksum: 'absent' },
    });
    expect(
      detect({ walletAddress: PUBLISHED.toLowerCase() }, { 'require-evm-checksum': true }),
    ).toMatchObject({
      status: 'failed',
      reasons: ['address_checksum_invalid'],
      provenance: { thresholds: { 'require-evm-checksum': true } },
    });
  });

  it('fails a typo as a checksum error and a malformed address as invalid', () => {
    expect(detect({ walletAddress: PUBLISHED.replace('aAeb', 'aaeb') })).toMatchObject({
      status: 'failed',
      reasons: ['address_checksum_invalid'],
      metadata: {},
    });
    expect(detect({ walletAddress: '0x1234' })).toMatchObject({
      status: 'failed',
      reasons: ['address_invalid'],
    });
    expect(detect({ walletAddress: PUBLISHED, chainId: BITCOIN_CHAIN })).toMatchObject({
      status: 'failed',
      reasons: ['address_invalid'],
    });
  });

  it('records the address kind and, for Solana, whether a key can sign for it', () => {
    const { p2wpkh } = bitcoinTestAddresses(testPrivateKey('validity/btc'), 'bitcoin');
    expect(detect({ chainId: BITCOIN_CHAIN, walletAddress: p2wpkh }).metadata).toEqual({
      checksum: 'valid',
      'address-type': 'p2wpkh',
    });
    expect(
      detect({ chainId: SOLANA_CHAIN, walletAddress: solanaTestKey('validity').address }).metadata,
    ).toEqual({ checksum: 'none', 'address-type': 'solana', 'on-curve': true });
    const pda = base58.encode(
      solanaProgramDerivedAddress(
        [new Uint8Array([1])],
        solanaTestKey('validity/program').publicKey,
      ),
    );
    expect(detect({ chainId: SOLANA_CHAIN, walletAddress: pda })).toMatchObject({
      status: 'passed',
      metadata: { 'on-curve': false },
    });
  });

  it.each([
    ['no chain', { chainId: null }],
    ['no address', { walletAddress: null }],
    ['a chain Phase 5 does not know', { chainId: 'cosmos:cosmoshub-4' }],
  ])('answers input_missing with %s', (_why, overrides) => {
    expect(detect(overrides)).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });

  it('never copies the address into the result', () => {
    expect(JSON.stringify(detect({ walletAddress: PUBLISHED }))).not.toMatch(/5aaeb6053f3e94c9b9/i);
  });
});

/**
 * C57.2, C57.3: the rules of a wallet challenge that need no database. Every value is synthetic.
 */
import { CRYPTO_CHALLENGE_NONCE_LENGTH } from '@openverify/contracts';
import { defaultTemplateConfig } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { Phase5ProblemError } from '../../errors.js';
import {
  CRYPTO_CHALLENGE_INVALID_DETAIL,
  EXPECTED_ADDRESS_FIELD,
  cryptoAddressInvalid,
  cryptoChainNotOffered,
  cryptoChallengeInvalid,
  cryptoExpectedAddressMismatch,
  expectedCryptoAddressOf,
  newCryptoChallengeNonce,
  offeredCryptoChains,
  requiresEvmChecksum,
  type CryptoWalletStep,
} from './rules.js';
import { TEST_CHAINS } from './testing.js';

const STEP: CryptoWalletStep = {
  id: 'wallet',
  type: 'crypto_wallet',
  chains: [TEST_CHAINS.ethereum, TEST_CHAINS.bitcoin, TEST_CHAINS.solana],
  signing: ['paste'],
};

describe('offeredCryptoChains (C57.2)', () => {
  it('offers the step’s chains, in order, without an allowlist', () => {
    expect(offeredCryptoChains(STEP, defaultTemplateConfig('crypto_wallet'))).toEqual(STEP.chains);
    expect(offeredCryptoChains(STEP, undefined)).toEqual(STEP.chains);
  });

  it('offers only the chains the type’s allowed-chains also allows', () => {
    const config = {
      ...defaultTemplateConfig('crypto_wallet'),
      'allowed-chains': [TEST_CHAINS.solana, TEST_CHAINS.ethereum, TEST_CHAINS.tron],
    };

    expect(offeredCryptoChains(STEP, config)).toEqual([TEST_CHAINS.ethereum, TEST_CHAINS.solana]);
    expect(offeredCryptoChains(STEP, { ...config, 'allowed-chains': [TEST_CHAINS.tron] })).toEqual(
      [],
    );
  });
});

describe('requiresEvmChecksum (C51.3)', () => {
  const withValidity = (enabled: boolean, config: Record<string, unknown> | undefined) => {
    const template = defaultTemplateConfig('crypto_wallet');
    return {
      ...template,
      checks: {
        ...template.checks,
        crypto_wallet_validity_detection: {
          enabled,
          required: enabled,
          ...(config === undefined ? {} : { config }),
        },
      },
    };
  };

  it('is false by default (decision 19)', () => {
    expect(requiresEvmChecksum(defaultTemplateConfig('crypto_wallet'))).toBe(false);
    expect(requiresEvmChecksum(undefined)).toBe(false);
  });

  it('follows the enabled validity check’s require-evm-checksum', () => {
    expect(requiresEvmChecksum(withValidity(true, { 'require-evm-checksum': true }))).toBe(true);
    expect(requiresEvmChecksum(withValidity(true, { 'require-evm-checksum': false }))).toBe(false);
    expect(requiresEvmChecksum(withValidity(false, { 'require-evm-checksum': true }))).toBe(false);
  });
});

describe('expectedCryptoAddressOf (C57.2)', () => {
  it('reads the inquiry field crypto_wallet_address when it is a non-empty string', () => {
    expect(EXPECTED_ADDRESS_FIELD).toBe('crypto_wallet_address');
    expect(expectedCryptoAddressOf({ crypto_wallet_address: `0x${'ab'.repeat(20)}` })).toBe(
      `0x${'ab'.repeat(20)}`,
    );
  });

  it.each([
    ['no fields', undefined],
    ['null fields', null],
    ['no such field', { name_first: 'Alex' }],
    ['an empty string', { crypto_wallet_address: '' }],
    ['a number', { crypto_wallet_address: 12 }],
    ['null', { crypto_wallet_address: null }],
  ])('is null for %s', (_name, fields) => {
    expect(expectedCryptoAddressOf(fields)).toBeNull();
  });
});

describe('newCryptoChallengeNonce (C57.2)', () => {
  it('is 16 base62 characters, each drawn from the CSPRNG', () => {
    const draws: number[] = [];
    const nonce = newCryptoChallengeNonce((max) => {
      draws.push(max);
      return (draws.length * 7) % max;
    });

    expect(CRYPTO_CHALLENGE_NONCE_LENGTH).toBe(16);
    expect(nonce).toMatch(/^[0-9A-Za-z]{16}$/u);
    expect(draws).toEqual(Array.from({ length: 16 }, () => 62));
  });

  it('differs from one challenge to the next by default', () => {
    const nonces = new Set(Array.from({ length: 50 }, () => newCryptoChallengeNonce()));

    expect(nonces.size).toBe(50);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[0-9A-Za-z]{16}$/u);
    }
  });
});

describe('the problems (C52.7)', () => {
  it.each([
    [() => cryptoChallengeInvalid(), 409, 'crypto_challenge_invalid', CRYPTO_CHALLENGE_INVALID_DETAIL],
    [
      () => cryptoChainNotOffered(),
      422,
      'crypto_chain_not_offered',
      'This chain is not offered in this verification.',
    ],
    [
      () => cryptoAddressInvalid(),
      422,
      'crypto_address_invalid',
      'The wallet address is not valid for the chain.',
    ],
    [
      () => cryptoExpectedAddressMismatch(),
      422,
      'crypto_expected_address_mismatch',
      'The wallet address is not the one this verification expects.',
    ],
  ])('%#: %i %s with its golden detail', (make, status, code, detail) => {
    const error = make();
    expect(error).toBeInstanceOf(Phase5ProblemError);
    expect(error).toMatchObject({ status, code, message: detail });
  });

  it('lets the cap name its own detail', () => {
    expect(cryptoChallengeInvalid('canceled')).toMatchObject({
      status: 409,
      code: 'crypto_challenge_invalid',
      message: 'canceled',
    });
  });
});

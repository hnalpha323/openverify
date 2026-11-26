// @vitest-environment node
import { CRYPTO_CHAINS, CRYPTO_SIGNATURE_SCHEMES } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { passMeansSection, sentencesOf } from '../testing/check-docs';
import { checksSource, unionOf } from '../testing/checks-source';
import {
  CRYPTO_WALLET_PASS_MEANS,
  SANDBOX_RPC_TEXT,
  addressTypeText,
  checksumText,
  cryptoChainText,
  cryptoFlagText,
  signatureSchemeText,
} from './crypto-wallet-words';

/** `docs/checks/crypto-wallet.md`, "What a pass means", as plain words. */
const SECTION = passMeansSection('crypto-wallet.md').toLowerCase();
const addresses = checksSource('crypto/addresses.ts');
/** What `crypto_wallet_validity_detection` records as `address-type` and `checksum` (C57.1). */
const ADDRESS_TYPES = unionOf(addresses, 'CryptoAddressKind');
const CHECKSUMS = unionOf(addresses, 'CryptoAddressChecksum');
const validity = checksSource('crypto/crypto-wallet-validity-detection.ts');
const comparison = checksSource('crypto/crypto-wallet-address-comparison.ts');
const statement = checksSource('crypto/crypto-wallet-statement-comparison.ts');
/** Short words: a capital first, no code, at most 80 characters. */
const WORDS = /^[A-Z][^_]{1,79}$/;
/** A sentence of explanation: a capital first, no code, a full stop at the end. */
const SENTENCE = /^[A-Z][^_]{9,239}\.$/;

/**
 * The flags the checks record (C57.4), with each value that raises one: `high-s` and
 * `bip137-loose` (the address check), `contract-wallet` (an ERC-1271 answer), `on-curve` (a
 * Solana address, either way) and `envelope` (a Solana off-chain message, version 0 or 1).
 */
const FLAGS: readonly (readonly [flag: string, value: unknown])[] = [
  ['high-s', true],
  ['bip137-loose', true],
  ['contract-wallet', true],
  ['on-curve', true],
  ['on-curve', false],
  ['envelope', 'solana-offchain-v0'],
  ['envelope', 'solana-offchain-v1'],
];

describe('what a crypto wallet pass means (C66)', () => {
  it('says what the docs say, sentence by sentence', () => {
    const sentences = sentencesOf(CRYPTO_WALLET_PASS_MEANS);

    expect(sentences.length).toBeGreaterThanOrEqual(2);
    for (const sentence of sentences) {
      expect(SECTION, sentence).toContain(sentence.toLowerCase());
    }
    expect(CRYPTO_WALLET_PASS_MEANS).toMatch(/at signing time/);
    expect(CRYPTO_WALLET_PASS_MEANS).toMatch(/not proof of who the person is/);
  });
});

describe('the crypto wallet evidence in words (C57, C66)', () => {
  it('names each chain Phase 5 knows, and an EVM chain by its number', () => {
    for (const chain of CRYPTO_CHAINS) {
      expect(cryptoChainText(chain.id)).toBe(chain.name);
    }
    expect(cryptoChainText('eip155:1')).toBe('EVM network 1');
    expect(cryptoChainText('eip155:8453')).toBe('EVM network 8453');
    expect(cryptoChainText('cosmos:cosmoshub-4')).toBe('cosmos:cosmoshub-4');
  });

  it.each(CRYPTO_SIGNATURE_SCHEMES)('says the signature scheme %s in words', (scheme) => {
    expect(signatureSchemeText(scheme)).toMatch(WORDS);
  });

  it('reads the ten address types and three checksum states from the evaluators', () => {
    expect(ADDRESS_TYPES).toHaveLength(10);
    expect(CHECKSUMS).toEqual(['valid', 'absent', 'none']);
    expect(validity).toContain("'address-type': address.kind");
    expect(validity).toContain('checksum: address.checksum');
  });

  it.each(ADDRESS_TYPES)('says the address type %s in words', (kind) => {
    expect(addressTypeText(kind)).toMatch(WORDS);
  });

  it.each(CHECKSUMS)('says the checksum state %s in words', (state) => {
    expect(checksumText(state)?.words).toMatch(WORDS);
  });

  it('says an absent EIP-55 checksum, and why it still passes (C57.1, decision 19)', () => {
    expect(checksumText('absent')?.explanation).toMatch(/single-case EVM address.*EIP-55/);
    expect(checksumText('absent')?.explanation).toMatch(SENTENCE);
  });

  it('reads each flag key from the evaluators', () => {
    expect(comparison).toContain("flags['high-s']");
    expect(comparison).toContain("flags['bip137-loose'] = true");
    expect(comparison).toContain("'contract-wallet': true");
    expect(validity).toContain("'on-curve': address.onCurve");
    expect(statement).toContain('envelope: `solana-offchain-v${');
  });

  it.each(FLAGS)('says the flag %s = %s in words, with what it means', (flag, value) => {
    const text = cryptoFlagText(flag, value);

    expect(text?.words).toMatch(WORDS);
    expect(text?.explanation).toMatch(SENTENCE);
  });

  it('raises no flag for a low-s signature, and none for a value it does not know', () => {
    expect(cryptoFlagText('high-s', false)).toBeUndefined();
    expect(cryptoFlagText('bip137-loose', false)).toBeUndefined();
    expect(cryptoFlagText('contract-wallet', 'yes')).toBeUndefined();
    expect(cryptoFlagText('constructor', true)).toBeUndefined();
  });

  it('says a contract wallet proves control of a contract, not of a person (decision 20)', () => {
    expect(cryptoFlagText('contract-wallet', true)?.explanation).toMatch(
      /control of a contract, not of a person/,
    );
  });

  it.each(['constructor', 'toString', 'rsa', 1, null])(
    'knows nothing of %s, a value it was not given words for',
    (value) => {
      expect(signatureSchemeText(value)).toBeUndefined();
      expect(addressTypeText(value)).toBeUndefined();
      expect(checksumText(value)).toBeUndefined();
    },
  );

  it('says the sandbox EVM RPC answers for a test contract, never a real chain (ADR 0002 §3d, C57.5)', () => {
    expect(SANDBOX_RPC_TEXT).toMatch(SENTENCE);
    expect(SANDBOX_RPC_TEXT).toMatch(/never a real chain/);
    expect(SANDBOX_RPC_TEXT).toMatch(/refused in production/);
  });
});

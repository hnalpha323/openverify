/**
 * BIP-137 message signatures against Bitcoin Core's and bitcoinjs-message's published vectors,
 * vectors derived from them by changing only the header byte, and seeded keys on Litecoin and
 * Dogecoin.
 */
import { base64, hex } from '@scure/base';
import { describe, expect, it } from 'vitest';
import { validateCryptoAddress, type CryptoAddress } from './addresses.js';
import { bitcoinMessageDigest, verifyBip137 } from './bip137.js';
import { utf8 } from './bytes.js';
import {
  BIP137_HEADER_BASE,
  BITCOIN_CHAIN,
  BITCOIN_TESTNET_CHAIN,
  DOGECOIN_CHAIN,
  LITECOIN_CHAIN,
  bitcoinTestAddresses,
  signBip137,
  testPrivateKey,
} from './testing.js';
import {
  BIP137_INVALID_VECTORS,
  BIP137_MAGIC_HASH_VECTORS,
  BIP137_MALFORMED_SIGNATURES,
  BIP137_VALID_VECTORS,
} from './vectors/bip137.js';

const CHAINS = { bitcoin: BITCOIN_CHAIN, testnet: BITCOIN_TESTNET_CHAIN, dogecoin: DOGECOIN_CHAIN };

function decoded(chainId: string, address: string): CryptoAddress {
  const result = validateCryptoAddress(chainId, address);
  if (!result.valid) {
    throw new Error(`invalid ${address}`);
  }
  return result.address;
}

/** The same signature with another header base and the same recovery id. */
function withHeader(signature: string, base: number): string {
  const bytes = base64.decode(signature);
  bytes[0] = base + (((bytes[0] ?? 27) - 27) % 4);
  return base64.encode(bytes);
}

const verify = (
  address: CryptoAddress,
  message: string,
  signature: string,
  mode: 'strict' | 'loose' = 'loose',
  legacyOnly = false,
) => verifyBip137(address, utf8(message), signature, { mode, legacyOnly }).outcome;

describe('bitcoinMessageDigest (BIP-137)', () => {
  it.each(BIP137_MAGIC_HASH_VECTORS)(
    'digests $message for $network',
    ({ network, message, magicHash }) => {
      expect(hex.encode(bitcoinMessageDigest(network, utf8(message)))).toBe(magicHash);
    },
  );
});

describe('verifyBip137 (C57.1)', () => {
  it.each(BIP137_VALID_VECTORS)('verifies $description in both modes', (vector) => {
    const address = decoded(CHAINS[vector.network], vector.address);
    for (const mode of ['strict', 'loose'] as const) {
      expect(verifyBip137(address, utf8(vector.message), vector.signature, { mode })).toEqual({
        outcome: 'verified',
        highS: false,
        loose: false,
      });
    }
  });

  it.each(BIP137_INVALID_VECTORS)('does not verify $description', (vector) => {
    const address = decoded(CHAINS[vector.network], vector.address);
    expect(verify(address, vector.message, vector.signature)).not.toBe('verified');
    expect(verify(address, vector.message, vector.signature, 'strict')).not.toBe('verified');
  });

  it('accepts a segwit address signed with a P2PKH header only in loose mode, flagged', () => {
    const vector = BIP137_VALID_VECTORS.find((entry) => entry.address.startsWith('bc1q'));
    const p2sh = BIP137_VALID_VECTORS.find((entry) => entry.address.startsWith('3'));
    for (const entry of [vector, p2sh]) {
      if (entry === undefined) {
        throw new Error('missing vector');
      }
      const address = decoded(BITCOIN_CHAIN, entry.address);
      const electrum = withHeader(entry.signature, BIP137_HEADER_BASE.p2pkh);
      expect(verifyBip137(address, utf8(entry.message), electrum, { mode: 'loose' })).toEqual({
        outcome: 'verified',
        highS: false,
        loose: true,
      });
      expect(verify(address, entry.message, electrum, 'strict')).toBe('invalid');
    }
  });

  it('refuses a P2PKH address signed with a segwit header in strict mode only', () => {
    const vector = BIP137_VALID_VECTORS[2];
    if (vector === undefined) {
      throw new Error('missing vector');
    }
    const address = decoded(BITCOIN_CHAIN, vector.address);
    const segwitHeader = withHeader(vector.signature, BIP137_HEADER_BASE.p2wpkh);
    expect(verify(address, vector.message, segwitHeader, 'strict')).toBe('invalid');
    expect(verifyBip137(address, utf8(vector.message), segwitHeader, { mode: 'loose' })).toEqual({
      outcome: 'verified',
      highS: false,
      loose: true,
    });
  });

  it('restricts BIP-322 legacy to P2PKH addresses and headers', () => {
    const p2pkh = BIP137_VALID_VECTORS[2];
    const p2wpkh = BIP137_VALID_VECTORS.find((entry) => entry.address.startsWith('bc1q'));
    if (p2pkh === undefined || p2wpkh === undefined) {
      throw new Error('missing vector');
    }
    expect(
      verify(decoded(BITCOIN_CHAIN, p2pkh.address), p2pkh.message, p2pkh.signature, 'loose', true),
    ).toBe('verified');
    expect(
      verify(
        decoded(BITCOIN_CHAIN, p2wpkh.address),
        p2wpkh.message,
        p2wpkh.signature,
        'loose',
        true,
      ),
    ).toBe('invalid');
    expect(
      verify(
        decoded(BITCOIN_CHAIN, p2pkh.address),
        p2pkh.message,
        withHeader(p2pkh.signature, BIP137_HEADER_BASE.p2wpkh),
        'loose',
        true,
      ),
    ).toBe('invalid');
  });

  it('tells another key from a script it cannot prove', () => {
    const signer = testPrivateKey('bip137/signer');
    const other = bitcoinTestAddresses(testPrivateKey('bip137/other'), 'bitcoin');
    const message = 'challenge';
    expect(
      verify(
        decoded(BITCOIN_CHAIN, other.p2pkh),
        message,
        signBip137('bitcoin', utf8(message), signer, 'p2pkh'),
      ),
    ).toBe('address_mismatch');
    expect(
      verify(
        decoded(BITCOIN_CHAIN, other.p2wpkh),
        message,
        signBip137('bitcoin', utf8(message), signer, 'p2wpkh'),
      ),
    ).toBe('address_mismatch');
    // A P2SH address may hold any script: a key that is not its P2SH-P2WPKH proves nothing.
    expect(
      verify(
        decoded(BITCOIN_CHAIN, other.p2shP2wpkh),
        message,
        signBip137('bitcoin', utf8(message), signer, 'p2shP2wpkh'),
      ),
    ).toBe('inconclusive');
    for (const address of [other.p2wsh, other.p2tr]) {
      expect(
        verify(
          decoded(BITCOIN_CHAIN, address),
          message,
          signBip137('bitcoin', utf8(message), signer, 'p2wpkh'),
        ),
      ).toBe('inconclusive');
    }
  });

  it('verifies seeded Litecoin and Dogecoin signatures with their own magic', () => {
    const wallet = testPrivateKey('bip137/altcoins');
    const message = 'challenge';
    const litecoin = bitcoinTestAddresses(wallet, 'litecoin');
    expect(
      verify(
        decoded(LITECOIN_CHAIN, litecoin.p2pkh),
        message,
        signBip137('litecoin', utf8(message), wallet, 'p2pkh'),
      ),
    ).toBe('verified');
    expect(
      verify(
        decoded(LITECOIN_CHAIN, litecoin.p2wpkh),
        message,
        signBip137('litecoin', utf8(message), wallet, 'p2wpkh'),
        'strict',
      ),
    ).toBe('verified');
    // The Bitcoin magic is another message on Litecoin.
    expect(
      verify(
        decoded(LITECOIN_CHAIN, litecoin.p2pkh),
        message,
        signBip137('bitcoin', utf8(message), wallet, 'p2pkh'),
      ),
    ).toBe('address_mismatch');
    const dogecoin = bitcoinTestAddresses(wallet, 'dogecoin');
    expect(
      verify(
        decoded(DOGECOIN_CHAIN, dogecoin.p2pkhUncompressed),
        message,
        signBip137('dogecoin', utf8(message), wallet, 'p2pkhUncompressed'),
        'strict',
      ),
    ).toBe('verified');
  });

  it('reports a high-s signature', () => {
    const key = testPrivateKey('bip137/high-s');
    const address = decoded(BITCOIN_CHAIN, bitcoinTestAddresses(key, 'bitcoin').p2pkh);
    const signature = signBip137('bitcoin', utf8('hello'), key, 'p2pkh', { highS: true });
    expect(verifyBip137(address, utf8('hello'), signature, { mode: 'strict' })).toEqual({
      outcome: 'verified',
      highS: true,
      loose: false,
    });
  });

  it.each([
    ...BIP137_MALFORMED_SIGNATURES,
    { description: 'not base64', signature: 'not base64!' },
    {
      description: 'a header below 27',
      signature: base64.encode(Uint8Array.from([26, ...new Uint8Array(64).fill(1)])),
    },
    { description: 'an empty signature', signature: '' },
  ])('refuses $description', ({ signature }) => {
    const address = decoded(BITCOIN_CHAIN, BIP137_VALID_VECTORS[2]?.address ?? '');
    expect(verify(address, 'vires is numeris', signature)).toBe('invalid');
  });
});

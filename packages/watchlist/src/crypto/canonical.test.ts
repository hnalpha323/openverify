/**
 * C79.3 (H16): the test vectors of every row of the format table, the `ga` condition of
 * `crypto-address-watchlist` (C69.1). Vectors are published examples (EIP-55, BIP-173, BIP-350,
 * the CashAddr specification) or synthetic: payloads of repeated bytes encoded here with base58check,
 * never a listed address.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CRYPTO_ADDRESS_MAX_LENGTH,
  canonicaliseCryptoAddress,
  recordCryptoRows,
  stripCryptoUri,
} from './index.js';

const BITCOIN = 'bip122:000000000019d6689c085ae165831e93';
const BITCOIN_TESTNET = 'bip122:000000000933ea01ad0ee984209779ba';
const LITECOIN = 'bip122:12a765e31ffd4059bada1e25190f6e98';
const DOGECOIN = 'bip122:1a91e3dace36e2be3bf030a65679fe82';
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const TRON = 'tron:728126428';
const XRPL = 'xrpl:0';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes: Uint8Array): string {
  let number = BigInt(`0x${Buffer.from(bytes).toString('hex') || '0'}`);
  let out = '';
  while (number > 0n) {
    out = (ALPHABET[Number(number % 58n)] ?? '') + out;
    number /= 58n;
  }
  const zeros = bytes.findIndex((byte) => byte !== 0);
  return '1'.repeat(zeros === -1 ? bytes.length : zeros) + out;
}
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest();
function base58check(...parts: readonly number[][]): string {
  const payload = Uint8Array.from(parts.flat());
  return base58(Uint8Array.from([...payload, ...sha256(sha256(payload)).subarray(0, 4)]));
}
const bytes = (value: number, count: number) => Array.from({ length: count }, () => value);

const canonical = (value: string, options?: Parameters<typeof canonicaliseCryptoAddress>[1]) => {
  const address = canonicaliseCryptoAddress(value, options);
  if (address === null) {
    throw new Error('expected an address');
  }
  return address;
};

describe('stripCryptoUri', () => {
  it('strips a BIP-21 or EIP-681 scheme, its pay- prefix, chain, function and query', () => {
    expect(stripCryptoUri(' bitcoin:1PMycacnJaSqwwJqjawXBErnLsZ7RkXUAs?amount=1 ')).toBe(
      '1PMycacnJaSqwwJqjawXBErnLsZ7RkXUAs',
    );
    expect(
      stripCryptoUri(
        'ethereum:pay-0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed@1/transfer?uint256=1',
      ),
    ).toBe('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
    expect(stripCryptoUri('LITECOIN:Labc?label=x')).toBe('Labc');
    expect(stripCryptoUri('bitcoincash:qpm2')).toBe('bitcoincash:qpm2');
  });
});

describe('row 1: the C57 chains', () => {
  it('lower-cases EVM hex, keeps the EIP-55 verdict and names the chain only from a chain id', () => {
    expect(canonical('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toEqual({
      raw: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
      canonical: '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed',
      format: 'evm',
      chain: 'unknown',
      checksum: 'valid',
      ticker: null,
    });
    expect(canonical('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed').checksum).toBe('absent');
    const typo = canonical('0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
    expect(typo).toMatchObject({ checksum: 'invalid', format: 'evm' });
    expect(typo.canonical).toBe('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed');
    expect(
      canonical('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', { chainId: 'eip155:137' }).chain,
    ).toBe('eip155:137');
  });

  it('keeps base58 Bitcoin, Litecoin and Dogecoin addresses exact, by their version byte', () => {
    expect(canonical('1PMycacnJaSqwwJqjawXBErnLsZ7RkXUAs')).toMatchObject({
      canonical: '1PMycacnJaSqwwJqjawXBErnLsZ7RkXUAs',
      format: 'bitcoin',
      chain: BITCOIN,
      checksum: 'valid',
    });
    const litecoin = base58check([0x30], bytes(0x11, 20));
    expect(canonical(litecoin)).toMatchObject({
      canonical: litecoin,
      format: 'bitcoin',
      chain: LITECOIN,
      checksum: 'valid',
    });
    expect(canonical('DFpN6QqFfUm3gKNaxN6tNcab1FArL9cZLE')).toMatchObject({
      format: 'bitcoin',
      chain: DOGECOIN,
      checksum: 'valid',
    });
    expect(canonical('1PMycacnJaSqwwJqjawXBErnLsZ7RkXUAt')).toMatchObject({
      canonical: '1PMycacnJaSqwwJqjawXBErnLsZ7RkXUAt',
      format: 'bitcoin',
      checksum: 'invalid',
    });
  });

  it('lower-cases bech32 and bech32m segwit addresses (BIP-173, BIP-350)', () => {
    expect(canonical('BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4')).toMatchObject({
      canonical: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      format: 'bitcoin',
      chain: BITCOIN,
      checksum: 'valid',
    });
    expect(
      canonical('bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0'),
    ).toMatchObject({ format: 'bitcoin', checksum: 'valid' });
    expect(
      canonical('tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7'),
    ).toMatchObject({ chain: BITCOIN_TESTNET, checksum: 'valid' });
    expect(canonical('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5')).toMatchObject({
      canonical: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5',
      format: 'bitcoin',
      checksum: 'invalid',
    });
  });

  it('keeps Solana, TRON and XRP Ledger addresses exact', () => {
    const solana = base58(Uint8Array.from(bytes(0x55, 32)));
    expect(canonical(solana)).toMatchObject({
      canonical: solana,
      format: 'base58',
      chain: SOLANA,
      checksum: 'none',
    });
    expect(canonical('T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb')).toMatchObject({
      format: 'base58',
      chain: TRON,
      checksum: 'valid',
    });
    expect(canonical('rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh')).toMatchObject({
      format: 'base58',
      chain: XRPL,
      checksum: 'valid',
    });
    expect(canonical('rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTi')).toMatchObject({
      format: 'base58',
      chain: XRPL,
      checksum: 'invalid',
    });
  });
});

describe('row 2: Bitcoin Cash CashAddr', () => {
  it('lower-cases it and strips bitcoincash: (the specification vectors)', () => {
    expect(canonical('bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a')).toEqual({
      raw: 'bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a',
      canonical: 'qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a',
      format: 'cashaddr',
      chain: 'unknown',
      checksum: 'valid',
      ticker: null,
    });
    expect(canonical('BITCOINCASH:PPM2QSZNHKS23Z7629MMS6S4CWEF74VCWVN0H829PQ')).toMatchObject({
      canonical: 'ppm2qsznhks23z7629mms6s4cwef74vcwvn0h829pq',
      checksum: 'valid',
    });
    expect(canonical('qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a').format).toBe('cashaddr');
    expect(canonical('bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6q')).toMatchObject({
      format: 'cashaddr',
      checksum: 'invalid',
    });
  });
});

describe('row 3: formats kept raw', () => {
  it.each([
    ['Monero', `4${'A'.repeat(94)}`],
    ['Dash', base58check([0x4c], bytes(0x22, 20))],
    ['Zcash t-address', base58check([0x1c, 0xb8], bytes(0x44, 20))],
    ['Bitcoin Gold', base58check([0x26], bytes(0x33, 20))],
    ['BNB Beacon', `bnb1${'q'.repeat(38)}`],
  ])('keeps a %s address as its trimmed string', (_, address) => {
    expect(canonical(` ${address} `)).toMatchObject({
      raw: address,
      canonical: address,
      format: 'raw',
      chain: 'unknown',
    });
  });

  it('reads Bitcoin SV and Verge as the Bitcoin and Dogecoin encodings they share', () => {
    expect(canonical('1PMycacnJaSqwwJqjawXBErnLsZ7RkXUAs', { ticker: 'bsv' })).toMatchObject({
      format: 'bitcoin',
      ticker: 'BSV',
    });
    expect(canonical('DFpN6QqFfUm3gKNaxN6tNcab1FArL9cZLE', { ticker: 'XVG' }).format).toBe(
      'bitcoin',
    );
  });
});

describe('row 4: anything else', () => {
  it('keeps the trimmed string, unclassified, and never drops it', () => {
    expect(canonical('  not-a-known-address-format  ')).toEqual({
      raw: 'not-a-known-address-format',
      canonical: 'not-a-known-address-format',
      format: 'unclassified',
      chain: 'unknown',
      checksum: 'none',
      ticker: null,
    });
    expect(canonical('x'.repeat(300)).raw).toHaveLength(CRYPTO_ADDRESS_MAX_LENGTH);
    expect(canonicaliseCryptoAddress('   ')).toBeNull();
    expect(canonicaliseCryptoAddress('bitcoin:')).toBeNull();
  });
});

describe('the ticker is metadata', () => {
  it('never names the chain: a TRON-format address listed as XBT is TRON', () => {
    expect(canonical('T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb', { ticker: 'xbt' })).toMatchObject({
      chain: TRON,
      ticker: 'XBT',
    });
  });
});

describe('recordCryptoRows', () => {
  it('canonicalises every listed address with its ticker, keeping a repeat under one ticker once', () => {
    const rows = recordCryptoRows({
      crypto_addresses: [
        { raw: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', ticker: 'ETH' },
        { raw: '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed', ticker: 'ETH' },
        { raw: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', ticker: 'ARB' },
        { raw: 'not-a-known-address-format', ticker: 'XYZ' },
      ],
    });
    expect(rows.map((row) => [row.canonical.slice(0, 6), row.ticker, row.format])).toEqual([
      ['0x5aae', 'ETH', 'evm'],
      ['0x5aae', 'ARB', 'evm'],
      ['not-a-', 'XYZ', 'unclassified'],
    ]);
  });
});

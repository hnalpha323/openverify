/**
 * Synthetic crypto addresses for the fixture lists (C77.5, C79.3). Each format of the C79.3 table
 * is written with its own encoding (base58check, bech32, CashAddr) over seeded random bytes, so an
 * address is well formed yet controlled by nobody; a few published test vectors (a key published
 * for tests, the EIP-55 and BIP-173 examples) stand in where a fixture needs a fixed value. No real
 * sanctioned address is ever written.
 */
import { createHash } from 'node:crypto';
import { eip55Checksum, toEip55Address } from '@openverify/checks';
import type { SeededRandom } from './random.js';

/** The address formats the generator writes (one per row of the C79.3 table, and the extras). */
export const SYNTHETIC_CRYPTO_FORMATS = [
  'evm_lower',
  'evm_checksummed',
  'bitcoin_p2pkh',
  'bitcoin_p2sh',
  'bitcoin_p2wpkh',
  'bitcoin_testnet_p2wpkh',
  'litecoin_p2pkh',
  'litecoin_p2wpkh',
  'dogecoin_p2pkh',
  'solana',
  'tron',
  'xrpl',
  'bitcoin_cash',
  'monero',
  'dash',
  'zcash_transparent',
  'bitcoin_gold',
  'bnb_beacon',
  'unclassified',
] as const;
export type SyntheticCryptoFormat = (typeof SYNTHETIC_CRYPTO_FORMATS)[number];

/** The ticker a list would print beside each format (OFAC's symbols; tickers do not name chains). */
export const DEFAULT_CRYPTO_TICKERS: Readonly<Record<SyntheticCryptoFormat, string>> =
  Object.freeze({
    evm_lower: 'ETH',
    evm_checksummed: 'ETH',
    bitcoin_p2pkh: 'XBT',
    bitcoin_p2sh: 'XBT',
    bitcoin_p2wpkh: 'XBT',
    bitcoin_testnet_p2wpkh: 'XBT',
    litecoin_p2pkh: 'LTC',
    litecoin_p2wpkh: 'LTC',
    dogecoin_p2pkh: 'DOGE',
    solana: 'SOL',
    tron: 'TRX',
    xrpl: 'XRP',
    bitcoin_cash: 'BCH',
    monero: 'XMR',
    dash: 'DASH',
    zcash_transparent: 'ZEC',
    bitcoin_gold: 'BTG',
    bnb_beacon: 'BNB',
    unclassified: 'SYN',
  });

/** Addresses from published test material, for fixtures that need a fixed value. */
export const PUBLISHED_TEST_ADDRESSES = Object.freeze({
  /**
   * Account 0 of the Hardhat development network, derived from the key Hardhat publishes for tests
   * (the same address the frozen record's golden vector uses).
   */
  hardhatAccount0: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  /** The mixed-case example of EIP-55 (CC0). */
  eip55Example: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
  /** BIP-173's P2WPKH example (program `751e76e8…3bd6`). */
  bip173P2wpkh: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
});

/** A synthetic address in a list: its format, the raw string and the ticker beside it. */
export interface SyntheticCryptoAddress {
  readonly format: SyntheticCryptoFormat;
  readonly raw: string;
  readonly ticker: string;
}

/** The Bitcoin base58 alphabet. */
export const BASE58_BITCOIN = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** The XRP Ledger base58 alphabet. */
export const BASE58_RIPPLE = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz';

/** The bech32 and CashAddr character set (BIP-173). */
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const CASHADDR_GENERATOR = [
  0x98f2bc8e61n,
  0x79b76d99e2n,
  0xf33e5fb3c4n,
  0xae2eabe2a8n,
  0x1e4f43e470n,
];

const sha256 = (bytes: Uint8Array): Uint8Array =>
  new Uint8Array(createHash('sha256').update(bytes).digest());

const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

/** Base58 of `bytes` in `alphabet` (leading zero bytes as the alphabet's first character). */
export function base58Encode(bytes: Uint8Array, alphabet: string = BASE58_BITCOIN): string {
  let value = bytes.length === 0 ? 0n : BigInt(`0x${toHex(bytes)}`);
  let text = '';
  while (value > 0n) {
    text = `${alphabet.charAt(Number(value % 58n))}${text}`;
    value /= 58n;
  }
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) {
    zeros += 1;
  }
  return `${alphabet.charAt(0).repeat(zeros)}${text}`;
}

/** Base58check: `payload` and the first four bytes of its double SHA-256. */
export function base58CheckEncode(payload: Uint8Array, alphabet: string = BASE58_BITCOIN): string {
  const checksum = sha256(sha256(payload)).slice(0, 4);
  return base58Encode(Uint8Array.from([...payload, ...checksum]), alphabet);
}

/** Regroups bits (8 to 5 with padding), as BIP-173 does. */
function toFiveBitGroups(bytes: Uint8Array): number[] {
  const groups: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const byte of bytes) {
    accumulator = ((accumulator << 8) | byte) & 0xfff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      groups.push((accumulator >> bits) & 31);
    }
  }
  if (bits > 0) {
    groups.push((accumulator << (5 - bits)) & 31);
  }
  return groups;
}

function bech32Polymod(values: readonly number[]): number {
  let check = 1;
  for (const value of values) {
    const top = check >>> 25;
    check = (((check & 0x1ffffff) << 5) ^ value) >>> 0;
    BECH32_GENERATOR.forEach((word, bit) => {
      if (((top >>> bit) & 1) === 1) {
        check = (check ^ word) >>> 0;
      }
    });
  }
  return check;
}

/** Bech32 (BIP-173, constant 1) of five-bit groups under `hrp`. */
function bech32Encode(hrp: string, data: readonly number[]): string {
  const expanded = [
    ...Array.from(hrp, (character) => character.charCodeAt(0) >> 5),
    0,
    ...Array.from(hrp, (character) => character.charCodeAt(0) & 31),
  ];
  const polymod = bech32Polymod([...expanded, ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, index) => (polymod >>> (5 * (5 - index))) & 31);
  return `${hrp}1${[...data, ...checksum].map((group) => BECH32_CHARSET.charAt(group)).join('')}`;
}

/** A BIP-173 segwit address (bech32, witness version 0). */
export function segwitV0Address(hrp: string, program: Uint8Array): string {
  return bech32Encode(hrp, [0, ...toFiveBitGroups(program)]);
}

/** Bech32 of plain bytes under `hrp` (no witness version), as BNB Beacon Chain addresses are. */
export function bech32Bytes(hrp: string, bytes: Uint8Array): string {
  return bech32Encode(hrp, toFiveBitGroups(bytes));
}

function cashAddrPolymod(values: readonly number[]): bigint {
  let check = 1n;
  for (const value of values) {
    const top = check >> 35n;
    check = ((check & 0x07ffffffffn) << 5n) ^ BigInt(value);
    CASHADDR_GENERATOR.forEach((word, bit) => {
      if (((top >> BigInt(bit)) & 1n) === 1n) {
        check ^= word;
      }
    });
  }
  return check ^ 1n;
}

/** A CashAddr address (`<prefix>:q…` for P2PKH, `p…` for P2SH) of a 20-byte hash. */
export function cashAddress(prefix: string, kind: 'p2pkh' | 'p2sh', hash: Uint8Array): string {
  if (hash.length !== 20) {
    throw new RangeError('a CashAddr hash here has 20 bytes');
  }
  const version = kind === 'p2pkh' ? 0 : 8;
  const data = toFiveBitGroups(Uint8Array.from([version, ...hash]));
  const prefixGroups = Array.from(prefix, (character) => character.charCodeAt(0) & 31);
  const polymod = cashAddrPolymod([...prefixGroups, 0, ...data, 0, 0, 0, 0, 0, 0, 0, 0]);
  const checksum = Array.from({ length: 8 }, (_, index) =>
    Number((polymod >> BigInt(5 * (7 - index))) & 31n),
  );
  return `${prefix}:${[...data, ...checksum].map((group) => BECH32_CHARSET.charAt(group)).join('')}`;
}

/** An EIP-55 address whose letters carry a checksum (redrawn in the rare case they cannot). */
function checksummedEvmAddress(random: SeededRandom): string {
  for (;;) {
    const address = toEip55Address(toHex(random.bytes(20)));
    if (eip55Checksum(address) === 'valid') {
      return address;
    }
  }
}

const versioned = (version: readonly number[], random: SeededRandom, length = 20): Uint8Array =>
  Uint8Array.from([...version, ...random.bytes(length)]);

function rawAddress(random: SeededRandom, format: SyntheticCryptoFormat): string {
  switch (format) {
    case 'evm_lower':
      return `0x${toHex(random.bytes(20))}`;
    case 'evm_checksummed':
      return checksummedEvmAddress(random);
    case 'bitcoin_p2pkh':
      return base58CheckEncode(versioned([0x00], random));
    case 'bitcoin_p2sh':
      return base58CheckEncode(versioned([0x05], random));
    case 'bitcoin_p2wpkh':
      return segwitV0Address('bc', random.bytes(20));
    case 'bitcoin_testnet_p2wpkh':
      return segwitV0Address('tb', random.bytes(20));
    case 'litecoin_p2pkh':
      return base58CheckEncode(versioned([0x30], random));
    case 'litecoin_p2wpkh':
      return segwitV0Address('ltc', random.bytes(20));
    case 'dogecoin_p2pkh':
      return base58CheckEncode(versioned([0x1e], random));
    case 'solana':
      return base58Encode(random.bytes(32));
    case 'tron':
      return base58CheckEncode(versioned([0x41], random));
    case 'xrpl':
      return base58CheckEncode(versioned([0x00], random), BASE58_RIPPLE);
    case 'bitcoin_cash':
      return cashAddress('bitcoincash', 'p2pkh', random.bytes(20));
    case 'monero':
      // Raw only: the C79.3 table compares Monero addresses as written, without a checksum.
      return `4${random.string(BASE58_BITCOIN, 94)}`;
    case 'dash':
      return base58CheckEncode(versioned([0x4c], random));
    case 'zcash_transparent':
      return base58CheckEncode(versioned([0x1c, 0xb8], random));
    case 'bitcoin_gold':
      return base58CheckEncode(versioned([0x26], random));
    case 'bnb_beacon':
      return bech32Bytes('bnb', random.bytes(20));
    case 'unclassified':
      return `SYN-${random.string('0123456789ABCDEF', 30)}`;
  }
}

/** A synthetic address of `format`, with its ticker (the format's default unless given). */
export function syntheticCryptoAddress(
  random: SeededRandom,
  format: SyntheticCryptoFormat,
  ticker?: string,
): SyntheticCryptoAddress {
  return {
    format,
    raw: rawAddress(random, format),
    ticker: ticker ?? DEFAULT_CRYPTO_TICKERS[format],
  };
}

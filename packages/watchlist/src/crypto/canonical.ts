/**
 * C79.3 (H16): crypto addresses, canonicalised the same way for the query and for every list
 * address at ingestion. Surrounding whitespace and a URI scheme and query (`bitcoin:` BIP-21,
 * `ethereum:` EIP-681; and, ours, `litecoin:` and `dogecoin:` in the BIP-21 shape) are stripped
 * first; the format is then derived from the address itself, never from a list's ticker (OFAC's
 * USDT appears in TRON, Ethereum and Omni formats), and the ticker is kept as metadata. An
 * address that fails its checksum is kept, never dropped: its canonical form does not depend on
 * the checksum. An exact match on the canonical form is the only match (R).
 *
 * | Format | Canonical form |
 * |---|---|
 * | The C57 chains: EVM, Bitcoin and its testnet, Litecoin, Dogecoin, Solana, TRON, XRPL | C57's (EVM lower-cased hex, bech32 lower-cased, base58 exact); an EVM address matches on every EVM chain |
 * | Bitcoin Cash CashAddr | lower-cased, `bitcoincash:` stripped |
 * | Monero, Dash, Zcash t-addresses, Bitcoin Gold, Bitcoin SV, Verge, BNB Beacon `bnb1` | the raw string after trimming |
 * | anything else | the raw string after trimming, with `unclassified_format` in `coverage.limits` |
 *
 * Bitcoin SV and Verge share their encodings with Bitcoin and Dogecoin, so they read as those
 * formats; their canonical form is the same exact string either way.
 */
import { createHash } from 'node:crypto';
import { capText, eip55Checksum, validateCryptoAddress } from '@openverify/checks';
import { cryptoChainFamily } from '@openverify/core';
import type { WatchlistRecord } from '../record/index.js';

/** C79.3: the format families, as `CRYPTO_ADDRESS_FORMATS` (contracts) names them. */
export type CryptoAddressFormat =
  'evm' | 'bitcoin' | 'cashaddr' | 'base58' | 'raw' | 'unclassified';

/** As OFAC allows (C79.3): longer input is cut to this many characters. */
export const CRYPTO_ADDRESS_MAX_LENGTH = 256;

export interface CanonicalCryptoAddress {
  /** The address as given, trimmed, its URI scheme and query removed. */
  readonly raw: string;
  /** What an exact match compares. */
  readonly canonical: string;
  readonly format: CryptoAddressFormat;
  /** The CAIP-2 chain the format names, or `unknown` (an EVM address without a chain id). */
  readonly chain: string;
  /** `absent`: an EVM address in one case; `none`: a format without a checksum we read. */
  readonly checksum: 'valid' | 'invalid' | 'absent' | 'none';
  /** The list's ticker (upper case), metadata only. */
  readonly ticker: string | null;
}

const BITCOIN = 'bip122:000000000019d6689c085ae165831e93';
const BITCOIN_TESTNET = 'bip122:000000000933ea01ad0ee984209779ba';
const LITECOIN = 'bip122:12a765e31ffd4059bada1e25190f6e98';
const DOGECOIN = 'bip122:1a91e3dace36e2be3bf030a65679fe82';
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const TRON = 'tron:728126428';
const XRPL = 'xrpl:0';

/** The URI schemes stripped (BIP-21 and EIP-681; `litecoin:` and `dogecoin:`, ours). */
const SCHEME = /^(?:bitcoin|ethereum|litecoin|dogecoin):/iu;
const EVM = /^0x[\dA-Fa-f]{40}$/u;
const BECH32_DATA = /^[02-9ac-hj-np-z]+$/u;
const CASHADDR = /^(?:bitcoincash:)?([pq][02-9ac-hj-np-z]{41})$/iu;
const BNB_BEACON = /^bnb1[02-9ac-hj-np-z]{38}$/u;
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const MONERO = /^[48][1-9A-HJ-NP-Za-km-z]{94}(?:[1-9A-HJ-NP-Za-km-z]{11})?$/u;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

/** The segwit prefixes of the C57 chains. */
const SEGWIT: readonly (readonly [string, string])[] = [
  ['bc1', BITCOIN],
  ['tb1', BITCOIN_TESTNET],
  ['ltc1', LITECOIN],
];

/** The base58check version bytes of the C57 bitcoin-family chains (P2PKH and P2SH). */
const BITCOIN_VERSIONS: ReadonlyMap<number, string> = new Map([
  [0x00, BITCOIN],
  [0x05, BITCOIN],
  [0x6f, BITCOIN_TESTNET],
  [0xc4, BITCOIN_TESTNET],
  [0x30, LITECOIN],
  [0x32, LITECOIN],
  [0x1e, DOGECOIN],
  [0x16, DOGECOIN],
]);
/** Version bytes of the formats kept raw: Dash (`X`, `7`) and Bitcoin Gold (`G`, `A`). */
const RAW_VERSIONS: ReadonlySet<number> = new Set([0x4c, 0x10, 0x26, 0x17]);

/** The address inside a payment URI: scheme, `pay-` prefix, chain, function and query removed. */
export function stripCryptoUri(value: string): string {
  const text = value.trim();
  const scheme = SCHEME.exec(text);
  if (scheme === null) {
    return text;
  }
  let rest = text.slice(scheme[0].length);
  if (rest.toLowerCase().startsWith('pay-')) {
    rest = rest.slice(4);
  }
  const end = rest.search(/[/?@]/u);
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

/** A base58 string's bytes (leading `1`s as zero bytes), or `null` outside the alphabet. */
function decodeBase58(text: string): Uint8Array | null {
  let number = 0n;
  for (const character of text) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit === -1) {
      return null;
    }
    number = number * 58n + BigInt(digit);
  }
  let hex = number === 0n ? '' : number.toString(16);
  hex = hex.length % 2 === 0 ? hex : `0${hex}`;
  const zeros = text.length - text.replace(/^1+/u, '').length;
  return Uint8Array.from([...new Array<number>(zeros).fill(0), ...Buffer.from(hex, 'hex')]);
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest();

/** Whether the last four bytes are the first four of the payload's double SHA-256. */
function base58checkHolds(bytes: Uint8Array): boolean {
  const payload = bytes.subarray(0, -4);
  return sha256(sha256(payload)).subarray(0, 4).equals(bytes.subarray(-4));
}

/** The CashAddr BCH-code checksum (the specification's polymod) over prefix and payload. */
function cashAddrChecksumHolds(payload: string): boolean {
  const generators = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n];
  const values = [
    ...Array.from('bitcoincash', (character) => (character.codePointAt(0) ?? 0) & 0x1f),
    0,
    ...Array.from(payload, (character) => BECH32_CHARSET.indexOf(character)),
  ];
  let checksum = 1n;
  for (const value of values) {
    const top = checksum >> 35n;
    checksum = ((checksum & 0x07ffffffffn) << 5n) ^ BigInt(value);
    generators.forEach((generator, bit) => {
      if (((top >> BigInt(bit)) & 1n) === 1n) {
        checksum ^= generator;
      }
    });
  }
  return (checksum ^ 1n) === 0n;
}

type Classified = Omit<CanonicalCryptoAddress, 'raw' | 'ticker'>;

const verdict = (chain: string, address: string): 'valid' | 'invalid' =>
  validateCryptoAddress(chain, address).valid ? 'valid' : 'invalid';

function classifyBase58(raw: string): Classified | null {
  const bytes = raw.length <= 64 ? decodeBase58(raw) : null;
  if (bytes === null) {
    return null;
  }
  const version = bytes[0] ?? -1;
  if (bytes.length === 25 && raw.startsWith('T') && version === 0x41) {
    return { canonical: raw, format: 'base58', chain: TRON, checksum: verdict(TRON, raw) };
  }
  const chain = BITCOIN_VERSIONS.get(version);
  if (bytes.length === 25 && chain !== undefined) {
    return { canonical: raw, format: 'bitcoin', chain, checksum: verdict(chain, raw) };
  }
  const zcash = bytes.length === 26 && version === 0x1c && (bytes[1] === 0xb8 || bytes[1] === 0xbd);
  if ((bytes.length === 25 && RAW_VERSIONS.has(version)) || zcash) {
    return {
      canonical: raw,
      format: 'raw',
      chain: 'unknown',
      checksum: base58checkHolds(bytes) ? 'valid' : 'invalid',
    };
  }
  if (bytes.length === 32 && raw.length >= 32 && raw.length <= 44) {
    return { canonical: raw, format: 'base58', chain: SOLANA, checksum: 'none' };
  }
  return null;
}

function classify(raw: string, chainId: string | null): Classified {
  if (EVM.test(raw)) {
    const checksum = eip55Checksum(raw);
    const evmChain = chainId !== null && cryptoChainFamily(chainId) === 'evm' ? chainId : null;
    return { canonical: raw.toLowerCase(), format: 'evm', chain: evmChain ?? 'unknown', checksum };
  }
  const lower = raw.toLowerCase();
  const oneCase = raw === lower || raw === raw.toUpperCase();
  const cash = CASHADDR.exec(raw)?.[1]?.toLowerCase();
  if (cash !== undefined && oneCase) {
    const holds = cashAddrChecksumHolds(cash);
    if (holds || lower.startsWith('bitcoincash:')) {
      return {
        canonical: cash,
        format: 'cashaddr',
        chain: 'unknown',
        checksum: holds ? 'valid' : 'invalid',
      };
    }
  }
  for (const [prefix, chain] of SEGWIT) {
    const data = lower.slice(prefix.length);
    if (lower.startsWith(prefix) && oneCase && raw.length <= 90 && BECH32_DATA.test(data)) {
      return { canonical: lower, format: 'bitcoin', chain, checksum: verdict(chain, raw) };
    }
  }
  if (BNB_BEACON.test(raw) || MONERO.test(raw)) {
    return { canonical: raw, format: 'raw', chain: 'unknown', checksum: 'none' };
  }
  if (raw.startsWith('r')) {
    const xrpl = validateCryptoAddress(XRPL, raw);
    if (xrpl.valid || xrpl.reason === 'address_checksum_invalid') {
      return {
        canonical: raw,
        format: 'base58',
        chain: XRPL,
        checksum: xrpl.valid ? 'valid' : 'invalid',
      };
    }
  }
  return (
    classifyBase58(raw) ?? {
      canonical: raw,
      format: 'unclassified',
      chain: 'unknown',
      checksum: 'none',
    }
  );
}

/**
 * Canonicalises one address (C79.3); `null` when nothing is left. `chainId` (a C57.1 id, the
 * query's `chain-id`) only names the chain of an EVM address; `ticker` is metadata.
 */
export function canonicaliseCryptoAddress(
  value: string,
  options: { readonly chainId?: string | null; readonly ticker?: string | null } = {},
): CanonicalCryptoAddress | null {
  const raw = capText(stripCryptoUri(value), CRYPTO_ADDRESS_MAX_LENGTH);
  if (raw === '') {
    return null;
  }
  const ticker = options.ticker?.trim().toUpperCase() ?? '';
  return {
    raw,
    ...classify(raw, options.chainId ?? null),
    ticker: ticker === '' ? null : ticker,
  };
}

/**
 * The `watchlist_crypto_addresses` rows of a record (C73.3): every address canonicalised with its
 * ticker, raw kept, none dropped for a failed checksum; an address listed twice under one ticker
 * kept once.
 */
export function recordCryptoRows(
  record: Pick<WatchlistRecord, 'crypto_addresses'>,
): CanonicalCryptoAddress[] {
  const rows = new Map<string, CanonicalCryptoAddress>();
  for (const { raw, ticker } of record.crypto_addresses) {
    const row = canonicaliseCryptoAddress(raw, { ticker });
    const key = row === null ? null : JSON.stringify([row.canonical, row.ticker]);
    if (row !== null && key !== null && !rows.has(key)) {
      rows.set(key, row);
    }
  }
  return [...rows.values()];
}

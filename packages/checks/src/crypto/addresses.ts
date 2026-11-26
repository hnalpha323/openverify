/**
 * Address validity per chain (C57.1), the rule of `crypto_wallet_validity_detection` and of the
 * challenge route (C57.2), which calls it before it issues a challenge:
 * - EVM (`eip155:<n>`): `0x` and 40 hex digits; a mixed-case address must carry its EIP-55
 *   checksum, an all-lower or all-upper one is valid with `checksum: absent`;
 * - Bitcoin and its testnet: base58check P2PKH and P2SH with the network's version byte; segwit
 *   with the network's HRP, bech32 for version 0 (a 20- or 32-byte program) and bech32m for
 *   versions 1 to 16 (BIP-173, BIP-350), at most 90 characters, mixed case refused;
 * - Litecoin: `L` P2PKH, `M` and legacy `3` P2SH, `ltc` segwit; Dogecoin: `D` P2PKH, `9`/`A` P2SH;
 * - Solana: base58 of exactly 32 bytes, with no checksum; `on-curve` says whether an ed25519 key
 *   can sign for it (an off-curve address is a program-derived account, which no key controls);
 * - TRON: base58check of `0x41` and 20 bytes; XRP Ledger: the Ripple alphabet, version `0x00`.
 *
 * A wrong checksum answers `address_checksum_invalid` (a typo); anything else that is not an
 * address of the chain answers `address_invalid`. Input is capped at
 * `CRYPTO_INPUT_LIMITS.addressMaxLength` before any decoding.
 */
import { CRYPTO_INPUT_LIMITS, cryptoChainFamily, type CryptoChainFamily } from '@openverify/core';
import { base58, base58xrp, bech32, bech32m, type BytesCoder } from '@scure/base';
import { equalBytes, sha256d } from './bytes.js';
import { eip55Checksum } from './eip55.js';
import { isOnEd25519Curve } from './solana.js';

/** The script or account kind an address encodes. */
export type CryptoAddressKind =
  | 'evm'
  | 'p2pkh'
  | 'p2sh'
  | 'p2wpkh'
  | 'p2wsh'
  | 'p2tr'
  | 'witness_unknown'
  | 'solana'
  | 'tron'
  | 'xrpl';

/** `valid` or `absent` (EVM case), or `none` for a format without a checksum (Solana). */
export type CryptoAddressChecksum = 'valid' | 'absent' | 'none';

/** A decoded, valid address of one chain. */
export interface CryptoAddress {
  chainId: string;
  family: CryptoChainFamily;
  kind: CryptoAddressKind;
  /**
   * The comparison form (C57.2): EVM lower-cased, bech32 lower-cased, base58 exactly as entered.
   */
  canonical: string;
  checksum: CryptoAddressChecksum;
  /**
   * What the address commits to: the 20-byte account (EVM, TRON, XRP), the HASH160 (P2PKH, P2SH),
   * the witness program (segwit) or the 32-byte public key (Solana).
   */
  payload: Uint8Array;
  /** The segwit version, for segwit addresses. */
  witnessVersion?: number;
  /** Solana only: the 32 bytes decode to an ed25519 point. */
  onCurve?: boolean;
}

export type CryptoAddressValidation =
  | { valid: true; address: CryptoAddress }
  | { valid: false; reason: 'address_invalid' | 'address_checksum_invalid' };

export interface CryptoAddressOptions {
  /** `require-evm-checksum` (C51.3): an EVM address without its EIP-55 checksum is refused. */
  requireEvmChecksum?: boolean | undefined;
}

/** Validates `address` for the chain `chainId` (a canonical CAIP-2 id). */
export function validateCryptoAddress(
  chainId: string,
  address: string,
  options: CryptoAddressOptions = {},
): CryptoAddressValidation {
  const family = cryptoChainFamily(chainId);
  if (
    family === null ||
    address.length === 0 ||
    address.length > CRYPTO_INPUT_LIMITS.addressMaxLength
  ) {
    return INVALID;
  }
  switch (family) {
    case 'evm':
      return evmAddress(chainId, address, options);
    case 'bitcoin':
    case 'litecoin':
    case 'dogecoin':
      return bitcoinAddress(chainId, family, address);
    case 'solana':
      return solanaAddress(chainId, address);
    case 'tron':
      return address.startsWith('T')
        ? base58checkAccount(chainId, family, address, base58, 0x41, 'tron', [34, 34])
        : INVALID;
    case 'xrpl':
      // A classic address's version byte 0x00 always encodes as a leading `r`.
      return address.startsWith('r')
        ? base58checkAccount(chainId, family, address, base58xrp, 0x00, 'xrpl', [25, 35])
        : INVALID;
  }
}

/**
 * Whether two addresses of a chain are the same after canonicalisation (C57.2: EVM
 * case-insensitive, bech32 lower-cased, base58 exact); `false` when either is not valid.
 */
export function cryptoAddressesEqual(chainId: string, a: string, b: string): boolean {
  const left = validateCryptoAddress(chainId, a);
  const right = validateCryptoAddress(chainId, b);
  return left.valid && right.valid && left.address.canonical === right.address.canonical;
}

const INVALID: CryptoAddressValidation = Object.freeze({ valid: false, reason: 'address_invalid' });
const CHECKSUM_INVALID: CryptoAddressValidation = Object.freeze({
  valid: false,
  reason: 'address_checksum_invalid',
});

const EVM_ADDRESS = /^0x[\dA-Fa-f]{40}$/u;

function evmAddress(
  chainId: string,
  address: string,
  options: CryptoAddressOptions,
): CryptoAddressValidation {
  if (!EVM_ADDRESS.test(address)) {
    return INVALID;
  }
  const checksum = eip55Checksum(address);
  if (checksum === 'invalid' || (checksum === 'absent' && options.requireEvmChecksum === true)) {
    return CHECKSUM_INVALID;
  }
  const canonical = address.toLowerCase();
  const payload = new Uint8Array(20);
  for (let index = 0; index < 20; index += 1) {
    payload[index] = Number.parseInt(canonical.slice(2 + index * 2, 4 + index * 2), 16);
  }
  return valid({ chainId, family: 'evm', kind: 'evm', canonical, checksum, payload });
}

interface BitcoinFamilyNetwork {
  p2pkh: readonly number[];
  p2sh: readonly number[];
  hrp: string | null;
}

/** The version bytes and HRP of each bitcoin-family chain (chainparams of each project). */
const BITCOIN_NETWORKS: Readonly<Record<string, BitcoinFamilyNetwork>> = Object.freeze({
  'bip122:000000000019d6689c085ae165831e93': { p2pkh: [0x00], p2sh: [0x05], hrp: 'bc' },
  'bip122:000000000933ea01ad0ee984209779ba': { p2pkh: [0x6f], p2sh: [0xc4], hrp: 'tb' },
  'bip122:12a765e31ffd4059bada1e25190f6e98': { p2pkh: [0x30], p2sh: [0x32, 0x05], hrp: 'ltc' },
  'bip122:1a91e3dace36e2be3bf030a65679fe82': { p2pkh: [0x1e], p2sh: [0x16], hrp: null },
});

/** BIP-173: at most 90 characters. */
const BECH32_MAX_LENGTH = 90;
/** The bech32 alphabet (BIP-173), in value order. */
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
/** A data part: at least the six checksum characters, all of the alphabet. */
const isBech32Data = (data: string): boolean =>
  data.length >= 6 && Array.from(data).every((character) => BECH32_CHARSET.includes(character));

function bitcoinAddress(
  chainId: string,
  family: 'bitcoin' | 'litecoin' | 'dogecoin',
  address: string,
): CryptoAddressValidation {
  const network = BITCOIN_NETWORKS[chainId];
  if (network === undefined) {
    return INVALID;
  }
  if (network.hrp !== null && address.toLowerCase().startsWith(`${network.hrp}1`)) {
    return segwitAddress(chainId, family, address, network.hrp);
  }
  const decoded = base58checkPayload(address, base58, [25, 36]);
  if (decoded === 'invalid' || decoded === 'checksum') {
    return decoded === 'invalid' ? INVALID : CHECKSUM_INVALID;
  }
  const version = decoded[0] ?? -1;
  const kind = network.p2pkh.includes(version)
    ? 'p2pkh'
    : network.p2sh.includes(version)
      ? 'p2sh'
      : null;
  return kind === null
    ? INVALID
    : valid({
        chainId,
        family,
        kind,
        canonical: address,
        checksum: 'valid',
        payload: decoded.slice(1),
      });
}

function segwitAddress(
  chainId: string,
  family: 'bitcoin' | 'litecoin' | 'dogecoin',
  address: string,
  hrp: string,
): CryptoAddressValidation {
  const lower = address.toLowerCase();
  if (
    address.length > BECH32_MAX_LENGTH ||
    (address !== lower && address !== address.toUpperCase()) ||
    lower.lastIndexOf('1') !== hrp.length ||
    !isBech32Data(lower.slice(hrp.length + 1))
  ) {
    return INVALID;
  }
  const asBech32 = bech32.decodeUnsafe(lower, BECH32_MAX_LENGTH);
  const asBech32m = bech32m.decodeUnsafe(lower, BECH32_MAX_LENGTH);
  const decoded = asBech32 ?? asBech32m;
  if (decoded === undefined) {
    return CHECKSUM_INVALID;
  }
  const [version, ...programWords] = decoded.words;
  const program = bech32.fromWordsUnsafe(programWords);
  if (
    version === undefined ||
    version > 16 ||
    program === undefined ||
    program.length < 2 ||
    program.length > 40 ||
    (version === 0 && program.length !== 20 && program.length !== 32)
  ) {
    return INVALID;
  }
  // BIP-350: version 0 uses bech32 and every later version bech32m; the other is a bad checksum.
  if ((version === 0) !== (asBech32 !== undefined)) {
    return CHECKSUM_INVALID;
  }
  return valid({
    chainId,
    family,
    kind: segwitKind(version, program.length),
    canonical: lower,
    checksum: 'valid',
    payload: program,
    witnessVersion: version,
  });
}

function segwitKind(version: number, length: number): CryptoAddressKind {
  if (version === 0) {
    return length === 20 ? 'p2wpkh' : 'p2wsh';
  }
  return version === 1 && length === 32 ? 'p2tr' : 'witness_unknown';
}

function solanaAddress(chainId: string, address: string): CryptoAddressValidation {
  if (address.length < 32 || address.length > 44) {
    return INVALID;
  }
  let bytes: Uint8Array;
  try {
    bytes = base58.decode(address);
  } catch {
    return INVALID;
  }
  if (bytes.length !== 32) {
    return INVALID;
  }
  return valid({
    chainId,
    family: 'solana',
    kind: 'solana',
    canonical: address,
    checksum: 'none',
    payload: bytes,
    onCurve: isOnEd25519Curve(bytes),
  });
}

function base58checkAccount(
  chainId: string,
  family: 'tron' | 'xrpl',
  address: string,
  coder: BytesCoder,
  version: number,
  kind: 'tron' | 'xrpl',
  lengths: readonly [number, number],
): CryptoAddressValidation {
  const decoded = base58checkPayload(address, coder, lengths);
  if (decoded === 'invalid' || decoded === 'checksum') {
    return decoded === 'invalid' ? INVALID : CHECKSUM_INVALID;
  }
  return decoded[0] === version
    ? valid({
        chainId,
        family,
        kind,
        canonical: address,
        checksum: 'valid',
        payload: decoded.slice(1),
      })
    : INVALID;
}

/**
 * The 21 bytes (version and 20) of a base58check value whose text length lies in `lengths`, or why
 * not: `invalid` (alphabet, length) or `checksum` (the first four bytes of the double SHA-256).
 */
function base58checkPayload(
  address: string,
  coder: BytesCoder,
  lengths: readonly [number, number],
): Uint8Array | 'invalid' | 'checksum' {
  if (address.length < lengths[0] || address.length > lengths[1]) {
    return 'invalid';
  }
  let bytes: Uint8Array;
  try {
    bytes = coder.decode(address);
  } catch {
    return 'invalid';
  }
  if (bytes.length !== 25) {
    return 'invalid';
  }
  const payload = bytes.slice(0, 21);
  return equalBytes(sha256d(payload).slice(0, 4), bytes.slice(21)) ? payload : 'checksum';
}

function valid(address: CryptoAddress): CryptoAddressValidation {
  return { valid: true, address };
}

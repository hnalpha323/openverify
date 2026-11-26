/**
 * BIP-137 message signatures (Bitcoin, Litecoin, Dogecoin), and BIP-322's legacy format, which is
 * BIP-137 restricted to P2PKH. The digest is the double SHA-256 of the chain's magic
 * (`\x18Bitcoin Signed Message:\n`, `\x19Litecoin …`, `\x19Dogecoin …`) and the message, each
 * with its CompactSize length. The base64 signature is a header byte, `r` and `s`; the header is
 * 27 plus the recovery id, plus 4 for a compressed P2PKH key, 8 for P2SH-P2WPKH and 12 for
 * P2WPKH.
 *
 * `strict` requires the header's type to be the address's. `loose` (C51.3 default) accepts any
 * header and derives the claimed address's own type from the recovered key, flagged
 * `bip137-loose`, as wallets such as Electrum sign segwit addresses with P2PKH headers. A P2SH
 * address that is not the key's P2SH-P2WPKH may hold another script, so it is inconclusive, never
 * a mismatch; P2WSH and Taproot cannot be proven this way at all.
 */
import type { CryptoAddress } from './addresses.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import {
  compactSize,
  concatBytes,
  decodeBase64,
  equalBytes,
  hash160,
  sha256d,
  utf8,
} from './bytes.js';
import { recoverSecp256k1Key } from './eip191.js';

/** The digest a BIP-137 signature of the chain family signs. */
export function bitcoinMessageDigest(
  family: 'bitcoin' | 'litecoin' | 'dogecoin',
  message: Uint8Array,
): Uint8Array {
  const magic = utf8(MAGIC[family]);
  return sha256d(
    concatBytes(compactSize(magic.length), magic, compactSize(message.length), message),
  );
}

export type Bip137Mode = 'strict' | 'loose';

export type Bip137Verification =
  | { outcome: 'verified'; highS: boolean; loose: boolean }
  | { outcome: 'address_mismatch'; highS: boolean }
  | { outcome: 'invalid' }
  | { outcome: 'inconclusive' };

/**
 * Verifies a base64 BIP-137 signature of `message` for a decoded address of the bitcoin family.
 * `legacyOnly` is BIP-322's legacy format: P2PKH addresses and headers only.
 */
export function verifyBip137(
  address: CryptoAddress,
  message: Uint8Array,
  signature: string,
  options: { mode: Bip137Mode; legacyOnly?: boolean },
): Bip137Verification {
  const bytes = decodeBase64(signature, 65);
  const header = bytes?.[0] ?? 0;
  if (bytes?.length !== 65 || header < 27 || header > 42 || address.family === 'evm') {
    return INVALID;
  }
  const headerType = HEADER_TYPES[Math.floor((header - 27) / 4)] ?? 'p2pkh';
  const strict = options.mode === 'strict' || options.legacyOnly === true;
  const addressType = ADDRESS_HEADER_TYPES[address.kind];
  if (
    options.legacyOnly === true &&
    (address.kind !== 'p2pkh' || !headerType.startsWith('p2pkh'))
  ) {
    return INVALID;
  }
  if (addressType === undefined) {
    // P2WSH, Taproot and future versions: a key signature cannot prove a script.
    return INCONCLUSIVE;
  }
  if (strict && !addressType.includes(headerType)) {
    return INVALID;
  }
  const family =
    address.family === 'litecoin' || address.family === 'dogecoin' ? address.family : 'bitcoin';
  const recovered = recoverSecp256k1Key(
    bitcoinMessageDigest(family, message),
    concatBytes(bytes.slice(1), Uint8Array.of((header - 27) % 4)),
  );
  if (recovered === null) {
    return INVALID;
  }
  const loose = !addressType.includes(headerType);
  const { highS } = recovered;
  if (equalBytes(committedHash(address.kind, headerType, recovered.publicKey), address.payload)) {
    return { outcome: 'verified', highS, loose };
  }
  // A P2SH address may hold any script: a key that is not its P2SH-P2WPKH proves nothing either way.
  return address.kind === 'p2sh' ? INCONCLUSIVE : { outcome: 'address_mismatch', highS };
}

const MAGIC = Object.freeze({
  bitcoin: 'Bitcoin Signed Message:\n',
  litecoin: 'Litecoin Signed Message:\n',
  dogecoin: 'Dogecoin Signed Message:\n',
});

type HeaderType = 'p2pkh-uncompressed' | 'p2pkh' | 'p2sh-p2wpkh' | 'p2wpkh';

/** The header ranges 27-30, 31-34, 35-38 and 39-42, in order. */
const HEADER_TYPES: readonly HeaderType[] = [
  'p2pkh-uncompressed',
  'p2pkh',
  'p2sh-p2wpkh',
  'p2wpkh',
];

/** The header types that name each provable address kind in strict mode. */
const ADDRESS_HEADER_TYPES: Readonly<
  Partial<Record<CryptoAddress['kind'], readonly HeaderType[]>>
> = Object.freeze({
  p2pkh: ['p2pkh-uncompressed', 'p2pkh'],
  p2sh: ['p2sh-p2wpkh'],
  p2wpkh: ['p2wpkh'],
});

const INVALID: Bip137Verification = Object.freeze({ outcome: 'invalid' });
const INCONCLUSIVE: Bip137Verification = Object.freeze({ outcome: 'inconclusive' });

/**
 * The hash the address commits to for the recovered key: HASH160 of the key as the header
 * serialises it (P2PKH), of the compressed key (P2WPKH), or of its P2WPKH script (P2SH-P2WPKH).
 */
function committedHash(
  kind: CryptoAddress['kind'],
  headerType: HeaderType,
  compressedKey: Uint8Array,
): Uint8Array {
  if (kind === 'p2pkh') {
    return hash160(
      headerType === 'p2pkh-uncompressed' ? uncompressed(compressedKey) : compressedKey,
    );
  }
  const witnessProgram = hash160(compressedKey);
  return kind === 'p2wpkh'
    ? witnessProgram
    : hash160(concatBytes(Uint8Array.of(0x00, 0x14), witnessProgram));
}

function uncompressed(compressedKey: Uint8Array): Uint8Array {
  return secp256k1.Point.fromBytes(compressedKey).toBytes(false);
}

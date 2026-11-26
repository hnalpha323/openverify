/**
 * BIP-322 generic signed messages, the `simple` format (C57.1): a witness stack, base64-encoded and
 * prefixed `smp` (or unprefixed, which verifiers may read as simple), spending the virtual
 * `to_spend` transaction whose input commits to the tagged hash of the message and whose output is
 * the address's script. Implemented: P2WPKH (BIP-143 sighash, low-s strict-DER ECDSA,
 * `SIGHASH_ALL`) and the P2TR key path (BIP-341 sighash, BIP-340 Schnorr, `SIGHASH_DEFAULT` or
 * `SIGHASH_ALL`). Every other script, the `full` (`ful`) and proof-of-funds (`pof`) formats and
 * script-path spends are inconclusive: they need a script interpreter or the UTXO set, so they
 * never pass.
 */
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hex } from '@scure/base';
import { SigHash, Transaction } from '@scure/btc-signer';
import { CRYPTO_INPUT_LIMITS } from '@openverify/core';
import type { CryptoAddress } from './addresses.js';
import { concatBytes, decodeBase64, equalBytes, hash160, utf8 } from './bytes.js';

/** `sha256_tag("BIP0322-signed-message", message)`. */
export function bip322MessageHash(message: Uint8Array): Uint8Array {
  const tag = sha256(utf8('BIP0322-signed-message'));
  return sha256(concatBytes(tag, tag, message));
}

/** The txids (display order, hex) of `to_spend` and `to_sign` for a message and output script. */
export function bip322TransactionIds(
  message: Uint8Array,
  outputScript: Uint8Array,
): { toSpend: string; toSign: string } {
  const toSpend = toSpendTransaction(message, outputScript);
  return { toSpend: toSpend.id, toSign: toSignTransaction(toSpend.id, outputScript).id };
}

/** The output script (scriptPubKey) of a decoded bitcoin-family address. */
export function outputScriptOf(address: CryptoAddress): Uint8Array {
  const { payload } = address;
  switch (address.kind) {
    case 'p2pkh':
      return concatBytes(Uint8Array.of(0x76, 0xa9, 0x14), payload, Uint8Array.of(0x88, 0xac));
    case 'p2sh':
      return concatBytes(Uint8Array.of(0xa9, 0x14), payload, Uint8Array.of(0x87));
    default: {
      const version = address.witnessVersion ?? 0;
      return concatBytes(
        Uint8Array.of(version === 0 ? 0x00 : 0x50 + version, payload.length),
        payload,
      );
    }
  }
}

export type Bip322Verification =
  | { outcome: 'verified' }
  | { outcome: 'address_mismatch' }
  | { outcome: 'invalid' }
  | { outcome: 'inconclusive' };

/** Verifies a BIP-322 simple signature (`smp`-prefixed or bare base64) of `message`. */
export function verifyBip322Simple(
  address: CryptoAddress,
  message: Uint8Array,
  signature: string,
): Bip322Verification {
  if (signature.startsWith('ful') || signature.startsWith('pof')) {
    // The full and proof-of-funds formats need a script interpreter and the UTXO set.
    return INCONCLUSIVE;
  }
  if (signature.length > CRYPTO_INPUT_LIMITS.signatureMaxLength) {
    return INVALID;
  }
  const encoded = signature.startsWith('smp') ? signature.slice(3) : signature;
  const witness = decodeWitness(decodeBase64(encoded, CRYPTO_INPUT_LIMITS.signatureMaxLength));
  if (witness === null || witness.length === 0) {
    return INVALID;
  }
  const script = outputScriptOf(address);
  switch (address.kind) {
    case 'p2wpkh':
      return verifyP2wpkh(address.payload, script, message, witness);
    case 'p2tr':
      return verifyP2trKeyPath(address.payload, script, message, witness);
    default:
      // P2PKH and P2SH need the legacy or full formats; P2WSH a script interpreter; later versions
      // are upgradable rules: inconclusive, never verified.
      return INCONCLUSIVE;
  }
}

const INVALID: Bip322Verification = Object.freeze({ outcome: 'invalid' });
const INCONCLUSIVE: Bip322Verification = Object.freeze({ outcome: 'inconclusive' });
const VERIFIED: Bip322Verification = Object.freeze({ outcome: 'verified' });
const TRANSACTION_OPTIONS = Object.freeze({
  version: 0,
  allowUnknownOutputs: true,
  allowUnknownInputs: true,
  disableScriptCheck: true,
});
/** `OP_RETURN`, the only output of `to_sign`. */
const OP_RETURN = Uint8Array.of(0x6a);

function toSpendTransaction(message: Uint8Array, outputScript: Uint8Array): Transaction {
  const toSpend = new Transaction(TRANSACTION_OPTIONS);
  // Outputs first: `@scure/btc-signer` locks outputs once an input carries a final script.
  toSpend.addOutput({ script: outputScript, amount: 0n });
  toSpend.addInput({
    txid: new Uint8Array(32),
    index: 0xffffffff,
    sequence: 0,
    finalScriptSig: concatBytes(Uint8Array.of(0x00, 0x20), bip322MessageHash(message)),
  });
  return toSpend;
}

function toSignTransaction(toSpendId: string, outputScript: Uint8Array): Transaction {
  const toSign = new Transaction(TRANSACTION_OPTIONS);
  toSign.addInput({
    txid: hex.decode(toSpendId),
    index: 0,
    sequence: 0,
    witnessUtxo: { script: outputScript, amount: 0n },
  });
  toSign.addOutput({ script: OP_RETURN, amount: 0n });
  return toSign;
}

function signingTransaction(message: Uint8Array, script: Uint8Array): Transaction {
  return toSignTransaction(toSpendTransaction(message, script).id, script);
}

/** P2WPKH: `[signature ‖ SIGHASH_ALL, compressed key]`, a strict-DER low-s ECDSA signature. */
function verifyP2wpkh(
  program: Uint8Array,
  script: Uint8Array,
  message: Uint8Array,
  witness: readonly Uint8Array[],
): Bip322Verification {
  const [signature, publicKey, ...rest] = witness;
  if (signature === undefined || publicKey?.length !== 33 || rest.length > 0) {
    return INVALID;
  }
  if (!equalBytes(hash160(publicKey), program)) {
    return { outcome: 'address_mismatch' };
  }
  if (signature.at(-1) !== SigHash.ALL) {
    return INVALID;
  }
  const scriptCode = concatBytes(
    Uint8Array.of(0x76, 0xa9, 0x14),
    program,
    Uint8Array.of(0x88, 0xac),
  );
  try {
    const sighash = signingTransaction(message, script).preimageWitnessV0(
      0,
      scriptCode,
      SigHash.ALL,
      0n,
    );
    const der = signature.slice(0, -1);
    const parsed = secp256k1.Signature.fromBytes(der, 'der');
    if (parsed.hasHighS() || !equalBytes(parsed.toBytes('der'), der)) {
      return INVALID;
    }
    return secp256k1.verify(der, sighash, publicKey, { prehash: false, format: 'der', lowS: true })
      ? VERIFIED
      : INVALID;
  } catch {
    return INVALID;
  }
}

/** P2TR key path: `[schnorr signature]`, 64 bytes (`SIGHASH_DEFAULT`) or 65 ending `SIGHASH_ALL`. */
function verifyP2trKeyPath(
  outputKey: Uint8Array,
  script: Uint8Array,
  message: Uint8Array,
  witness: readonly Uint8Array[],
): Bip322Verification {
  const [signature] = witness;
  if (witness.length > 1) {
    // An annex or a script-path spend: more than a key's proof, never verified here.
    return INCONCLUSIVE;
  }
  if (signature === undefined || (signature.length !== 64 && signature.length !== 65)) {
    return INVALID;
  }
  const hashType = signature.length === 65 ? (signature[64] ?? 0) : SigHash.DEFAULT;
  if (signature.length === 65 && hashType !== SigHash.ALL) {
    return INVALID;
  }
  try {
    const sighash = signingTransaction(message, script).preimageWitnessV1(0, [script], hashType, [
      0n,
    ]);
    return schnorr.verify(signature.slice(0, 64), sighash, outputKey) ? VERIFIED : INVALID;
  } catch {
    return INVALID;
  }
}

/** A consensus-encoded witness stack (CompactSize counts and lengths), consumed exactly. */
function decodeWitness(bytes: Uint8Array | null): Uint8Array[] | null {
  if (bytes === null) {
    return null;
  }
  const reader = { offset: 0 };
  const count = readCompactSize(bytes, reader);
  if (count === null) {
    return null;
  }
  const items: Uint8Array[] = [];
  for (let index = 0; index < count; index += 1) {
    const length = readCompactSize(bytes, reader);
    if (length === null || reader.offset + length > bytes.length) {
      return null;
    }
    items.push(bytes.slice(reader.offset, reader.offset + length));
    reader.offset += length;
  }
  return reader.offset === bytes.length ? items : null;
}

function readCompactSize(bytes: Uint8Array, reader: { offset: number }): number | null {
  const first = bytes[reader.offset];
  if (first === undefined) {
    return null;
  }
  if (first < 0xfd) {
    reader.offset += 1;
    return first;
  }
  if (first === 0xfd && reader.offset + 3 <= bytes.length) {
    const value = (bytes[reader.offset + 1] ?? 0) | ((bytes[reader.offset + 2] ?? 0) << 8);
    reader.offset += 3;
    // A CompactSize must be minimal.
    return value >= 0xfd ? value : null;
  }
  return null;
}

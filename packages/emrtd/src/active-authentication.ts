/**
 * C62.6: Active Authentication over the server's nonce with the DG15 key (Doc 9303-11 §6.1): RSA
 * ISO/IEC 9796-2 scheme 1 with partial message recovery, or plain ECDSA (BSI TR-03111 `r || s`).
 * The response is a transferable proof that a chip holding the DG15 key signed this challenge's
 * nonce; the key is trusted only with integrity established (C62.4), and the SOD's listing of
 * DG15 says whether the chip has an AA key at all (P01).
 */
import { constants, createHash, publicEncrypt, verify } from 'node:crypto';
import { bytesToBigInt, concatBytes, equalBytes, unsignedBytes } from './bytes.js';
import { EmrtdError } from './errors.js';
import { importPublicKey, type PublicKeyImport } from './keys.js';
import { activeAuthenticationHashOf, DIGEST_LENGTHS, parseDg15 } from './parse.js';
import type {
  ActiveAuthenticationInput,
  ActiveAuthenticationReport,
  HashAlgorithm,
} from './types.js';

/** Doc 9303-11 §6.1: the challenge (RND.IFD) is 8 bytes. */
const NONCE_LENGTH = 8;

/** ISO/IEC 9796-2 partial recovery: the header byte of the message representative. */
const PARTIAL_RECOVERY_HEADER = 0x6a;

/** ISO/IEC 10118 hash identifiers of the two-byte trailer `xx CC`; `BC` alone is SHA-1. */
const TRAILER_HASHES: ReadonlyMap<number, HashAlgorithm> = new Map([
  [0x33, 'sha1'],
  [0x38, 'sha224'],
  [0x34, 'sha256'],
  [0x36, 'sha384'],
  [0x35, 'sha512'],
]);

/** The digests a plain-ECDSA response is tried with when DG14 names none. */
const ECDSA_DIGESTS: readonly HashAlgorithm[] = ['sha256', 'sha1', 'sha224', 'sha384', 'sha512'];

const outcome = (
  value: ActiveAuthenticationReport['outcome'],
  scheme: ActiveAuthenticationReport['scheme'] = null,
  hashAlgorithm: HashAlgorithm | null = null,
): ActiveAuthenticationReport => ({ outcome: value, scheme, hashAlgorithm });

const digestOf = (hash: HashAlgorithm, ...parts: Uint8Array[]) =>
  new Uint8Array(
    createHash(hash)
      .update(concatBytes(...parts))
      .digest(),
  );

function rsaResponse(
  key: PublicKeyImport,
  response: Uint8Array,
  nonce: Uint8Array,
): ActiveAuthenticationReport {
  const scheme = 'rsa-iso9796-2';
  const size = Math.ceil(key.bits / 8);
  let modulus: bigint;
  let representative: Uint8Array;
  try {
    // An RSASSA-PSS key (OID 1.2.840.113549.1.1.10) refuses both: no AA key is one.
    const jwk = key.key.export({ format: 'jwk' });
    modulus = bytesToBigInt(new Uint8Array(Buffer.from(String(jwk.n), 'base64url')));
    if (response.length !== size || bytesToBigInt(response) >= modulus) {
      return outcome('malformed', scheme);
    }
    representative = new Uint8Array(
      publicEncrypt({ key: key.key, padding: constants.RSA_NO_PADDING }, response),
    );
  } catch {
    return outcome('malformed', scheme);
  }
  // ISO/IEC 9796-2: when the trailer's last nibble is not 0xC, the representative is n - J*.
  if (((representative.at(-1) ?? 0) & 0x0f) !== 0x0c) {
    representative = unsignedBytes(modulus - bytesToBigInt(representative), size);
  }
  const last = representative.at(-1);
  const trailerHash =
    last === 0xbc
      ? 'sha1'
      : last === 0xcc
        ? TRAILER_HASHES.get(representative.at(-2) ?? 0)
        : undefined;
  if (representative[0] !== PARTIAL_RECOVERY_HEADER || trailerHash === undefined) {
    return outcome('failed', scheme);
  }
  const trailerLength = last === 0xbc ? 1 : 2;
  const digestEnd = size - trailerLength;
  const digestStart = digestEnd - DIGEST_LENGTHS[trailerHash];
  if (digestStart < 1) {
    return outcome('failed', scheme, trailerHash);
  }
  const recovered = representative.subarray(1, digestStart);
  const verified = equalBytes(
    digestOf(trailerHash, recovered, nonce),
    representative.subarray(digestStart, digestEnd),
  );
  return outcome(verified ? 'verified' : 'failed', scheme, trailerHash);
}

function ecdsaResponse(
  key: PublicKeyImport,
  response: Uint8Array,
  nonce: Uint8Array,
  dg14: Uint8Array | null | undefined,
): ActiveAuthenticationReport {
  const scheme = 'ecdsa-plain';
  const hint = dg14 == null ? null : activeAuthenticationHashOf(dg14);
  // The allowlisted curves' orders have their field's bit length (C62.1).
  const half = Math.ceil(key.bits / 8);
  if (response.length !== 2 * half) {
    return outcome('malformed', scheme, hint);
  }
  const verifies = (hash: HashAlgorithm) => {
    try {
      return verify(hash, nonce, { key: key.key, dsaEncoding: 'ieee-p1363' }, response);
    } catch {
      return false;
    }
  };
  for (const hash of hint === null ? ECDSA_DIGESTS : [hint]) {
    if (verifies(hash)) {
      return outcome('verified', scheme, hash);
    }
  }
  return outcome('failed', scheme, hint ?? 'sha256');
}

export function verifyActiveAuthentication(
  input: ActiveAuthenticationInput,
): ActiveAuthenticationReport {
  if (input.nonce.length !== NONCE_LENGTH) {
    throw new RangeError('the Active Authentication challenge is 8 bytes');
  }
  if (input.integrity !== 'established') {
    return outcome('untrusted_key');
  }
  if (!input.dg15Listed) {
    return outcome('not_listed');
  }
  if (input.dg15 === null || input.response === null) {
    return outcome('withheld');
  }
  let key: PublicKeyImport;
  try {
    key = importPublicKey(parseDg15(input.dg15).spki, 'verifyActiveAuthentication');
  } catch (error) {
    if (error instanceof EmrtdError) {
      return outcome('malformed');
    }
    throw error;
  }
  return key.kind === 'rsa'
    ? rsaResponse(key, input.response, input.nonce)
    : ecdsaResponse(key, input.response, input.nonce, input.dg14);
}

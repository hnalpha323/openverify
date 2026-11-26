/**
 * C62.2, C62.7: the signature algorithms an eMRTD PKI uses, verified through `node:crypto`
 * (Doc 9303-12 §4.1.6): ECDSA (X9.62 DER, and BSI TR-03111 plain `r || s`), RSASSA-PKCS1-v1_5
 * (named by digest, or `rsaEncryption` with the digest from elsewhere, as SignerInfos often
 * are) and RSASSA-PSS with RFC 4055 parameters (MGF1 over the message digest, trailer 1: Node
 * cannot use another MGF1 digest, so one is `unsupported`). SHA-1 is accepted only when the
 * caller accepts it (C51.3 `accept-sha1`). A check answers `valid`, `invalid` (it does not
 * verify, or the key cannot make it) or `unsupported` (an algorithm outside this list).
 */
import { constants, verify } from 'node:crypto';
import {
  bigintOf,
  childrenOf,
  decodeAsn1,
  encodedOf,
  isContext,
  isUniversal,
  oidOf,
  type Asn1,
} from './asn1.js';
import { EmrtdError } from './errors.js';
import type { PublicKeyImport } from './keys.js';
import {
  ALGORITHM_OIDS,
  ECDSA_PLAIN_SIGNATURE_OIDS,
  ECDSA_SIGNATURE_OIDS,
  HASH_ALGORITHM_OIDS,
  RSA_PKCS1_SIGNATURE_OIDS,
} from './oids.js';
import type { AlgorithmIdentifierValue, HashAlgorithm } from './types.js';

export interface SignatureAlgorithm {
  /** For metadata: `ecdsa-with-sha256`, `ecdsa-plain-sha256`, `sha256-with-rsa`, ... */
  readonly name: string;
  readonly scheme: 'ecdsa' | 'ecdsa-plain' | 'pkcs1' | 'pss';
  readonly hash: HashAlgorithm;
  /** RSASSA-PSS only. */
  readonly saltLength: number | null;
}

export type SignatureCheck = 'valid' | 'invalid' | 'unsupported';

/** The OIDs of each table, by OID. */
function byOid(table: Readonly<Record<HashAlgorithm, string>>): ReadonlyMap<string, HashAlgorithm> {
  return new Map(Object.entries(table).map(([hash, oid]) => [oid, hash as HashAlgorithm] as const));
}

const HASHES = byOid(HASH_ALGORITHM_OIDS);
const ECDSA = byOid(ECDSA_SIGNATURE_OIDS);
const ECDSA_PLAIN = byOid(ECDSA_PLAIN_SIGNATURE_OIDS);
const RSA_PKCS1 = byOid(RSA_PKCS1_SIGNATURE_OIDS);

/** RFC 4055 §3.1: the defaults of an RSASSA-PSS parameter set. */
const PSS_DEFAULT_SALT = 20;
const SEQUENCE = 16;

/** An AlgorithmIdentifier block: its OID and the original bytes of its parameters. */
export function readAlgorithmIdentifier(block: Asn1, step: string): AlgorithmIdentifierValue {
  const [oid, parameters] = isUniversal(block, SEQUENCE) ? childrenOf(block, step) : [];
  if (oid === undefined) {
    throw new EmrtdError('chip_data_malformed', step);
  }
  return {
    oid: oidOf(oid, step),
    parameters: parameters === undefined ? null : encodedOf(parameters),
  };
}

/** The digest an OID names, or `null`. */
export function hashAlgorithmOf(oid: string): HashAlgorithm | null {
  return HASHES.get(oid) ?? null;
}

const STEP = 'signatureAlgorithm';

/** The digest of an AlgorithmIdentifier block naming one, or `null`. */
function digestOf(block: Asn1): HashAlgorithm | null {
  const [oid] = isUniversal(block, SEQUENCE) ? childrenOf(block, STEP) : [];
  return oid === undefined ? null : hashAlgorithmOf(oidOf(oid, STEP));
}

/** RFC 4055 RSASSA-PSS-params, or `null` for a parameter set Node cannot verify. */
function pssAlgorithm(parameters: Uint8Array | null): SignatureAlgorithm | null {
  let hash: HashAlgorithm | null = 'sha1';
  let mgfHash: HashAlgorithm | null = 'sha1';
  let saltLength = PSS_DEFAULT_SALT;
  let trailer = 1n;
  if (parameters !== null) {
    try {
      const block = decodeAsn1(parameters, STEP);
      for (const field of isUniversal(block, SEQUENCE) ? childrenOf(block, STEP) : []) {
        const [value] = childrenOf(field, STEP);
        if (value === undefined) {
          return null;
        }
        if (isContext(field, 0)) {
          hash = digestOf(value);
        } else if (isContext(field, 1)) {
          const [mgf, mgfParameters] = childrenOf(value, STEP);
          mgfHash =
            mgf !== undefined &&
            oidOf(mgf, STEP) === ALGORITHM_OIDS.mgf1 &&
            mgfParameters !== undefined
              ? digestOf(mgfParameters)
              : null;
        } else if (isContext(field, 2)) {
          saltLength = Number(bigintOf(value, STEP));
        } else if (isContext(field, 3)) {
          trailer = bigintOf(value, STEP);
        }
      }
      if (!isUniversal(block, SEQUENCE)) {
        return null;
      }
    } catch (error) {
      if (error instanceof EmrtdError) {
        return null;
      }
      throw error;
    }
  }
  if (hash === null || mgfHash !== hash || trailer !== 1n || saltLength < 0) {
    return null;
  }
  return { name: `rsassa-pss-${hash}`, scheme: 'pss', hash, saltLength };
}

const named = (
  name: string,
  scheme: SignatureAlgorithm['scheme'],
  hash: HashAlgorithm,
): SignatureAlgorithm => ({ name, scheme, hash, saltLength: null });

/**
 * What an AlgorithmIdentifier names; `digest` supplies the hash of `rsaEncryption` and
 * `id-ecPublicKey` used as signature algorithms. `null` for anything unsupported.
 */
export function describeSignatureAlgorithm(
  algorithm: AlgorithmIdentifierValue,
  digest: HashAlgorithm | null = null,
): SignatureAlgorithm | null {
  const { oid } = algorithm;
  const ecdsa = ECDSA.get(oid);
  if (ecdsa !== undefined) {
    return named(`ecdsa-with-${ecdsa}`, 'ecdsa', ecdsa);
  }
  const plain = ECDSA_PLAIN.get(oid);
  if (plain !== undefined) {
    return named(`ecdsa-plain-${plain}`, 'ecdsa-plain', plain);
  }
  const pkcs1 = RSA_PKCS1.get(oid);
  if (pkcs1 !== undefined) {
    return named(`${pkcs1}-with-rsa`, 'pkcs1', pkcs1);
  }
  if (oid === ALGORITHM_OIDS.rsassaPss) {
    return pssAlgorithm(algorithm.parameters);
  }
  if (digest !== null && oid === ALGORITHM_OIDS.rsaEncryption) {
    return named(`rsa-encryption-${digest}`, 'pkcs1', digest);
  }
  if (digest !== null && oid === ALGORITHM_OIDS.ecPublicKey) {
    return named(`ecdsa-${digest}`, 'ecdsa', digest);
  }
  return null;
}

export interface SignatureInput {
  readonly algorithm: AlgorithmIdentifierValue;
  readonly digest?: HashAlgorithm | null | undefined;
  readonly key: PublicKeyImport;
  readonly data: Uint8Array;
  readonly signature: Uint8Array;
  readonly acceptSha1: boolean;
}

export interface SignatureOutcome {
  readonly check: SignatureCheck;
  /** `null` when the algorithm is unsupported. */
  readonly algorithm: SignatureAlgorithm | null;
}

/**
 * The signature under the key. A key of the other family cannot have made it (`invalid`); a key
 * OpenSSL will not use for this scheme (an RSASSA-PSS-only key asked for PKCS#1 v1.5) leaves it
 * unchecked (`unsupported`): an issuer inconsistency is a review, never proven tampering.
 */
function verifies(algorithm: SignatureAlgorithm, input: SignatureInput): SignatureCheck {
  const { key, data, signature } = input;
  const ecdsa = algorithm.scheme === 'ecdsa' || algorithm.scheme === 'ecdsa-plain';
  if (ecdsa !== (key.kind === 'ec')) {
    return 'invalid';
  }
  let valid: boolean;
  try {
    switch (algorithm.scheme) {
      case 'ecdsa':
        valid = verify(algorithm.hash, data, key.key, signature);
        break;
      case 'ecdsa-plain':
        valid = verify(
          algorithm.hash,
          data,
          { key: key.key, dsaEncoding: 'ieee-p1363' },
          signature,
        );
        break;
      case 'pkcs1':
        valid = verify(
          algorithm.hash,
          data,
          { key: key.key, padding: constants.RSA_PKCS1_PADDING },
          signature,
        );
        break;
      case 'pss':
        valid = verify(
          algorithm.hash,
          data,
          {
            key: key.key,
            padding: constants.RSA_PKCS1_PSS_PADDING,
            saltLength: algorithm.saltLength ?? PSS_DEFAULT_SALT,
          },
          signature,
        );
        break;
    }
  } catch {
    // OpenSSL answers a malformed signature with false; it throws only when the key may not be
    // used this way.
    return 'unsupported';
  }
  return valid ? 'valid' : 'invalid';
}

/** Verifies one signature over `data`. Never throws for a bad signature. */
export function checkSignature(input: SignatureInput): SignatureOutcome {
  const algorithm = describeSignatureAlgorithm(input.algorithm, input.digest ?? null);
  if (algorithm === null) {
    return { check: 'unsupported', algorithm: null };
  }
  if (algorithm.hash === 'sha1' && !input.acceptSha1) {
    return { check: 'unsupported', algorithm };
  }
  return { check: verifies(algorithm, input), algorithm };
}

/**
 * The blind index of identification numbers (C31.8): an HMAC-SHA-256 of
 * `"<issuing-authority-code>|<class group>|<number>"` under the environment's subkey, itself
 * `HMAC-SHA-256(OPENVERIFY_BLIND_INDEX_KEY, "openverify/blind-index/v1|<environment id>")`, so the
 * repeat checks (C34) can find the same document number without storing it in the clear.
 *
 * - The number is upper-cased and stripped to `[A-Z0-9]`, so `l898 902-c3` and `L898902C3<<`
 *   index alike; the issuer code is trimmed and upper-cased.
 * - The class group keeps classes apart: each ID class numbers its documents separately, and a
 *   class that could not be established from the document is `unknown`.
 * - The subkey scopes the value itself by environment (Workflow 3B review, G003): the same
 *   number in two environments, or two organizations of one install, gives unrelated indexes,
 *   so the table cannot link people across them without the key. The index is also compared
 *   only within one environment (`environment_id` leads its database index), and redaction
 *   clears it (C31.7).
 *
 * The key is a separate secret from the KEK. Changing it needs
 * `pnpm --filter @openverify/api blind-index:rebuild`, which re-indexes every unredacted row.
 * Errors name the variable and never echo a key.
 */
import { createHmac } from 'node:crypto';
import { normalizeIdentificationNumber } from '@openverify/core';
import type { IdClass } from './tables/enums.js';

export { normalizeIdentificationNumber };

export const BLIND_INDEX_KEY_ENV = 'OPENVERIFY_BLIND_INDEX_KEY';

/** Bytes in a blind index key. */
export const BLIND_INDEX_KEY_BYTES = 32;

/** The blind index key is missing or malformed. The message never contains key material. */
export class BlindIndexKeyError extends Error {
  override name = 'BlindIndexKeyError';
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Decodes a blind index key: base64 of 32 random bytes.
 * @throws {BlindIndexKeyError} naming `OPENVERIFY_BLIND_INDEX_KEY`, without the value.
 */
export function parseBlindIndexKey(value: string | undefined): Uint8Array {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') {
    throw new BlindIndexKeyError(`${BLIND_INDEX_KEY_ENV} is required`);
  }
  const bytes = BASE64.test(trimmed) ? Buffer.from(trimmed, 'base64') : Buffer.alloc(0);
  if (bytes.length !== BLIND_INDEX_KEY_BYTES || bytes.toString('base64') !== trimmed) {
    throw new BlindIndexKeyError(
      `${BLIND_INDEX_KEY_ENV} must be base64 of 32 random bytes (generate one with ` +
        `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))")`,
    );
  }
  return new Uint8Array(bytes);
}

/** The blind index key from `OPENVERIFY_BLIND_INDEX_KEY`. @throws {BlindIndexKeyError} */
export function blindIndexKeyFromEnv(env: NodeJS.ProcessEnv = process.env): Uint8Array {
  return parseBlindIndexKey(env[BLIND_INDEX_KEY_ENV]);
}

/** The class group of the blind index: the ID class, or `unknown` when it was not established. */
export type IdClassGroup = IdClass | 'unknown';

export function idClassGroup(idClass: IdClass | null): IdClassGroup {
  return idClass ?? 'unknown';
}

export interface IdentificationNumberIndexInput {
  /** The environment the index belongs to: its subkey computes the index (G003). */
  environmentId: string;
  /** The raw ICAO issuer code or AAMVA IIN (C31.5 `issuing-authority-code`). */
  issuingAuthorityCode: string;
  classGroup: IdClassGroup;
  identificationNumber: string;
}

/** What an extraction's blind index is computed from. */
export interface ExtractionIndexInput {
  /** The environment of the extraction (G003). */
  environmentId: string;
  fields: {
    'issuing-authority-code': string | null;
    'identification-number': string | null;
  };
  classGroup: IdClassGroup;
}

/** @throws {BlindIndexKeyError} when the key is not 32 bytes. */
export function assertBlindIndexKey(key: Uint8Array): void {
  if (key.byteLength !== BLIND_INDEX_KEY_BYTES) {
    throw new BlindIndexKeyError(`${BLIND_INDEX_KEY_ENV} must be 32 bytes`);
  }
}

/**
 * The blind index of an extraction (C31.8), as the worker writes it and `blind-index:rebuild`
 * recomputes it: `null` without both an issuing-authority code and an identification number,
 * so numbers of unknown issuers never match across issuers.
 * @throws {BlindIndexKeyError} when the key is not 32 bytes.
 */
export function extractionIndexOf(key: Uint8Array, input: ExtractionIndexInput): string | null {
  assertBlindIndexKey(key);
  const issuer = input.fields['issuing-authority-code']?.trim() ?? '';
  const number = input.fields['identification-number'];
  if (issuer === '' || number === null) {
    return null;
  }
  return identificationNumberIndex(key, {
    environmentId: input.environmentId,
    issuingAuthorityCode: issuer,
    classGroup: input.classGroup,
    identificationNumber: number,
  });
}

/** Separates the environment subkeys from any other use of the key (G003). */
const ENVIRONMENT_SUBKEY_LABEL = 'openverify/blind-index/v1|';

/** The environment's subkey: `HMAC-SHA-256(key, "openverify/blind-index/v1|<environment id>")`. */
function environmentSubkey(key: Uint8Array, environmentId: string): Buffer {
  if (environmentId.trim() === '') {
    throw new TypeError('A blind index needs the id of its environment');
  }
  return createHmac('sha256', key)
    .update(`${ENVIRONMENT_SUBKEY_LABEL}${environmentId}`, 'utf8')
    .digest();
}

/**
 * The C31.8 blind index (64 lowercase hex characters) under the environment's subkey, or `null`
 * when the number has no character left to index.
 * @throws {BlindIndexKeyError} when the key is not 32 bytes.
 * @throws {TypeError} without an environment id.
 */
export function identificationNumberIndex(
  key: Uint8Array,
  input: IdentificationNumberIndexInput,
): string | null {
  assertBlindIndexKey(key);
  const number = normalizeIdentificationNumber(input.identificationNumber);
  if (number === '') {
    return null;
  }
  const issuer = input.issuingAuthorityCode.trim().toUpperCase();
  return createHmac('sha256', environmentSubkey(key, input.environmentId))
    .update(`${issuer}|${input.classGroup}|${number}`, 'utf8')
    .digest('hex');
}

// Phase 5, Workflow 5A (C53.2, C53.4) ----------------------------------------------------------

/** The label of the OTP destination index (C53.2). */
export const OTP_DESTINATION_INDEX_LABEL = 'openverify/otp-destination/v1';
/** The label of the crypto-wallet address index (C53.2). */
export const CRYPTO_ADDRESS_INDEX_LABEL = 'openverify/crypto-address/v1';

export interface OtpDestinationIndexInput {
  environmentId: string;
  channel: 'sms' | 'email';
  /** An E.164 number for `sms`; an address for `email`, indexed lower-cased. */
  destination: string;
}

/**
 * C53.2: the blind index of an OTP destination (64 lowercase hex characters) under the
 * environment's subkey, so the per-destination limits and the guess budget key on it without
 * storing the destination in the clear.
 * @throws {BlindIndexKeyError} when the key is not 32 bytes.
 */
export function otpDestinationIndex(key: Uint8Array, input: OtpDestinationIndexInput): string {
  assertBlindIndexKey(key);
  const trimmed = input.destination.trim();
  const destination = input.channel === 'email' ? trimmed.toLowerCase() : trimmed;
  return createHmac('sha256', environmentSubkey(key, input.environmentId))
    .update(`${OTP_DESTINATION_INDEX_LABEL}|${input.channel}|${destination}`, 'utf8')
    .digest('hex');
}

export interface CryptoAddressIndexInput {
  environmentId: string;
  /**
   * The canonical address (`canonicalCryptoAddress`: EVM and bech32 lower-cased, base58 as is),
   * so the challenge route and `blind-index:rebuild` index what the C57.2 comparison reads; the
   * sealed column keeps the address as claimed.
   */
  address: string;
}

/**
 * C53.2: the blind index of a wallet address (64 lowercase hex characters) under the
 * environment's subkey.
 * @throws {BlindIndexKeyError} when the key is not 32 bytes.
 */
export function cryptoAddressIndex(key: Uint8Array, input: CryptoAddressIndexInput): string {
  assertBlindIndexKey(key);
  return createHmac('sha256', environmentSubkey(key, input.environmentId))
    .update(`${CRYPTO_ADDRESS_INDEX_LABEL}|${input.address}`, 'utf8')
    .digest('hex');
}

// Phase 5, Workflow 5B (C53.3, C53.4, C62.6) ---------------------------------------------------

/** The label of a chip read's SOD signature index: the sighting key of `id_nfc_repeat_detection`. */
export const CHIP_SOD_INDEX_LABEL = 'openverify/chip-sod/v1';
/** The label of a chip read's document number index. */
export const CHIP_DOCUMENT_NUMBER_INDEX_LABEL = 'openverify/chip-document-number/v1';

export interface ChipSodIndexInput {
  environmentId: string;
  /** The SOD SignerInfo's signature value, as signed (`@openverify/emrtd` `ParsedSod.signature`). */
  signature: Uint8Array;
}

/**
 * C53.3, C62.6: the blind index of a chip's SOD signature (64 lowercase hex characters) under the
 * environment's subkey. Two reads of the same chip share it; no two chips do.
 * @throws {BlindIndexKeyError} when the key is not 32 bytes.
 */
export function chipSodIndex(key: Uint8Array, input: ChipSodIndexInput): string {
  assertBlindIndexKey(key);
  return createHmac('sha256', environmentSubkey(key, input.environmentId))
    .update(`${CHIP_SOD_INDEX_LABEL}|${Buffer.from(input.signature).toString('hex')}`, 'utf8')
    .digest('hex');
}

export interface ChipDocumentNumberIndexInput {
  environmentId: string;
  /** DG1's issuing state, ICAO alpha-3 (`D` and fillers as written: `D<<`). */
  issuingState: string;
  /** DG1's document number, fillers (`<`) and surrounding spaces removed before indexing. */
  documentNumber: string;
}

/**
 * C53.3: the blind index of a chip's document number with its issuing state, under the
 * environment's subkey.
 * @throws {BlindIndexKeyError} when the key is not 32 bytes.
 */
export function chipDocumentNumberIndex(
  key: Uint8Array,
  input: ChipDocumentNumberIndexInput,
): string {
  assertBlindIndexKey(key);
  const issuingState = input.issuingState.trim().toUpperCase();
  const number = input.documentNumber.replace(/[<\s]/g, '').toUpperCase();
  return createHmac('sha256', environmentSubkey(key, input.environmentId))
    .update(`${CHIP_DOCUMENT_NUMBER_INDEX_LABEL}|${issuingState}|${number}`, 'utf8')
    .digest('hex');
}

// Phase 6 (C73.2, C73.4, C75.3) ----------------------------------------------------------------

/** The label of a crypto-address report's index (C73.2), written by the run. */
export const REPORT_CRYPTO_ADDRESS_INDEX_LABEL = 'openverify/report-crypto-address/v1';
/** The label of a match's entry index: `<source>:<publisher id>` or an article key (P01). */
export const REPORT_MATCH_ENTRY_INDEX_LABEL = 'openverify/report-match-entry/v1';
/** The label of a match's evidence hash (C75.3). */
export const REPORT_MATCH_EVIDENCE_LABEL = 'openverify/report-match-evidence/v1';

export interface ReportCryptoAddressIndexInput {
  environmentId: string;
  /** The canonical address (C79.3), as the run compares it. */
  address: string;
}

/**
 * C73.2: the blind index of a crypto-address report's address under the environment's subkey.
 * @throws {BlindIndexKeyError} when the key is not 32 bytes.
 */
export function reportCryptoAddressIndex(
  key: Uint8Array,
  input: ReportCryptoAddressIndexInput,
): string {
  return reportIndex(key, input.environmentId, REPORT_CRYPTO_ADDRESS_INDEX_LABEL, input.address);
}

export interface ReportMatchEntryIndexInput {
  environmentId: string;
  /** The readable entry key: `<source id>:<publisher id>`, or a media article's key. */
  entryKey: string;
}

/**
 * C73.2 (P01): the HMAC that keys a match to its list entry without naming it.
 * @throws {BlindIndexKeyError} when the key is not 32 bytes.
 */
export function reportMatchEntryIndex(key: Uint8Array, input: ReportMatchEntryIndexInput): string {
  return reportIndex(key, input.environmentId, REPORT_MATCH_ENTRY_INDEX_LABEL, input.entryKey);
}

export interface ReportMatchEvidenceInput {
  environmentId: string;
  /**
   * C75.3: the evidence, in its fixed order: the entry key, the entry's content hash, the matched
   * list name, then the report's screened query fields. Strings, or arrays of strings; they are
   * framed as one JSON array, so no two splits of name and query give one input (P10).
   */
  parts: readonly (string | readonly string[])[];
}

/**
 * C75.3: the evidence hash of a match.
 * @throws {BlindIndexKeyError} when the key is not 32 bytes.
 */
export function reportMatchEvidenceHash(key: Uint8Array, input: ReportMatchEvidenceInput): string {
  return reportIndex(
    key,
    input.environmentId,
    REPORT_MATCH_EVIDENCE_LABEL,
    JSON.stringify(input.parts),
  );
}

/** `HMAC-SHA-256(environment subkey, "<label>|<text>")`, lower-case hex. */
function reportIndex(key: Uint8Array, environmentId: string, label: string, text: string): string {
  assertBlindIndexKey(key);
  return createHmac('sha256', environmentSubkey(key, environmentId))
    .update(`${label}|${text}`, 'utf8')
    .digest('hex');
}

/**
 * C94.4, C98.2 (Workflow 7A): the labels of {@link identifierKey}, one per identifier kind, each
 * separating its HMACs from every other use of the environment subkey. Workflow 7B adds the list
 * kinds under the names of `LIST_KEY_KINDS` (C98.2), the graph keys that are not list keys
 * (`GRAPH_KIND_REGISTRY[kind].key`, C101.2) and the transaction field key (C105.4).
 */
export const IDENTIFIER_KEY_LABELS = Object.freeze({
  'browser-fingerprint': 'openverify/browser-fingerprint/v1',
  'device-class': 'openverify/device-class/v1',
  'android-id': 'openverify/android-id/v1',
  // C127.6: a declared identifier field, found through a reference id that holds no value.
  'account-identifier': 'openverify/account-identifier/v1',
  // Workflow 7B: the list kinds (C98.2).
  'identifier-string': 'openverify/identifier-string/v1',
  'identifier-email': 'openverify/identifier-email/v1',
  'identifier-email-domain': 'openverify/identifier-email-domain/v1',
  'identifier-phone': 'openverify/identifier-phone/v1',
  'identifier-government-id-number': 'openverify/identifier-government-id-number/v1',
  'identifier-name': 'openverify/identifier-name/v1',
  'identifier-name-last': 'openverify/identifier-name-last/v1',
  'identifier-ip': 'openverify/identifier-ip/v1',
  'identifier-ip-range': 'openverify/identifier-ip-range/v1',
  'identifier-country': 'openverify/identifier-country/v1',
  'identifier-geolocation': 'openverify/identifier-geolocation/v1',
  'identifier-browser-fingerprint': 'openverify/identifier-browser-fingerprint/v1',
  'identifier-device-fingerprint': 'openverify/identifier-device-fingerprint/v1',
  'identifier-field': 'openverify/identifier-field/v1',
  // Workflow 7B: the graph keys that are no list kind (C101.2) and transaction fields (C105.4).
  'identifier-reference-id': 'openverify/identifier-reference-id/v1',
  'identifier-name-birthdate': 'openverify/identifier-name-birthdate/v1',
  'identifier-address': 'openverify/identifier-address/v1',
  'identifier-postal-code': 'openverify/identifier-postal-code/v1',
  'identifier-birthdate': 'openverify/identifier-birthdate/v1',
  'identifier-transaction-field': 'openverify/identifier-transaction-field/v1',
  // C136.4 (Workflow 8B; P25): a searchable case field, its input naming the template and field.
  'identifier-case-field': 'openverify/identifier-case-field/v1',
  // C168.6 (Workflow 9B Stage 1b (U); P23): an audit entry's address, for `audit_log_ip_index`
  // (contracts' `AUDIT_IP_INDEX_LABEL`).
  'audit-ip': 'openverify/audit-ip/v1',
} as const);

export type IdentifierKeyKind = keyof typeof IDENTIFIER_KEY_LABELS;

export interface IdentifierKeyInput {
  /** The environment the HMAC belongs to: its subkey computes it (G003). */
  environmentId: string;
  kind: IdentifierKeyKind;
  /**
   * The canonical text of the identifier, as its owner builds it (`api-signals`: the canonical JSON
   * of the stable components, or the `ANDROID_ID`; `list-logic`: `listKeyInputs`). Never logged.
   */
  input: string;
}

/**
 * C94.4: `HMAC-SHA-256(environment subkey, "<label>|<input>")`, 64 lower-case hex, the one keyed
 * identifier function of Phase 7 (devices now, list items and graph keys in Workflow 7B).
 * @throws {BlindIndexKeyError} when the key is not 32 bytes.
 * @throws {TypeError} without an environment id.
 */
export function identifierKey(key: Uint8Array, input: IdentifierKeyInput): string {
  return reportIndex(key, input.environmentId, IDENTIFIER_KEY_LABELS[input.kind], input.input);
}

/** C94.4 (P09): the label of {@link blindIndexKeyId}. */
export const BLIND_INDEX_KEY_ID_LABEL = 'openverify/blind-index-key-id/v1';

/**
 * C94.4 (P09): the id of the blind-index key, `HMAC-SHA-256(key, "openverify/blind-index-key-id/v1")`
 * truncated to 8 bytes in base64url (11 characters), as the KEK's `kid` is derived. Every device
 * HMAC (and, from 7B, every fingerprint list item) records it, so a rotated key is never compared.
 * @throws {BlindIndexKeyError} when the key is not 32 bytes.
 */
export function blindIndexKeyId(key: Uint8Array): string {
  assertBlindIndexKey(key);
  return createHmac('sha256', key)
    .update(BLIND_INDEX_KEY_ID_LABEL, 'utf8')
    .digest()
    .subarray(0, BLIND_INDEX_KEY_ID_BYTES)
    .toString('base64url');
}

/** Bytes of the key id before base64url: 8 bytes give 11 characters. */
const BLIND_INDEX_KEY_ID_BYTES = 8;

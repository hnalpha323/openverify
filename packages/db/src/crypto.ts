/**
 * Envelope encryption for PII at rest.
 *
 * Every value gets its own random 256-bit data-encryption key (DEK). The value is sealed
 * with AES-256-GCM under the DEK, and the DEK is sealed with AES-256-GCM under a
 * key-encryption key (KEK) from the keyring. Both seals use a fresh random 96-bit IV.
 *
 * Envelope (compact, ASCII, safe for `text` columns):
 *
 *     ov1.<kid>.<wrapped DEK>.<payload>
 *
 * - `ov1` is the format version.
 * - `kid` identifies the KEK. It is derived from the KEK with HKDF, so it is stable and
 *   reveals nothing about the key. It is what makes KEK rotation possible.
 * - `wrapped DEK` = IV(12) || AES-GCM(KEK, DEK) || tag(16), base64url without padding.
 *   Its associated data is `ov1.<kid>`, so the version and key id cannot be swapped.
 * - `payload` = IV(12) || AES-GCM(DEK, UTF-8 plaintext) || tag(16), base64url without
 *   padding. Its associated data is the version plus the optional caller `context`
 *   (for example `accounts.email`), so a value cannot be moved to another column.
 *   It deliberately does not include the kid, so `rewrap` can move a value to a new
 *   KEK without touching the payload.
 *
 * File payloads (`encryptBytes`) use the same design, split in two: the wrapped DEK
 * (`ov1.<kid>.<wrapped DEK>`) goes into the database row, and IV(12) || AES-GCM(DEK,
 * bytes) || tag(16) is the object written to storage. Their associated data is
 * `ov1-bytes:<context>`, so a text payload can never be passed off as a file payload or
 * the other way round. Use the file id as the context, so an object cannot be swapped
 * between file records.
 *
 * Limits: random 96-bit IVs are safe for up to 2^32 seals per key (NIST SP 800-38D).
 * Each value uses a new DEK, so that budget applies only to DEK wraps under one KEK.
 * Rotate the KEK long before 2^32 values have been written under it. Ciphertexts are
 * randomised, so encrypted columns cannot be indexed or compared for equality; use a
 * separate keyed blind index for lookups.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { customType } from 'drizzle-orm/pg-core';

/** Environment variable holding the current KEK (standard base64 of 32 bytes). */
export const KEK_ENV = 'OPENVERIFY_KEK';
/** Environment variable holding retired KEKs that may still decrypt (comma-separated). */
export const KEK_PREVIOUS_ENV = 'OPENVERIFY_KEK_PREVIOUS';

const VERSION = 'ov1';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_ID_BYTES = 8;
const WRAPPED_DEK_BYTES = IV_BYTES + KEY_BYTES + TAG_BYTES;
const MIN_PAYLOAD_BYTES = IV_BYTES + TAG_BYTES;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** The keyring configuration is missing or invalid. Messages never contain key material. */
export class KeyringError extends Error {
  override name = 'KeyringError';
}

/** A value could not be decrypted: it is malformed, tampered with, or its KEK is unknown. */
export class DecryptionError extends Error {
  override name = 'DecryptionError';
}

/**
 * The KEKs available to encrypt and decrypt. The key bytes are held privately, so
 * logging or serialising a keyring only shows the key ids.
 */
export interface Keyring {
  /** Id of the KEK that wraps every new value. */
  readonly currentKeyId: string;
  /** Ids of every KEK that can unwrap, current first. */
  readonly keyIds: readonly string[];
}

export interface CryptoOptions {
  /** Associated data bound to the ciphertext, for example `accounts.email`. */
  context?: string;
}

export interface EncryptedColumnOptions extends CryptoOptions {
  /** Keyring to use. Defaults to the process keyring from `OPENVERIFY_KEK(_PREVIOUS)`. */
  keyring?: Keyring;
}

const keyMaterial = new WeakMap<Keyring, ReadonlyMap<string, Buffer>>();

function deriveKeyId(kek: Buffer): string {
  const okm = hkdfSync('sha256', kek, Buffer.alloc(0), 'openverify/kek-id/v1', KEY_ID_BYTES);
  return Buffer.from(okm).toString('base64url');
}

function checkKek(kek: Uint8Array, label: string): Buffer {
  if (kek.length !== KEY_BYTES) {
    throw new KeyringError(
      `${label} must be ${String(KEY_BYTES)} bytes (got ${String(kek.length)})`,
    );
  }
  return Buffer.from(kek);
}

/** Builds a keyring from raw 32-byte KEKs. `previous` keys only decrypt and re-wrap. */
export function createKeyring(current: Uint8Array, previous: readonly Uint8Array[] = []): Keyring {
  const keys = new Map<string, Buffer>();
  const currentKek = checkKek(current, 'current KEK');
  const currentKeyId = deriveKeyId(currentKek);
  keys.set(currentKeyId, currentKek);
  previous.forEach((kek, index) => {
    const checked = checkKek(kek, `previous KEK [${String(index)}]`);
    const id = deriveKeyId(checked);
    if (!keys.has(id)) {
      keys.set(id, checked);
    }
  });
  const keyring: Keyring = Object.freeze({ currentKeyId, keyIds: Object.freeze([...keys.keys()]) });
  keyMaterial.set(keyring, keys);
  return keyring;
}

function decodeKek(value: string, label: string): Buffer {
  if (!BASE64.test(value) || value.length % 4 !== 0) {
    throw new KeyringError(`${label} is not valid base64`);
  }
  const key = Buffer.from(value, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new KeyringError(
      `${label} must decode to ${String(KEY_BYTES)} bytes (got ${String(key.length)})`,
    );
  }
  return key;
}

/** Reads `OPENVERIFY_KEK` and the optional comma-separated `OPENVERIFY_KEK_PREVIOUS`. */
export function keyringFromEnv(env: NodeJS.ProcessEnv = process.env): Keyring {
  const current = env[KEK_ENV]?.trim() ?? '';
  if (current === '') {
    throw new KeyringError(`${KEK_ENV} is not set; expected a base64-encoded 32-byte key`);
  }
  const previous = (env[KEK_PREVIOUS_ENV] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '')
    .map((value, index) => decodeKek(value, `${KEK_PREVIOUS_ENV}[${String(index)}]`));
  return createKeyring(decodeKek(current, KEK_ENV), previous);
}

function kekFor(keyring: Keyring, keyId: string): Buffer {
  const kek = keyMaterial.get(keyring)?.get(keyId);
  if (kek === undefined) {
    throw new DecryptionError(`unknown key id ${keyId}: its KEK is not in the keyring`);
  }
  return kek;
}

function seal(key: Buffer, plaintext: Uint8Array, aad: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]);
}

function open(key: Buffer, sealed: Buffer, aad: Buffer): Buffer {
  const iv = sealed.subarray(0, IV_BYTES);
  const ciphertext = sealed.subarray(IV_BYTES, sealed.length - TAG_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new DecryptionError('authentication failed: wrong key or tampered ciphertext');
  }
}

const wrapAad = (keyId: string): Buffer => Buffer.from(`${VERSION}.${keyId}`, 'utf8');
const payloadAad = (context: string | undefined): Buffer =>
  Buffer.from(`${VERSION}:${context ?? ''}`, 'utf8');
const bytesAad = (context: string | undefined): Buffer =>
  Buffer.from(`${VERSION}-bytes:${context ?? ''}`, 'utf8');

/** Strict base64url: only the URL-safe alphabet, no padding, canonical trailing bits. */
function decodeSegment(segment: string): Buffer {
  if (!BASE64URL.test(segment)) {
    throw new DecryptionError('malformed envelope: invalid base64url');
  }
  const bytes = Buffer.from(segment, 'base64url');
  if (bytes.toString('base64url') !== segment) {
    throw new DecryptionError('malformed envelope: non-canonical base64url');
  }
  return bytes;
}

interface WrappedDek {
  keyId: string;
  wrappedDek: Buffer;
}

interface Envelope extends WrappedDek {
  payload: Buffer;
  payloadSegment: string;
}

function parseWrappedSegments(version: string, keyId: string, wrappedSegment: string): WrappedDek {
  if (version !== VERSION) {
    throw new DecryptionError('unsupported envelope version');
  }
  const keyIdBytes = decodeSegment(keyId);
  const wrappedDek = decodeSegment(wrappedSegment);
  if (keyIdBytes.length !== KEY_ID_BYTES || wrappedDek.length !== WRAPPED_DEK_BYTES) {
    throw new DecryptionError('malformed envelope: unexpected segment length');
  }
  return { keyId, wrappedDek };
}

function parseEnvelope(envelope: string): Envelope {
  const parts = envelope.split('.');
  if (parts.length !== 4) {
    throw new DecryptionError('malformed envelope: expected 4 segments');
  }
  const [version, keyId, wrappedSegment, payloadSegment] = parts as [
    string,
    string,
    string,
    string,
  ];
  const wrapped = parseWrappedSegments(version, keyId, wrappedSegment);
  const payload = decodeSegment(payloadSegment);
  if (payload.length < MIN_PAYLOAD_BYTES) {
    throw new DecryptionError('malformed envelope: unexpected segment length');
  }
  return { ...wrapped, payload, payloadSegment };
}

/** Parses the `ov1.<kid>.<wrapped DEK>` string stored next to a file payload. */
function parseWrappedDek(wrappedDek: string): WrappedDek {
  const parts = wrappedDek.split('.');
  if (parts.length !== 3) {
    throw new DecryptionError('malformed wrapped DEK: expected 3 segments');
  }
  const [version, keyId, wrappedSegment] = parts as [string, string, string];
  return parseWrappedSegments(version, keyId, wrappedSegment);
}

function unwrapDek(envelope: WrappedDek, keyring: Keyring): Buffer {
  const kek = kekFor(keyring, envelope.keyId);
  return open(kek, envelope.wrappedDek, wrapAad(envelope.keyId));
}

function wrapDek(dek: Buffer, keyring: Keyring): string {
  const keyId = keyring.currentKeyId;
  const wrapped = seal(kekFor(keyring, keyId), dek, wrapAad(keyId));
  return `${VERSION}.${keyId}.${wrapped.toString('base64url')}`;
}

/** Encrypts a UTF-8 string under a fresh DEK wrapped by the keyring's current KEK. */
export function encrypt(plaintext: string, keyring: Keyring, options: CryptoOptions = {}): string {
  const dek = randomBytes(KEY_BYTES);
  try {
    const payload = seal(dek, Buffer.from(plaintext, 'utf8'), payloadAad(options.context));
    return `${wrapDek(dek, keyring)}.${payload.toString('base64url')}`;
  } finally {
    dek.fill(0);
  }
}

/** Decrypts an envelope produced by {@link encrypt} with any KEK in the keyring. */
export function decrypt(envelope: string, keyring: Keyring, options: CryptoOptions = {}): string {
  const parsed = parseEnvelope(envelope);
  const dek = unwrapDek(parsed, keyring);
  try {
    return open(dek, parsed.payload, payloadAad(options.context)).toString('utf8');
  } finally {
    dek.fill(0);
  }
}

/** True when the value is wrapped by a KEK other than the keyring's current one. */
export function needsRewrap(envelope: string, keyring: Keyring): boolean {
  return parseEnvelope(envelope).keyId !== keyring.currentKeyId;
}

/**
 * Re-wraps the value's DEK under the current KEK. The payload is left untouched, so a
 * rotation job never handles plaintext. Run it over old rows, then drop the old KEK
 * from `OPENVERIFY_KEK_PREVIOUS`.
 */
export function rewrap(envelope: string, keyring: Keyring): string {
  const parsed = parseEnvelope(envelope);
  const dek = unwrapDek(parsed, keyring);
  try {
    return `${wrapDek(dek, keyring)}.${parsed.payloadSegment}`;
  } finally {
    dek.fill(0);
  }
}

/** A file payload sealed by {@link encryptBytes}. */
export interface EncryptedBytes {
  /** `ov1.<kid>.<wrapped DEK>`: store it in the database row (`files.wrapped_dek`). */
  wrappedDek: string;
  /** IV(12) || AES-GCM(DEK, plaintext) || tag(16): the object written to storage. */
  ciphertext: Uint8Array;
}

/**
 * Encrypts a file payload under a fresh DEK wrapped by the keyring's current KEK. Pass
 * the file id as `context`, so the object only decrypts for that file record.
 */
export function encryptBytes(
  plaintext: Uint8Array,
  keyring: Keyring,
  options: CryptoOptions = {},
): EncryptedBytes {
  const dek = randomBytes(KEY_BYTES);
  try {
    const ciphertext = seal(dek, plaintext, bytesAad(options.context));
    return { wrappedDek: wrapDek(dek, keyring), ciphertext };
  } finally {
    dek.fill(0);
  }
}

/** Decrypts a payload produced by {@link encryptBytes} with any KEK in the keyring. */
export function decryptBytes(
  envelope: EncryptedBytes,
  keyring: Keyring,
  options: CryptoOptions = {},
): Buffer {
  const wrapped = parseWrappedDek(envelope.wrappedDek);
  const { ciphertext } = envelope;
  if (ciphertext.length < MIN_PAYLOAD_BYTES) {
    throw new DecryptionError('malformed envelope: unexpected segment length');
  }
  const dek = unwrapDek(wrapped, keyring);
  try {
    return open(
      dek,
      Buffer.from(ciphertext.buffer, ciphertext.byteOffset, ciphertext.byteLength),
      bytesAad(options.context),
    );
  } finally {
    dek.fill(0);
  }
}

/**
 * Re-wraps a file payload's DEK under the current KEK. The stored object is not read or
 * rewritten; only `files.wrapped_dek` changes.
 */
export function rewrapDek(wrappedDek: string, keyring: Keyring): string {
  const dek = unwrapDek(parseWrappedDek(wrappedDek), keyring);
  try {
    return wrapDek(dek, keyring);
  } finally {
    dek.fill(0);
  }
}

let processKeyring: { source: string; keyring: Keyring } | undefined;

/** Keyring from `process.env`, rebuilt only when the variables change. */
function environmentKeyring(): Keyring {
  const source = `${process.env[KEK_ENV] ?? ''}\n${process.env[KEK_PREVIOUS_ENV] ?? ''}`;
  if (processKeyring?.source !== source) {
    processKeyring = { source, keyring: keyringFromEnv(process.env) };
  }
  return processKeyring.keyring;
}

let defaultKeyringOverride: Keyring | undefined;

/**
 * Sets the keyring that encrypted columns use when they were declared without one, for
 * example a keyring backed by a KMS adapter, or a synthetic test keyring. `undefined`
 * restores the default: the keyring from `OPENVERIFY_KEK(_PREVIOUS)`.
 */
export function setDefaultKeyring(keyring: Keyring | undefined): void {
  defaultKeyringOverride = keyring;
}

/** The keyring encrypted columns use when they were declared without one. */
export function getDefaultKeyring(): Keyring {
  return defaultKeyringOverride ?? environmentKeyring();
}

function columnCrypto(options: EncryptedColumnOptions): {
  keyring: () => Keyring;
  cryptoOptions: CryptoOptions;
} {
  return {
    keyring: () => options.keyring ?? getDefaultKeyring(),
    cryptoOptions: options.context === undefined ? {} : { context: options.context },
  };
}

/**
 * A `text` column whose values are envelope-encrypted on write and decrypted on read.
 * The keyring is resolved when a value is converted, not when the schema is loaded, so
 * tooling such as drizzle-kit can import the schema without any KEK configured.
 */
export function encrypted(name: string, options: EncryptedColumnOptions = {}) {
  const { keyring, cryptoOptions } = columnCrypto(options);
  return customType<{ data: string; driverData: string }>({
    dataType: () => 'text',
    toDriver: (value) => encrypt(value, keyring(), cryptoOptions),
    fromDriver: (value) => decrypt(value, keyring(), cryptoOptions),
  })(name);
}

/**
 * Like {@link encrypted}, for a JSON value: serialised with `JSON.stringify`, then sealed
 * into a `text` column. Use it for JSON that may hold PII; it cannot be queried in SQL.
 * Declare the value type with Drizzle's `.$type<T>()`.
 */
export function encryptedJson(name: string, options: EncryptedColumnOptions = {}) {
  const { keyring, cryptoOptions } = columnCrypto(options);
  return customType<{ data: unknown; driverData: string }>({
    dataType: () => 'text',
    toDriver: (value) => encrypt(JSON.stringify(value), keyring(), cryptoOptions),
    fromDriver: (value): unknown => JSON.parse(decrypt(value, keyring(), cryptoOptions)),
  })(name);
}

/** C55.3: the HKDF info of the OTP code key; equals `OTP_KEY_INFO` in `@openverify/contracts`. */
export const OTP_KEY_HKDF_INFO = 'openverify/otp/v1';

/**
 * C55.3: `K_otp = HKDF-SHA-256(KEK, salt empty, info "openverify/otp/v1", 32)` for the KEK
 * `keyId` of the keyring, or `null` when that KEK has left the keyring (a code under it then
 * reads as expired). Never log or store the key.
 */
export function otpKey(keyring: Keyring, keyId: string): Uint8Array | null {
  const kek = keyMaterial.get(keyring)?.get(keyId);
  if (kek === undefined) {
    return null;
  }
  return new Uint8Array(hkdfSync('sha256', kek, Buffer.alloc(0), OTP_KEY_HKDF_INFO, KEY_BYTES));
}

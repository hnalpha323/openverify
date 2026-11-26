/**
 * Time-based one-time passwords (RFC 6238, contract C15) on `node:crypto`: HMAC-SHA-1, 6 digits,
 * 30 second steps, and codes of the previous and next step accepted too. The step of the last
 * accepted code is stored per factor, so a code (or an older one) cannot be used twice.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { TOTP_DIGITS, TOTP_PERIOD_SECONDS, TOTP_WINDOW_STEPS } from '@openverify/contracts';

/** 160 bits, the HMAC-SHA-1 key length RFC 4226 §4 recommends. */
export const TOTP_SECRET_BYTES = 20;

export type HotpAlgorithm = 'sha1' | 'sha256' | 'sha512';

export interface HotpOptions {
  /** Defaults to 6 (C15); RFC 6238's test vectors use 8. */
  digits?: number;
  /** Defaults to SHA-1 (C15); the other two exist for the RFC 6238 vectors. */
  algorithm?: HotpAlgorithm;
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 without padding, as authenticator apps expect secrets. */
export function base32Encode(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32.charAt((buffer >> bits) & 31);
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) {
    out += BASE32.charAt((buffer << (5 - bits)) & 31);
  }
  return out;
}

/**
 * Decodes base32, ignoring case, spaces and `=` padding.
 * @throws {RangeError} for a character outside the RFC 4648 alphabet.
 */
export function base32Decode(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[\s=]/g, '');
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of clean) {
    const value = BASE32.indexOf(character);
    if (value === -1) {
      throw new RangeError('The secret is not base32');
    }
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
    buffer &= (1 << bits) - 1;
  }
  return Uint8Array.from(out);
}

/** A new shared secret: {@link TOTP_SECRET_BYTES} random bytes as unpadded base32. */
export function newTotpSecret(random: (size: number) => Uint8Array = randomBytes): string {
  return base32Encode(random(TOTP_SECRET_BYTES));
}

/** HOTP (RFC 4226 §5.3): the HMAC of the 8-byte big-endian counter, dynamically truncated. */
export function hotp(key: Uint8Array, counter: number, options: HotpOptions = {}): string {
  const digits = options.digits ?? TOTP_DIGITS;
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(options.algorithm ?? 'sha1', key)
    .update(message)
    .digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** The RFC 6238 time step of `at`: whole 30 second periods since the Unix epoch. */
export function totpStep(at: Date): number {
  return Math.floor(at.getTime() / 1000 / TOTP_PERIOD_SECONDS);
}

/** The 6-digit code of a base32 `secret` at `at`. */
export function totpCode(secret: string, at: Date): string {
  return hotp(base32Decode(secret), totpStep(at));
}

const CODE = new RegExp(`^\\d{${String(TOTP_DIGITS)}}$`);

/**
 * Checks `code` against the steps around `at` (±{@link TOTP_WINDOW_STEPS}) and returns the step
 * it matched, or `null`. Steps at or before `lastUsedStep` never match (replay protection), and
 * every candidate is compared in constant time. A malformed code or secret is a mismatch.
 */
export function verifyTotp(
  secret: string,
  code: string,
  at: Date,
  options: { lastUsedStep?: number | null } = {},
): number | null {
  if (!CODE.test(code)) {
    return null;
  }
  let key: Uint8Array;
  try {
    key = base32Decode(secret);
  } catch {
    return null;
  }
  const presented = Buffer.from(code, 'ascii');
  const current = totpStep(at);
  let matched: number | null = null;
  for (let step = current - TOTP_WINDOW_STEPS; step <= current + TOTP_WINDOW_STEPS; step += 1) {
    const fresh = options.lastUsedStep == null || step > options.lastUsedStep;
    // Every step is computed and compared, so the time taken says nothing about which matched.
    const equal = timingSafeEqual(Buffer.from(hotp(key, step), 'ascii'), presented);
    if (equal && fresh && matched === null) {
      matched = step;
    }
  }
  return matched;
}

export interface OtpauthUriInput {
  /** The base32 secret. */
  secret: string;
  /** Shown in the authenticator app under the issuer, e.g. the operator's email. */
  accountName: string;
  issuer: string;
}

/**
 * The Key URI authenticator apps scan (`otpauth://totp/<issuer>:<account>?...`), stating the
 * C15 parameters explicitly: SHA1, 6 digits, 30 seconds.
 */
export function otpauthUri({ secret, accountName, issuer }: OtpauthUriInput): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
  const query = [
    `secret=${secret}`,
    `issuer=${encodeURIComponent(issuer)}`,
    'algorithm=SHA1',
    `digits=${String(TOTP_DIGITS)}`,
    `period=${String(TOTP_PERIOD_SECONDS)}`,
  ].join('&');
  return `otpauth://totp/${label}?${query}`;
}

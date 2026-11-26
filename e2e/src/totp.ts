/**
 * Time-based one-time passwords (RFC 6238) as an authenticator app computes them: HMAC-SHA-1,
 * 30 second steps and, by default, 6 digits (contract C15). The e2e suite signs the seeded MFA
 * admin in with them. Independent of the API's implementation on purpose.
 */
import { createHmac } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD_SECONDS = 30;

/** RFC 4648 base32 without padding, as authenticator apps show secrets. */
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
  return bits > 0 ? out + BASE32.charAt((buffer << (5 - bits)) & 31) : out;
}

/**
 * Decodes base32, ignoring case, spaces and `=` padding.
 * @throws {RangeError} for a character outside the RFC 4648 alphabet.
 */
export function base32Decode(text: string): Uint8Array {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of text.toUpperCase().replace(/[\s=]/g, '')) {
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

/** HOTP (RFC 4226 §5.3) with HMAC-SHA-1. */
export function hotp(key: Uint8Array, counter: number, digits: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', key).update(message).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** The code of a base32 `secret` at `at`. */
export function totpCode(secret: string, at: Date, digits = 6): string {
  return hotp(base32Decode(secret), Math.floor(at.getTime() / 1000 / PERIOD_SECONDS), digits);
}

/** The RFC 6238 time step of `at`; the API refuses a step at or before the last one used. */
export function totpStep(at: Date): number {
  return Math.floor(at.getTime() / 1000 / PERIOD_SECONDS);
}

/** Milliseconds from `at` until the next step starts, when a new code appears. */
export function msUntilNextStep(at: Date): number {
  return (totpStep(at) + 1) * PERIOD_SECONDS * 1000 - at.getTime();
}

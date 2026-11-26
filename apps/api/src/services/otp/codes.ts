/**
 * C55.2, C55.3: one-time codes. A code is `crypto.randomInt(0, 10 ** length)`, zero-padded, six
 * to ten digits; only its HMAC is stored: `HMAC-SHA-256(K_otp, "otp/v1|" + verificationId + "|" +
 * channel + "|" + normalised destination + "|" + code)` under `K_otp = otpKey(keyring, kid)`, and
 * compared in constant time. The code itself is never stored, logged or returned.
 */
import { createHmac, randomInt as cryptoRandomInt, timingSafeEqual } from 'node:crypto';
import { OTP_CODE_LENGTH, OTP_HMAC_PREFIX } from '@openverify/contracts';
import type { OtpChannel } from '@openverify/db';

/** What a code is bound to (C55.4): its verification, channel and normalised destination. */
export interface OtpCodeBinding {
  verificationId: string;
  channel: OtpChannel;
  /** E.164 for `sms`, the lower-cased address for `email`. */
  destination: string;
}

/** A CSPRNG integer in `[min, max)`: `crypto.randomInt` unless a test injects one. */
export type RandomInt = (min: number, max: number) => number;

const HMAC_BYTES = 32;

/**
 * A new code of `length` digits (C55.2): uniform over `[0, 10^length)` (`randomInt` avoids modulo
 * bias), zero-padded.
 * @throws {RangeError} for a length outside 6-10.
 */
export function newOtpCode(length: number, randomInt: RandomInt = cryptoRandomInt): string {
  if (
    !Number.isInteger(length) ||
    length < OTP_CODE_LENGTH.min ||
    length > OTP_CODE_LENGTH.max
  ) {
    throw new RangeError(
      `A code has ${String(OTP_CODE_LENGTH.min)} to ${String(OTP_CODE_LENGTH.max)} digits`,
    );
  }
  return String(randomInt(0, 10 ** length)).padStart(length, '0');
}

/** The stored HMAC of `code` under the code key `key` (C55.3): 32 bytes. */
export function otpCodeHmac(key: Uint8Array, binding: OtpCodeBinding, code: string): Uint8Array {
  return new Uint8Array(
    createHmac('sha256', key)
      .update(
        `${OTP_HMAC_PREFIX}${binding.verificationId}|${binding.channel}|${binding.destination}|${code}`,
        'utf8',
      )
      .digest(),
  );
}

/**
 * Whether `code` is the one `stored` is the HMAC of, compared in constant time; a missing or
 * malformed stored value matches nothing (and is still compared, so the time says nothing).
 */
export function otpCodeMatches(
  key: Uint8Array,
  binding: OtpCodeBinding,
  code: string,
  stored: Uint8Array | null,
): boolean {
  const candidate = otpCodeHmac(key, binding, code);
  const usable = stored?.byteLength === HMAC_BYTES;
  const against = usable ? stored : new Uint8Array(HMAC_BYTES);
  return timingSafeEqual(candidate, against) && usable;
}

/**
 * MFA recovery codes (contract C9): 10 per user, each `XXXX-XXXX-XXXX` in Crockford base32
 * (60 random bits). Servers store only Argon2id hashes of the canonical form, and each code
 * works once. Reading is forgiving, as Crockford intends: case, spaces and hyphens do not
 * matter, and `I`/`L` read as `1`, `O` as `0`.
 */
import { z } from 'zod';
import { randomBytesOf, webCryptoRandomBytes, type RandomBytes } from './ids.js';

export const RECOVERY_CODE_COUNT = 10;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const GROUP = '[0-9A-HJKMNP-TV-Z]{4}';
export const RECOVERY_CODE_PATTERN = new RegExp(`^${GROUP}-${GROUP}-${GROUP}$`);

const CODE_CHARACTERS = 12;
const RANDOM_BYTES = 8;
/** Draws allowed for a full set; a working source repeats a 60-bit code practically never. */
const MAX_DRAWS = 3 * RECOVERY_CODE_COUNT;

function format(characters: string): string {
  return `${characters.slice(0, 4)}-${characters.slice(4, 8)}-${characters.slice(8, 12)}`;
}

/** A new recovery code: 12 Crockford base32 characters from 60 random bits. */
export function newRecoveryCode(random: RandomBytes = webCryptoRandomBytes): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of randomBytesOf(random, RANDOM_BYTES)) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < CODE_CHARACTERS) {
      bits -= 5;
      out += CROCKFORD.charAt((buffer >> bits) & 31);
    }
    buffer &= (1 << bits) - 1;
  }
  return format(out);
}

/**
 * A fresh set of 10 distinct recovery codes, returned to the user once.
 * @throws {Error} when the randomness source keeps repeating itself.
 */
export function newRecoveryCodes(random: RandomBytes = webCryptoRandomBytes): string[] {
  const codes = new Set<string>();
  for (let draw = 0; draw < MAX_DRAWS && codes.size < RECOVERY_CODE_COUNT; draw += 1) {
    codes.add(newRecoveryCode(random));
  }
  if (codes.size < RECOVERY_CODE_COUNT) {
    throw new Error('The randomness source repeats itself');
  }
  return [...codes];
}

/**
 * The canonical form of a typed recovery code, or `null` when it cannot be one. Hash and
 * compare only canonical forms.
 */
export function normalizeRecoveryCode(input: string): string | null {
  const characters = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  return new RegExp(`^[0-9A-HJKMNP-TV-Z]{${String(CODE_CHARACTERS)}}$`).test(characters)
    ? format(characters)
    : null;
}

/** A recovery code as a person types it (`recovery-code` of `POST /dashboard/sessions/mfa`). */
export const recoveryCodeInputSchema = z
  .string()
  .max(32)
  .refine((value) => normalizeRecoveryCode(value) !== null, 'must be a recovery code');

/** The `recovery-codes` returned once: exactly 10 distinct canonical codes. */
export const recoveryCodesSchema = z
  .array(z.string().regex(RECOVERY_CODE_PATTERN, 'must be a canonical recovery code'))
  .length(RECOVERY_CODE_COUNT)
  .refine((codes) => new Set(codes).size === codes.length, 'must not contain duplicates');

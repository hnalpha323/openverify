/**
 * C62.5: the rules of a chip challenge that need no database: the 8-byte CSPRNG nonce as 16
 * lower-case hex characters, the SHA-256 stored in its place, and the problems every refusal
 * answers (one `chip_challenge_invalid` body for a wrong, used or expired challenge, and
 * `chip_data_required` for a SOD listing a data group that was not uploaded).
 */
import { createHash, randomBytes as cryptoRandomBytes } from 'node:crypto';
import { CHIP_CHALLENGE_NONCE_HEX_LENGTH } from '@openverify/contracts';
import { Phase5ProblemError } from '../../errors.js';

/** C62.5: the nonce's bytes (16 hex characters). */
const NONCE_BYTES = CHIP_CHALLENGE_NONCE_HEX_LENGTH / 2;

/** C62.5: the one body of every refused challenge (its golden problem's detail). */
export const CHIP_CHALLENGE_INVALID_DETAIL =
  'The chip challenge is unknown, used, superseded or expired; create a new one.';

/** C62.5: the golden problem's detail of `chip_data_required`. */
export const CHIP_DATA_REQUIRED_DETAIL = 'The chip data lists data groups that were not uploaded.';

/** 409 `chip_challenge_invalid`, with the one detail of C62.5 unless told otherwise. */
export function chipChallengeInvalid(
  detail: string = CHIP_CHALLENGE_INVALID_DETAIL,
): Phase5ProblemError {
  return new Phase5ProblemError('chip_challenge_invalid', detail);
}

/** 409 `chip_data_required`. */
export function chipDataRequired(): Phase5ProblemError {
  return new Phase5ProblemError('chip_data_required', CHIP_DATA_REQUIRED_DETAIL);
}

/** C62.5: a new nonce, 8 CSPRNG bytes as 16 lower-case hex characters. */
export function newChipChallengeNonce(
  randomBytes: (size: number) => Uint8Array = (size) => cryptoRandomBytes(size),
): string {
  return Buffer.from(randomBytes(NONCE_BYTES)).toString('hex');
}

/** C62.5: the lower-case hex SHA-256 of the nonce's 8 bytes, which the challenge row stores. */
export function chipNonceSha256(nonce: string): string {
  return createHash('sha256').update(Buffer.from(nonce, 'hex')).digest('hex');
}

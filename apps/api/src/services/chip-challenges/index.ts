/**
 * C62.5: the chip challenges of the flow API (`api-nfc`). A challenge is the server nonce a chip
 * signs for Active Authentication:
 *
 * - its preconditions are C52.1's (`requireFlowVerification`): the session's `initiated`
 *   government ID NFC verification of an open inquiry, after consent;
 * - in one transaction under the C40.6 lock order (the inquiry re-checked open and unredacted,
 *   then the verification re-checked `initiated`, then its challenges), the open challenge is
 *   superseded (or expired), and the new one stored with only its nonce's SHA-256;
 * - the nonce (8 CSPRNG bytes, 16 hex characters) is returned once, with the challenge's id and
 *   its expiry (300 s);
 * - the 11th challenge cancels the verification instead (a retryable attempt; the inquiry fails
 *   when the step has no attempt left) and answers 409 `chip_challenge_invalid`.
 *
 * Nothing here logs a nonce.
 */
export * from './create.js';
export * from './rules.js';

/**
 * C57.2, C57.3: the server-issued, single-use challenge a wallet signs to prove control of an
 * address. `POST /api/v1/flow/verifications/:id/crypto-challenges` creates one (201), superseding
 * the open one; the eleventh cancels the verification (a retryable attempt) and answers 409
 * `crypto_challenge_invalid`. The submit body names it in its `crypto` member.
 */
import {
  CRYPTO_INPUT_LIMITS,
  cryptoChainIdSchema,
  cryptoSignatureSchemeSchema,
} from '@openverify/core';
import { z } from 'zod';
import { idSchema } from './ids.js';
import { timestampSchema } from './json-api.js';

/** C57.2: ten minutes. */
export const CRYPTO_CHALLENGE_TTL_SECONDS = 600;
/** C57.2: the most challenges a verification may create; the next cancels it. */
export const CRYPTO_CHALLENGE_LIMIT = 10;
/** C57.2: the base62 nonce in the message. */
export const CRYPTO_CHALLENGE_NONCE_LENGTH = 16;

/** Whether `value` is at most `max` UTF-8 bytes. */
const withinBytes = (max: number) => (value: string) =>
  new TextEncoder().encode(value).length <= max;

export const createCryptoChallengeBodySchema = z.strictObject({
  'chain-id': cryptoChainIdSchema,
  'wallet-address': z.string().min(1).max(CRYPTO_INPUT_LIMITS.addressMaxLength),
});
export type CreateCryptoChallengeBody = z.infer<typeof createCryptoChallengeBodySchema>;

/** 201: the message to sign, returned once. */
export const flowCryptoChallengeResponseSchema = z.strictObject({
  id: idSchema('cwc'),
  message: z
    .string()
    .min(1)
    .refine(withinBytes(CRYPTO_INPUT_LIMITS.messageMaxBytes), 'must be at most 4 KiB'),
  'expires-at': timestampSchema,
});
export type FlowCryptoChallengeResponse = z.infer<typeof flowCryptoChallengeResponseSchema>;

/**
 * C57.3: the submit body's `crypto` member: the signature over the challenge and, when the wallet
 * wraps the message (Solana, BIP-322), the bytes it signed. Every refusal answers one 409
 * `crypto_challenge_invalid` body.
 */
export const flowCryptoSubmitSchema = z.strictObject({
  'challenge-id': idSchema('cwc'),
  signature: z.string().min(1).max(CRYPTO_INPUT_LIMITS.signatureMaxLength),
  'signed-message': z
    .string()
    .min(1)
    .refine(withinBytes(CRYPTO_INPUT_LIMITS.messageMaxBytes), 'must be at most 4 KiB')
    .optional(),
  scheme: cryptoSignatureSchemeSchema.optional(),
});
export type FlowCryptoSubmit = z.infer<typeof flowCryptoSubmitSchema>;

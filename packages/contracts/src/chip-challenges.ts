/**
 * C62.5: the server nonce a chip signs for Active Authentication.
 * `POST /api/v1/flow/verifications/:id/chip-challenges` creates one (201), its nonce stored as
 * SHA-256; the eleventh cancels the verification (a retryable attempt). The submit body names it
 * in its `chip` member. Phase 5 reads chips only through an API-driven client (Phase 10 for
 * Android).
 */
import { z } from 'zod';
import { idSchema } from './ids.js';
import { timestampSchema } from './json-api.js';

/** C62.5: five minutes. */
export const CHIP_CHALLENGE_TTL_SECONDS = 300;
/** C62.5: the most challenges a verification may create; the next cancels it. */
export const CHIP_CHALLENGE_LIMIT = 10;
/** C62.5: 8 CSPRNG bytes as 16 lower-case hex characters. */
export const CHIP_CHALLENGE_NONCE_HEX_LENGTH = 16;
/** C62.5: the longest Active Authentication response taken. */
export const ACTIVE_AUTHENTICATION_RESPONSE_MAX_BYTES = 1024;

const nonceSchema = z.string().regex(/^[0-9a-f]{16}$/, 'must be 16 lower-case hex characters');

/** The create body: empty. */
export const createChipChallengeBodySchema = z.strictObject({});

/** 201: the nonce, returned once. */
export const flowChipChallengeResponseSchema = z.strictObject({
  id: idSchema('chc'),
  nonce: nonceSchema,
  'expires-at': timestampSchema,
});
export type FlowChipChallengeResponse = z.infer<typeof flowChipChallengeResponseSchema>;

/** Standard base64 with padding. */
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function base64Bytes(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

/** The chip protocols a device reports trying (C62.5). */
export const CHIP_PROTOCOLS = [
  'bac',
  'pace',
  'pace-cam',
  'chip-authentication',
  'active-authentication',
] as const;

/**
 * C62.5: what the device says it did, shown to operators only and never evidence: the protocols
 * it tried with their outcomes, and how long the read took.
 */
export const chipDeviceReportSchema = z.strictObject({
  protocols: z
    .array(
      z.strictObject({
        protocol: z.enum(CHIP_PROTOCOLS),
        outcome: z.enum(['succeeded', 'failed', 'not-attempted']),
      }),
    )
    .max(10)
    .optional(),
  'read-ms': z.int().min(0).max(600_000).optional(),
});
export type ChipDeviceReport = z.infer<typeof chipDeviceReportSchema>;

/**
 * C62.5: the submit body's `chip` member. A wrong, used or expired challenge is one 409
 * `chip_challenge_invalid`; a SOD listing a DG among 1, 2, 14 and 15 that was not uploaded is 409
 * `chip_data_required`.
 */
export const flowChipSubmitSchema = z.strictObject({
  'challenge-id': idSchema('chc'),
  nonce: nonceSchema,
  'active-authentication-response': z
    .string()
    .min(4)
    .regex(BASE64, 'must be base64')
    .refine(
      (value) => base64Bytes(value) <= ACTIVE_AUTHENTICATION_RESPONSE_MAX_BYTES,
      'must be at most 1 KiB',
    )
    .optional(),
  'device-report': chipDeviceReportSchema.optional(),
});
export type FlowChipSubmit = z.infer<typeof flowChipSubmitSchema>;

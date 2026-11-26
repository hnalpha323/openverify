/**
 * Multi-factor authentication for dashboard users (contract C15): TOTP (RFC 6238 with SHA-1,
 * 6 digits, 30 s steps, ±1 step), WebAuthn, and recovery codes. Secrets and credential keys
 * never leave the server after enrolment; the TOTP secret is shown once.
 *
 * WebAuthn options and credentials use the W3C JSON serialization (camelCase, base64url); the
 * schemas name the members the server relies on and keep the rest, which browsers and the
 * WebAuthn library may extend.
 */
import { z } from 'zod';
import { idSchema } from './ids.js';
import {
  listDocumentSchema,
  resourceSchema,
  singleDocumentSchema,
  timestampSchema,
  toNullableTimestamp,
  toTimestamp,
} from './json-api.js';
import { recoveryCodesSchema } from './recovery-codes.js';

export const MFA_FACTOR_KINDS = ['totp', 'webauthn'] as const;
export const mfaFactorKindSchema = z.enum(MFA_FACTOR_KINDS);
export type MfaFactorKind = z.infer<typeof mfaFactorKindSchema>;

/** A TOTP factor is `pending` until confirmed with a valid code; WebAuthn is active at once. */
export const MFA_FACTOR_STATUSES = ['pending', 'active'] as const;
export const mfaFactorStatusSchema = z.enum(MFA_FACTOR_STATUSES);
export type MfaFactorStatus = z.infer<typeof mfaFactorStatusSchema>;

export const mfaFactorNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^\P{Cc}+$/u, 'must not contain control characters');

export const mfaFactorAttributesSchema = z
  .strictObject({
    kind: mfaFactorKindSchema,
    /** A label the user chose, such as "Phone". */
    name: mfaFactorNameSchema.nullable(),
    status: mfaFactorStatusSchema,
    'created-at': timestampSchema,
    'confirmed-at': timestampSchema.nullable(),
    'last-used-at': timestampSchema.nullable(),
  })
  .refine(
    (attributes) => (attributes.status === 'active') === (attributes['confirmed-at'] !== null),
    {
      message: 'a factor is confirmed exactly when it is active',
      path: ['confirmed-at'],
    },
  );

export const mfaFactorResourceSchema = resourceSchema(
  'mfa-factor',
  'mfa',
  mfaFactorAttributesSchema,
);
export type MfaFactorResource = z.infer<typeof mfaFactorResourceSchema>;

export const mfaFactorDocumentSchema = singleDocumentSchema(mfaFactorResourceSchema);
/** `GET /api/v1/dashboard/me/mfa-factors`. */
export const mfaFactorListDocumentSchema = listDocumentSchema(mfaFactorResourceSchema);

export interface MfaFactorRecord {
  id: string;
  kind: MfaFactorKind;
  name: string | null;
  status: MfaFactorStatus;
  createdAt: Date;
  confirmedAt: Date | null;
  lastUsedAt: Date | null;
}

/**
 * Builds the mfa-factor resource.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildMfaFactorResource(record: MfaFactorRecord): MfaFactorResource {
  return mfaFactorResourceSchema.parse({
    type: 'mfa-factor',
    id: record.id,
    attributes: {
      kind: record.kind,
      name: record.name,
      status: record.status,
      'created-at': toTimestamp(record.createdAt),
      'confirmed-at': toNullableTimestamp(record.confirmedAt),
      'last-used-at': toNullableTimestamp(record.lastUsedAt),
    },
  });
}

export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
/** Codes of the previous and next step are accepted too; the last used step is stored. */
export const TOTP_WINDOW_STEPS = 1;

export const totpCodeSchema = z.string().regex(/^\d{6}$/, 'must be a 6-digit code');
/** RFC 4648 base32 without padding, as authenticator apps expect it. */
export const totpSecretSchema = z.string().regex(/^[A-Z2-7]{16,128}$/, 'must be base32');
export const otpauthUriSchema = z
  .string()
  .max(2048)
  .regex(/^otpauth:\/\/totp\/\S+$/, 'must be an otpauth://totp/ URI');

/** `POST /api/v1/dashboard/me/mfa-factors/totp`. */
export const enrollTotpBodySchema = z.strictObject({ name: mfaFactorNameSchema.optional() });

/** The pending factor, with its secret and `otpauth-uri` shown this once. */
export const enrollTotpResponseSchema = z.strictObject({
  data: mfaFactorResourceSchema,
  meta: z.strictObject({ 'otpauth-uri': otpauthUriSchema, secret: totpSecretSchema }),
});

/** `POST /api/v1/dashboard/me/mfa-factors/totp/confirm`. */
export const confirmTotpBodySchema = z.strictObject({
  'factor-id': idSchema('mfa'),
  'totp-code': totpCodeSchema,
});

/** The active factor; the first factor a user confirms may come with recovery codes. */
export const confirmTotpResponseSchema = z.strictObject({
  data: mfaFactorResourceSchema,
  meta: z.strictObject({ 'recovery-codes': recoveryCodesSchema }).optional(),
});

/**
 * `POST /api/v1/dashboard/me/recovery-codes`: a new set, shown once; the previous codes stop
 * working.
 */
export const recoveryCodesResponseSchema = z.strictObject({
  'recovery-codes': recoveryCodesSchema,
});

const base64UrlSchema = z
  .string()
  .min(1)
  .max(65_536)
  .regex(/^[A-Za-z0-9_-]+$/, 'must be base64url');

const credentialDescriptorSchema = z.looseObject({
  id: base64UrlSchema,
  type: z.literal('public-key'),
  transports: z.array(z.string().max(32)).optional(),
});

/** `PublicKeyCredentialCreationOptionsJSON`, for enrolment. */
export const webauthnCreationOptionsSchema = z.looseObject({
  challenge: base64UrlSchema,
  rp: z.looseObject({ name: z.string().min(1), id: z.string().min(1).optional() }),
  user: z.looseObject({ id: base64UrlSchema, name: z.string().min(1), displayName: z.string() }),
  pubKeyCredParams: z.array(z.looseObject({ type: z.literal('public-key'), alg: z.int() })).min(1),
  timeout: z.int().min(0).optional(),
  excludeCredentials: z.array(credentialDescriptorSchema).optional(),
  authenticatorSelection: z.record(z.string(), z.unknown()).optional(),
  attestation: z.string().optional(),
  extensions: z.record(z.string(), z.unknown()).optional(),
});

/** `PublicKeyCredentialRequestOptionsJSON`, for login. */
export const webauthnRequestOptionsSchema = z.looseObject({
  challenge: base64UrlSchema,
  timeout: z.int().min(0).optional(),
  rpId: z.string().min(1).optional(),
  allowCredentials: z.array(credentialDescriptorSchema).optional(),
  userVerification: z.string().optional(),
  extensions: z.record(z.string(), z.unknown()).optional(),
});

/** `RegistrationResponseJSON` from `navigator.credentials.create()`. */
export const webauthnRegistrationResponseSchema = z.looseObject({
  id: base64UrlSchema,
  rawId: base64UrlSchema,
  type: z.literal('public-key'),
  response: z.looseObject({
    clientDataJSON: base64UrlSchema,
    attestationObject: base64UrlSchema,
    transports: z.array(z.string().max(32)).optional(),
  }),
  clientExtensionResults: z.record(z.string(), z.unknown()),
  authenticatorAttachment: z.string().optional(),
});

/** `AuthenticationResponseJSON` from `navigator.credentials.get()`. */
export const webauthnAuthenticationResponseSchema = z.looseObject({
  id: base64UrlSchema,
  rawId: base64UrlSchema,
  type: z.literal('public-key'),
  response: z.looseObject({
    clientDataJSON: base64UrlSchema,
    authenticatorData: base64UrlSchema,
    signature: base64UrlSchema,
    userHandle: base64UrlSchema.optional(),
  }),
  clientExtensionResults: z.record(z.string(), z.unknown()),
  authenticatorAttachment: z.string().optional(),
});

/** `POST /api/v1/dashboard/me/mfa-factors/webauthn/options`. */
export const webauthnRegistrationOptionsBodySchema = z.strictObject({
  name: mfaFactorNameSchema.optional(),
});
export const webauthnRegistrationOptionsResponseSchema = z.strictObject({
  options: webauthnCreationOptionsSchema,
});

/** `POST /api/v1/dashboard/me/mfa-factors/webauthn/verify`; answers with the new factor. */
export const webauthnRegistrationVerifyBodySchema = z.strictObject({
  credential: webauthnRegistrationResponseSchema,
  name: mfaFactorNameSchema.optional(),
});

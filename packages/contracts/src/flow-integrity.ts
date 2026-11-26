/**
 * Phase 10, Workflow 10B Stage 1a (contracts-10b): device integrity on the flow API (C210, C211).
 * Everything a device sends here is client-reported and decides nothing on its own (ADR 0009, C210.5).
 */
import { z } from 'zod';
import { idSchema } from './ids.js';
import { timestampSchema } from './json-api.js';

export {
  ANDROID_EMULATOR_INDICATORS,
  ANDROID_HOOKING_INDICATORS,
  ANDROID_ROOT_INDICATORS,
} from './flow-signals.js';

/**
 * C211.3: the session's `integrity` member, served only after consent once the session-integrity tier
 * is collected: `request` is true when the environment binds a `deviceIntegrity` provider and the
 * inquiry has no verdict yet, so the SDK asks its host's `IntegrityTokenProvider` for one token.
 */
export const flowSessionIntegritySchema = z.strictObject({ request: z.boolean() });
export type FlowSessionIntegrity = z.infer<typeof flowSessionIntegritySchema>;

/** C211.3: `POST /api/v1/flow/integrity-challenges` takes nothing; the server draws the challenge. */
export const flowIntegrityChallengeBodySchema = z.strictObject({});

/**
 * C211.3: the challenge: its id (`ich_`), its `request-hash` (base64url, no padding, of SHA-256 over
 * `openverify/play-integrity/v1`, the session id and 16 random bytes, computed by the server) and its
 * expiry (600 s). The hash is what the device passes to Play Integrity; it is not a secret.
 */
export const flowIntegrityChallengeSchema = z.strictObject({
  id: idSchema('ich'),
  'request-hash': z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'must be base64url of 32 bytes'),
  'expires-at': timestampSchema,
});
export type FlowIntegrityChallenge = z.infer<typeof flowIntegrityChallengeSchema>;

/** C211.3: at most 16 KiB of token. */
export const INTEGRITY_TOKEN_MAX_LENGTH = 16 * 1024;

/**
 * C211.3: `POST /api/v1/flow/integrity-tokens` (202, no body). The token is a secret of the device's
 * attestation: never logged, stored or served (C211.4); it is decoded in a job and dropped.
 */
export const flowIntegrityTokenBodySchema = z.strictObject({
  'challenge-id': idSchema('ich'),
  token: z.string().min(1).max(INTEGRITY_TOKEN_MAX_LENGTH).meta({ pii: true }),
});
export type FlowIntegrityTokenBody = z.infer<typeof flowIntegrityTokenBodySchema>;

/** The token body's members the API log masks (C211.4, rule 11). */
export const INTEGRITY_TOKEN_BODY_PII_MEMBERS = Object.freeze(['token'] as const);

/**
 * C211.4 (Phase 5 C63): the implementations of the provider kind `deviceIntegrity`
 * (`OPENVERIFY_PROVIDER_DEVICE_INTEGRITY_*`): Google's decode through our REST client, and the
 * deterministic sandbox, which production refuses.
 */
export const DEVICE_INTEGRITY_PROVIDERS = Object.freeze(['play-integrity', 'sandbox'] as const);
export type DeviceIntegrityProvider = (typeof DEVICE_INTEGRITY_PROVIDERS)[number];

/** C211.4: the sandbox provider's magic tokens, each answering a fixed verdict (or a replay). */
export const SANDBOX_INTEGRITY_TOKENS = Object.freeze([
  'sandbox-strong',
  'sandbox-device',
  'sandbox-basic',
  'sandbox-none',
  'sandbox-unrecognized-app',
  'sandbox-replayed',
] as const);
export type SandboxIntegrityToken = (typeof SANDBOX_INTEGRITY_TOKENS)[number];

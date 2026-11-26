/**
 * Devices and the session's parsed device fields (plan C91.1, C91.2, C94.4, C94.5).
 *
 * A `device` (`dev_`) exists only when the device-recognition tier recorded an identifier
 * (C94.6). It is keyed per environment by an HMAC under the blind-index subkey, with the key id
 * recorded (P09), so a fingerprint never crosses environments or installations:
 * - `device-fingerprint` is the `ANDROID_ID` HMAC, and `null` on web (V10);
 * - `browser-fingerprint` is the strict browser HMAC, `null` when the canvas was randomised;
 * - `device-class` (ours) is the web device-class HMAC: a model and configuration many people
 *   share, never a list probe and never served as `device-fingerprint`;
 * - `device-vendor-id` is always `null`: the platforms give us no vendor id.
 *
 * Both fingerprints are PII (identifier-grade, C91.6): masked without `pii:view`, `null` once
 * redacted. Routes: `GET /api/v1/devices?filter[inquiry-session-id]=` (the filter is required:
 * 400 `filter_required`) and `GET /api/v1/devices/:id`, scope `inquiry-sessions:read`.
 */
import { COLLECTOR_TIERS } from '@openverify/core';
import { z } from 'zod';
import { actionBodySchema } from './actions.js';
import { idSchema } from './ids.js';
import {
  listDocumentSchema,
  resourceSchema,
  singleDocumentSchema,
  timestampSchema,
  toNullableTimestamp,
  toTimestamp,
} from './json-api.js';
import { listQuerySchema } from './list-filters.js';

/** Marks a member PII (C91.6): nullable, so a masked or redacted copy still parses. */
function pii<Schema extends z.ZodType>(schema: Schema) {
  return schema.nullable().meta({ pii: true });
}

/** A keyed HMAC as every blind index serves it: 64 lowercase hex characters (F10). */
export const hmacHexSchema = z.string().regex(/^[0-9a-f]{64}$/, 'must be 64 lowercase hex');

/**
 * C94.4 (P09): the blind-index key id, `HMAC(OPENVERIFY_BLIND_INDEX_KEY,
 * "openverify/blind-index-key-id/v1")` truncated to 11 base64url characters, as the KEK's kid.
 */
export const blindIndexKeyIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{11}$/, 'must be an 11-character base64url key id');

/** C91.2: the platform that collected a device's identifier. */
export const DEVICE_PLATFORMS = ['web', 'android'] as const;
export const devicePlatformSchema = z.enum(DEVICE_PLATFORMS);
export type DevicePlatform = z.infer<typeof devicePlatformSchema>;

interface DeviceAttributesShape {
  readonly platform: DevicePlatform;
  readonly 'device-fingerprint': string | null;
  readonly 'browser-fingerprint': string | null;
  readonly 'device-class': string | null;
  readonly 'fingerprint-randomised': boolean;
}

/** C91.2 (V10): each identifier comes from its own platform. */
function identifiersFitPlatform(value: unknown): boolean {
  const attributes = value as DeviceAttributesShape;
  return attributes.platform === 'web'
    ? attributes['device-fingerprint'] === null
    : attributes['browser-fingerprint'] === null && attributes['device-class'] === null;
}

/**
 * C127.9: who trusted a device. The mark is served here and read by workflow conditions alone: no
 * signal reads it, no check reads it or is skipped because of it, and device retention clears it.
 */
export const deviceTrustActorSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('user'), id: idSchema('usr') }),
  z.strictObject({ type: z.literal('api-key'), id: idSchema('key') }),
  z.strictObject({ type: z.literal('workflow-run'), id: idSchema('wfr') }),
]);
export type DeviceTrustActor = z.infer<typeof deviceTrustActorSchema>;

/** C127.9: a code the operator chooses, never free text about a person. */
export const deviceTrustReasonSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/, 'must be a snake_case code');

/** C127.9: a mark is whole or absent. */
function trustMarkIsWhole(value: unknown): boolean {
  const attributes = value as Record<'trusted-at' | 'trusted-by' | 'trust-reason', unknown>;
  const held = [attributes['trusted-at'], attributes['trusted-by'], attributes['trust-reason']];
  return held.every((member) => member === null) || held.every((member) => member !== null);
}

/** C94.4: canvas noise drops the strict HMAC and keeps the device class. */
function randomisedDropsStrict(value: unknown): boolean {
  const attributes = value as DeviceAttributesShape;
  return !attributes['fingerprint-randomised'] || attributes['browser-fingerprint'] === null;
}

export const deviceAttributesSchema = z
  .strictObject({
    'created-at': timestampSchema,
    /** Always `null`: the platforms give us no vendor id. */
    'device-vendor-id': z.null(),
    /** The `ANDROID_ID` HMAC (`openverify/android-id/v1`); `null` on web (V10). */
    'device-fingerprint': pii(hmacHexSchema),
    /** The strict browser HMAC (`openverify/browser-fingerprint/v1`). */
    'browser-fingerprint': pii(hmacHexSchema),
    /** Ours: the web device-class HMAC (`openverify/device-class/v1`), shared by many people. */
    'device-class': hmacHexSchema.nullable(),
    platform: devicePlatformSchema,
    'collector-version': z.int().min(1),
    'fingerprint-randomised': z.boolean(),
    'key-id': blindIndexKeyIdSchema,
    'session-count': z.int().min(0),
    'first-seen-at': timestampSchema,
    'last-seen-at': timestampSchema,
    /** Ours (C127.9): `null` until trusted, and after an untrust. */
    'trusted-at': timestampSchema.nullable(),
    'trusted-by': deviceTrustActorSchema.nullable(),
    'trust-reason': deviceTrustReasonSchema.nullable(),
  })
  .refine(identifiersFitPlatform, {
    message: 'a web device has no device-fingerprint; an Android one no browser identifiers',
    path: ['platform'],
  })
  .refine(randomisedDropsStrict, {
    message: 'a randomised canvas drops the strict browser fingerprint',
    path: ['browser-fingerprint'],
  })
  .refine(trustMarkIsWhole, {
    message: 'a trust mark names its time, who set it and its reason',
    path: ['trusted-at'],
  });

export const deviceResourceSchema = resourceSchema('device', 'dev', deviceAttributesSchema);
export type DeviceResource = z.infer<typeof deviceResourceSchema>;

export const deviceDocumentSchema = singleDocumentSchema(deviceResourceSchema);
export type DeviceDocument = z.infer<typeof deviceDocumentSchema>;
export const deviceListDocumentSchema = listDocumentSchema(deviceResourceSchema);
export type DeviceListDocument = z.infer<typeof deviceListDocumentSchema>;

/**
 * `GET /api/v1/devices` query (scope `inquiry-sessions:read`). The route refuses a request without
 * `filter[inquiry-session-id]` with 400 `filter_required` (C91.2); the schema keeps it optional so
 * the refusal names the problem code.
 */
export const listDevicesQuerySchema = listQuerySchema('dev', {
  'filter[inquiry-session-id]': idSchema('iqse').optional(),
});
export type ListDevicesQuery = z.infer<typeof listDevicesQuerySchema>;

/**
 * `POST /api/v1/devices/:id/trust` (C127.9), scope `devices:write`: sets the mark with its reason,
 * and `meta.untrust: true` clears it. Both are audit-logged. Reversible, so no confirmation.
 */
export const trustDeviceBodySchema = actionBodySchema(
  z
    .strictObject({
      'trust-reason': deviceTrustReasonSchema.optional(),
      untrust: z.literal(true).optional(),
    })
    .refine(
      (meta) => (meta['trust-reason'] === undefined) === (meta.untrust === true),
      'give a trust-reason to trust, or untrust: true to clear the mark, never both',
    ),
);
export type TrustDeviceBody = z.infer<typeof trustDeviceBodySchema>;

/** A device as the builder takes it; the fingerprints already masked or redacted. */
export interface DeviceRecord {
  id: string;
  createdAt: Date;
  deviceFingerprint: string | null;
  browserFingerprint: string | null;
  deviceClass: string | null;
  platform: DevicePlatform;
  collectorVersion: number;
  fingerprintRandomised: boolean;
  keyId: string;
  sessionCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  /** C127.9: left out, untrusted. */
  trustedAt?: Date | null;
  trustedBy?: DeviceTrustActor | null;
  trustReason?: string | null;
}

/**
 * Builds the device resource (C91.2).
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildDeviceResource(record: DeviceRecord): DeviceResource {
  return deviceResourceSchema.parse({
    type: 'device',
    id: record.id,
    attributes: {
      'created-at': toTimestamp(record.createdAt),
      'device-vendor-id': null,
      'device-fingerprint': record.deviceFingerprint,
      'browser-fingerprint': record.browserFingerprint,
      'device-class': record.deviceClass,
      platform: record.platform,
      'collector-version': record.collectorVersion,
      'fingerprint-randomised': record.fingerprintRandomised,
      'key-id': record.keyId,
      'session-count': record.sessionCount,
      'first-seen-at': toTimestamp(record.firstSeenAt),
      'last-seen-at': toTimestamp(record.lastSeenAt),
      'trusted-at': toNullableTimestamp(record.trustedAt ?? null),
      'trusted-by': record.trustedBy ?? null,
      'trust-reason': record.trustReason ?? null,
    },
  });
}

/** C91.1, C94.5: the device types the user agent or the SDK's signal body gives. */
export const SESSION_DEVICE_TYPES = ['desktop', 'smartphone', 'tablet', 'tv'] as const;
/** C94.5: the SDKs that name themselves in their `User-Agent` (`OpenVerify-Android/<version>`). */
export const MOBILE_SDK_NAMES = ['openverify-android', 'openverify-ios'] as const;

const parsedText = z.string().min(1).max(64);

/**
 * C91.1 (amending C10): the parsed device fields and the collection tiers that applied, all
 * nullable. The user agent is parsed with bowser (C94.5); an SDK session's `device-type` comes
 * from the SDK's first signal body and is `null` until one arrives.
 */
export const SESSION_DEVICE_ATTRIBUTE_SHAPE = {
  'os-name': parsedText.nullable(),
  'os-full-version': parsedText.nullable(),
  'browser-name': parsedText.nullable(),
  'browser-full-version': parsedText.nullable(),
  'device-type': z.enum(SESSION_DEVICE_TYPES).nullable(),
  'device-name': parsedText.nullable(),
  'mobile-sdk-name': z.enum(MOBILE_SDK_NAMES).nullable(),
  'mobile-sdk-full-version': parsedText.nullable(),
  /** Ours (C94.6): the collection tiers that applied to the session. */
  'signals-collected': z
    .array(z.enum(COLLECTOR_TIERS))
    .max(COLLECTOR_TIERS.length)
    .refine((tiers) => new Set(tiers).size === tiers.length, 'must not repeat a tier'),
} as const;

/** The session's parsed device fields as the API records them (C93.2, C94.5). */
export interface SessionDeviceRecord {
  osName: string | null;
  osFullVersion: string | null;
  browserName: string | null;
  browserFullVersion: string | null;
  deviceType: (typeof SESSION_DEVICE_TYPES)[number] | null;
  deviceName: string | null;
  mobileSdkName: (typeof MOBILE_SDK_NAMES)[number] | null;
  mobileSdkFullVersion: string | null;
  signalsCollected: readonly (typeof COLLECTOR_TIERS)[number][];
}

/** The session attributes of {@link SESSION_DEVICE_ATTRIBUTE_SHAPE}. */
export function sessionDeviceAttributes(record: SessionDeviceRecord): Record<string, unknown> {
  return {
    'os-name': record.osName,
    'os-full-version': record.osFullVersion,
    'browser-name': record.browserName,
    'browser-full-version': record.browserFullVersion,
    'device-type': record.deviceType,
    'device-name': record.deviceName,
    'mobile-sdk-name': record.mobileSdkName,
    'mobile-sdk-full-version': record.mobileSdkFullVersion,
    'signals-collected': [...record.signalsCollected],
  };
}

function piiMembers(shape: Record<string, z.ZodType>): string[] {
  return Object.entries(shape)
    .filter(([, member]) => (member.meta() as { pii?: unknown } | undefined)?.pii === true)
    .map(([member]) => member);
}

function shapeOf(schema: z.ZodType): Record<string, z.ZodType> {
  let current: unknown = schema;
  while (!(current instanceof z.ZodObject)) {
    current =
      (current as { def: { in?: unknown; innerType?: unknown } }).def.in ??
      (current as { def: { innerType?: unknown } }).def.innerType;
  }
  const shape: Record<string, z.ZodType> = current.shape;
  return shape;
}

/** C91.6, C107.5: the device attributes marked PII: both fingerprints. */
export const PII_DEVICE_ATTRIBUTES: readonly string[] = Object.freeze(
  piiMembers(shapeOf(deviceAttributesSchema)),
);

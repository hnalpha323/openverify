/**
 * The selfie capture (C40): one camera or upload session of a selfie verification. The server
 * issues it with a nonce, an expiry and ordered pose prompts; the client uploads each pose with
 * the capture id, the nonce and its own timing, and submit consumes the capture once.
 *
 * - `POST /api/v1/flow/verifications/:id/selfies` creates one ({@link createSelfieCaptureBodySchema},
 *   answered with {@link flowSelfieCaptureDocumentSchema}, the only place the nonce appears);
 * - `POST /api/v1/flow/verifications/:id/files` takes the three capture fields;
 * - `POST /api/v1/flow/verifications/:id/submit` takes {@link flowSubmitVerificationBodySchema};
 * - `GET /api/v1/selfies/:id` reads the {@link selfieCaptureResourceSchema} (never the nonce or any
 *   device data), which is also the `selfie.*` event payload.
 */
import {
  SELFIE_CAPTURE_ERROR_CODES,
  selfieCaptureErrorCodeSchema,
  selfieCaptureMethodSchema,
  selfieCaptureStatusSchema,
  type SelfieCaptureErrorCode,
  type SelfieCaptureMethod,
  type SelfieCaptureStatus,
} from '@openverify/core';
import { z } from 'zod';
import { inquiryIdentifierSchema } from './identifiers.js';
import { flowChipSubmitSchema } from './chip-challenges.js';
import { flowCryptoSubmitSchema } from './crypto-challenges.js';
import { idSchema } from './ids.js';
import {
  hasDistinctValues,
  resourceIdentifierSchema,
  resourceSchema,
  resourceWithRelationshipsSchema,
  singleDocumentSchema,
  timestampSchema,
  toNullableTimestamp,
  toOneRelationshipSchema,
  toTimestamp,
} from './json-api.js';

export { SELFIE_CAPTURE_ERROR_CODES };

/** C40.2: a capture expires this long after it is created (injected clock). */
export const SELFIE_CAPTURE_TTL_SECONDS = 180;

/** C40.2: the most captures one verification may have; the next create cancels it. */
export const SELFIE_CAPTURE_LIMIT = 10;

/** C40.2: 128 bits from a CSPRNG, base64url without padding. */
export const SELFIE_CAPTURE_NONCE_LENGTH = 22;
export const selfieCaptureNonceSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{22}$/, 'must be 22 base64url characters');

/** The poses a capture prompts for, in the flow-spec selfie step's vocabulary. */
export const SELFIE_POSES = ['center', 'left', 'right'] as const;
export const selfiePoseSchema = z.enum(SELFIE_POSES);
export type SelfiePose = z.infer<typeof selfiePoseSchema>;

/** The file kind each pose is uploaded as (C40.3). */
export const SELFIE_POSE_FILE_KINDS = Object.freeze({
  center: 'selfie-center',
  left: 'selfie-left',
  right: 'selfie-right',
} as const satisfies Record<SelfiePose, `selfie-${string}`>);

/** Ordered prompts: `center` first, each pose once (C40.2). */
export const selfieCapturePromptsSchema = z
  .array(selfiePoseSchema)
  .min(1)
  .max(SELFIE_POSES.length)
  .refine((prompts) => prompts[0] === 'center', 'the first prompt must be center')
  .refine(hasDistinctValues, 'a pose may be prompted once');

/** C40.1 `prompt-timings`: the latest file per pose, with the client's and the server's time. */
export const selfiePromptTimingSchema = z.strictObject({
  pose: selfiePoseSchema,
  'client-elapsed-ms': z.int().min(0).max(600_000).nullable(),
  'received-at': timestampSchema,
});
export type SelfiePromptTiming = z.infer<typeof selfiePromptTimingSchema>;

export const selfieCaptureAttributesSchema = z.strictObject({
  status: selfieCaptureStatusSchema,
  'capture-method': selfieCaptureMethodSchema,
  liveness: z.enum(['passive', 'active']),
  prompts: selfieCapturePromptsSchema,
  'prompt-timings': z.array(selfiePromptTimingSchema),
  'created-at': timestampSchema,
  'expires-at': timestampSchema,
  'submitted-at': timestampSchema.nullable(),
  'processed-at': timestampSchema.nullable(),
  'error-code': selfieCaptureErrorCodeSchema.nullable(),
});

export const selfieVerificationIdentifierSchema = resourceIdentifierSchema(
  'verification/selfie',
  'ver',
);
export const selfieCaptureIdentifierSchema = resourceIdentifierSchema('selfie', 'self');

export const selfieCaptureRelationshipsSchema = z.strictObject({
  verification: toOneRelationshipSchema(selfieVerificationIdentifierSchema),
  inquiry: toOneRelationshipSchema(inquiryIdentifierSchema),
});

/**
 * The `selfie` resource (C40.1): `GET /api/v1/selfies/:id`, `?include=selfies`, and the payload
 * of the `selfie.*` events. It never carries the nonce or any device data.
 */
export const selfieCaptureResourceSchema = resourceWithRelationshipsSchema(
  'selfie',
  'self',
  selfieCaptureAttributesSchema,
  selfieCaptureRelationshipsSchema,
);
export type SelfieCaptureResource = z.infer<typeof selfieCaptureResourceSchema>;

export const selfieCaptureDocumentSchema = singleDocumentSchema(selfieCaptureResourceSchema);
export type SelfieCaptureDocument = z.infer<typeof selfieCaptureDocumentSchema>;

/** What the API stores about a capture, as the resource builder needs it. */
export interface SelfieCaptureRecord {
  id: string;
  verificationId: string;
  inquiryId: string;
  status: SelfieCaptureStatus;
  method: SelfieCaptureMethod;
  liveness: 'passive' | 'active';
  prompts: readonly SelfiePose[];
  promptTimings: readonly {
    pose: SelfiePose;
    clientElapsedMs: number | null;
    receivedAt: Date;
  }[];
  createdAt: Date;
  expiresAt: Date;
  submittedAt: Date | null;
  processedAt: Date | null;
  errorCode: SelfieCaptureErrorCode | null;
}

/**
 * Builds the `selfie` resource. The record's nonce digest and device snapshot are never read.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildSelfieCaptureResource(record: SelfieCaptureRecord): SelfieCaptureResource {
  return selfieCaptureResourceSchema.parse({
    type: 'selfie',
    id: record.id,
    attributes: {
      status: record.status,
      'capture-method': record.method,
      liveness: record.liveness,
      prompts: [...record.prompts],
      'prompt-timings': record.promptTimings.map((timing) => ({
        pose: timing.pose,
        'client-elapsed-ms': timing.clientElapsedMs,
        'received-at': toTimestamp(timing.receivedAt),
      })),
      'created-at': toTimestamp(record.createdAt),
      'expires-at': toTimestamp(record.expiresAt),
      'submitted-at': toNullableTimestamp(record.submittedAt),
      'processed-at': toNullableTimestamp(record.processedAt),
      'error-code': record.errorCode,
    },
    relationships: {
      verification: { data: { type: 'verification/selfie', id: record.verificationId } },
      inquiry: { data: { type: 'inquiry', id: record.inquiryId } },
    },
  });
}

// Flow API (C40.2-C40.4) ----------------------------------------------------------------------

/** `POST /api/v1/flow/verifications/:id/selfies` body; `upload` only in a sandbox (C19). */
export const createSelfieCaptureBodySchema = z.strictObject({ method: selfieCaptureMethodSchema });
export type CreateSelfieCaptureBody = z.infer<typeof createSelfieCaptureBodySchema>;

/**
 * C40.11, from `contracts/fixtures/flow/selfie-capture.json`: the provisional server pose
 * thresholds (the C39.3 defaults of `selfie_pose_detection`) and the client's hold time, as the
 * create response's `guidance` sends them when the template sets no pose config.
 */
export const SELFIE_CAPTURE_GUIDANCE_DEFAULTS = Object.freeze({
  'max-center-yaw-ratio': 0.021,
  'min-side-yaw-ratio-change': 0.077,
  'hold-ms': 500,
});

/**
 * C40.11 client constants: a side pose auto-captures once the yaw-ratio change from the user's
 * own centre frame is `side-trigger-factor` x the server minimum, the centre once `|yaw_ratio|`
 * is at most `center-trigger-factor` x the server maximum; guidance runs at `guidance-hz` on a
 * `preview-width-px` preview, and the manual shutter appears after `manual-shutter-after-ms`.
 */
export const SELFIE_CAPTURE_CLIENT = Object.freeze({
  'side-trigger-factor': 1.25,
  'center-trigger-factor': 0.8,
  'guidance-hz': 8,
  'preview-width-px': 320,
  'manual-shutter-after-ms': 10_000,
});

/** C40.2 `guidance`: the client's auto-capture triggers come from these (C40.11). */
export const selfieCaptureGuidanceSchema = z.strictObject({
  'max-center-yaw-ratio': z.number().positive().max(1),
  'min-side-yaw-ratio-change': z.number().positive().max(2),
  'hold-ms': z.int().min(0).max(10_000),
});
export type SelfieCaptureGuidance = z.infer<typeof selfieCaptureGuidanceSchema>;

/** The flow's view of a new capture: the only place the nonce is ever returned (C40.2). */
export const flowSelfieCaptureResourceSchema = resourceSchema(
  'selfie',
  'self',
  z.strictObject({
    prompts: selfieCapturePromptsSchema,
    'expires-at': timestampSchema,
    nonce: selfieCaptureNonceSchema,
    guidance: selfieCaptureGuidanceSchema,
  }),
);
export const flowSelfieCaptureDocumentSchema = singleDocumentSchema(
  flowSelfieCaptureResourceSchema,
);
export type FlowSelfieCaptureDocument = z.infer<typeof flowSelfieCaptureDocumentSchema>;

/** C40.3 multipart field names of a selfie upload. */
export const SELFIE_CAPTURE_ID_FIELD = 'capture-id';
export const SELFIE_CAPTURE_NONCE_FIELD = 'nonce';
export const CLIENT_ELAPSED_MS_FIELD = 'client-elapsed-ms';
/** Ten minutes: the client's elapsed time since the capture was created, in milliseconds. */
export const CLIENT_ELAPSED_MS_MAX = 600_000;

/** A multipart number: decimal digits only, then bounded. */
export const clientElapsedMsFieldSchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]{0,5})$/, 'must be a whole number of milliseconds')
  .transform(Number)
  .pipe(z.int().min(0).max(CLIENT_ELAPSED_MS_MAX));

/** C40.4: the most characters of a device label the server keeps. */
export const DEVICE_LABEL_MAX_LENGTH = 200;
/** A label longer than this is refused outright, before it is cleaned. */
export const DEVICE_LABEL_MAX_INPUT_LENGTH = 1024;

const CONTROL_AND_BIDI = /[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

/**
 * C40.4: a device label as the server keeps it: control and bidirectional-override characters
 * removed, then cut to {@link DEVICE_LABEL_MAX_LENGTH} characters (code points).
 */
export function sanitizeDeviceLabel(label: string): string {
  return Array.from(label.replace(CONTROL_AND_BIDI, '')).slice(0, DEVICE_LABEL_MAX_LENGTH).join('');
}

const facingModeSchema = z.enum(['user', 'environment', 'left', 'right']);
const pixels = z.int().min(1).max(16_384);
const frameRate = z.number().min(0).max(1000);
const frameCount = z.int().min(0).max(1_000_000_000);

/**
 * C40.4 device snapshot: every member optional, bounded and finite, unknown members refused.
 * Client claims only. Android maps CameraX facts onto it: the camera id into `label`, lens
 * facing into `settings.facing-mode` (front `user`, back `environment`), the resolution into
 * `settings.width`/`height` and the frame rate into `settings.frame-rate`.
 */
export const selfieDeviceSnapshotSchema = z.strictObject({
  label: z.string().max(DEVICE_LABEL_MAX_INPUT_LENGTH).optional(),
  settings: z
    .strictObject({
      width: pixels.optional(),
      height: pixels.optional(),
      'frame-rate': frameRate.optional(),
      'facing-mode': facingModeSchema.optional(),
      'resize-mode': z.enum(['none', 'crop-and-scale']).optional(),
    })
    .optional(),
  capabilities: z
    .strictObject({
      'width-max': pixels.optional(),
      'height-max': pixels.optional(),
      'frame-rate-max': frameRate.optional(),
      'facing-modes': z.array(facingModeSchema).max(4).optional(),
    })
    .optional(),
  'frame-stats': z
    .strictObject({
      delivered: frameCount.optional(),
      discarded: frameCount.optional(),
      total: frameCount.optional(),
    })
    .optional(),
  webdriver: z.boolean().optional(),
  'image-mirrored': z.boolean().optional(),
});
export type SelfieDeviceSnapshot = z.infer<typeof selfieDeviceSnapshotSchema>;

export const flowSubmitCaptureSchema = z.strictObject({
  id: idSchema('self'),
  nonce: selfieCaptureNonceSchema,
  device: selfieDeviceSnapshotSchema.optional(),
});

/**
 * `POST /api/v1/flow/verifications/:id/submit` body (C40.4, C52.6). A selfie names its capture, a
 * crypto wallet its signed challenge (C57.3), a government ID NFC verification its chip challenge
 * (C62.5); the other types send none (an empty object, or no body). At most one member.
 */
export const flowSubmitVerificationBodySchema = z
  .strictObject({
    capture: flowSubmitCaptureSchema.optional(),
    crypto: flowCryptoSubmitSchema.optional(),
    chip: flowChipSubmitSchema.optional(),
  })
  .refine(
    (body) =>
      [body.capture, body.crypto, body.chip].filter((part) => part !== undefined).length <= 1,
    'a submit carries at most one of capture, crypto and chip',
  );
export type FlowSubmitVerificationBody = z.infer<typeof flowSubmitVerificationBodySchema>;

/** C40 problem `code`s the flow API answers with (409 unless stated). */
export const SELFIE_CAPTURE_PROBLEM_CODES = [
  /** The 11th create; the verification was canceled. */
  'selfie_capture_limit',
  /** Submit without a file for every prompt. */
  'selfie_capture_incomplete',
  /** A wrong nonce, a foreign, superseded, expired or consumed capture: one body for all. */
  'selfie_capture_invalid',
  /** A selfie verification created after Phase 4 submitted without a capture (C40.7). */
  'selfie_capture_required',
] as const;
export const selfieCaptureProblemCodeSchema = z.enum(SELFIE_CAPTURE_PROBLEM_CODES);

// Environment settings (C42.4, C42.6) -----------------------------------------------------------

/** C42.6: template and background rows older than this are deleted by the retention pass. */
export const FACE_TEMPLATE_RETENTION_DAYS = Object.freeze({ min: 1, max: 1095, default: 365 });
export const faceTemplateRetentionDaysSchema = z
  .int()
  .min(FACE_TEMPLATE_RETENTION_DAYS.min)
  .max(FACE_TEMPLATE_RETENTION_DAYS.max);

/** C42.4: the most templates one repeat search decrypts and scores, newest first. */
export const FACE_SEARCH_MAX_TEMPLATES = Object.freeze({
  min: 1000,
  max: 200_000,
  default: 50_000,
});
export const faceSearchMaxTemplatesSchema = z
  .int()
  .min(FACE_SEARCH_MAX_TEMPLATES.min)
  .max(FACE_SEARCH_MAX_TEMPLATES.max);

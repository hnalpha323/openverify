/**
 * The checks the default Phase 1 template enables and requires (contract C7), and the reason
 * codes they report. The codes are what the hosted flow and Android translate into retry
 * hints, so producers (the API worker) and consumers (the clients) share this list. Clients
 * must fall back to a generic message for a code they do not know.
 */
import type { CheckId } from '@openverify/core';

/** The verification types Phase 1 ran. */
type Phase1VerificationType = 'government_id' | 'selfie';

export const PHASE1_CHECKS = Object.freeze({
  government_id: Object.freeze([
    'id_blur_detection',
    'id_glare_detection',
    'id_portrait_detection',
    'id_double_side_detection',
  ] as const),
  selfie: Object.freeze([
    'selfie_image_quality_detection',
    'selfie_multiple_faces_detection',
    'selfie_id_comparison',
  ] as const),
} as const satisfies Record<Phase1VerificationType, readonly CheckId[]>);

export type Phase1CheckId = (typeof PHASE1_CHECKS)[Phase1VerificationType][number];

/**
 * Reason of a check that could not run because the vision service could not read an
 * uploaded image (not a supported image, corrupt, or too many pixels). The image quality
 * checks fail with it, so the user is asked for a new photo; every other enabled check stays
 * `pending` with it. No check passes on an image that was never read.
 */
export const IMAGE_UNREADABLE_REASON = 'image_unreadable';

/** Reason codes each Phase 1 check reports when it fails. */
export const PHASE1_CHECK_REASONS = Object.freeze({
  id_blur_detection: ['image_blurry', IMAGE_UNREADABLE_REASON],
  id_glare_detection: ['glare_present', IMAGE_UNREADABLE_REASON],
  id_portrait_detection: ['portrait_not_present'],
  id_double_side_detection: ['front_not_present', 'back_not_present'],
  selfie_image_quality_detection: [
    'image_blurry',
    'image_too_dark',
    'image_too_bright',
    'face_not_present',
    IMAGE_UNREADABLE_REASON,
  ],
  selfie_multiple_faces_detection: ['multiple_faces_present'],
  selfie_id_comparison: ['face_mismatch', 'selfie_face_not_present', 'id_portrait_not_present'],
} as const satisfies Record<Phase1CheckId, readonly string[]>);

/**
 * Reason of a `pending` result for an enabled check that has no implementation yet (C7).
 * Results are never fabricated: when the check is required, the decision engine sends the
 * verification to review (C30.1).
 */
export const NOT_IMPLEMENTED_REASON = 'not_implemented';

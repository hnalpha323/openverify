/**
 * The reason codes every selfie check (PLAN §4.2) may emit (C39.2), the successor of
 * `PHASE1_CHECK_REASONS.selfie*`, which stays a subset. `apps/api/src/jobs/selfie-contract.test.ts`
 * asserts that every evaluator emits only listed reasons, and that a `not_applicable` result
 * always carries one.
 *
 * Workflow 4A Stage 1 wrote the C39.2 table; `checks-logic` owns this file from Stage 2. The
 * user-behaviour reasons are frozen (the clients translate them into retry hints, through
 * `contracts/fixtures/flow/retry-hint-reasons.json`); Stage 2 may add fraud reasons only, each
 * recorded as a plan amendment. Reasons are codes, never prose.
 *
 * | Reason | Status | Blocks a required check? |
 * |---|---|---|
 * | `not_requested` | `not_applicable` | no: the flow did not ask for the input (a centre-only step) |
 * | `input_missing` | `not_applicable` | yes (review): no face, no landmarks, no region, no file |
 * | `no_reference_data` | `not_applicable` | yes (review): nothing to compare with |
 * | `execution_error` | `not_applicable` | yes (review): the check could not run after retries |
 * | `provider_not_configured` | `not_applicable` | yes (review): no provider here (ADR 0002 §3e) |
 * | `not_consented` | `not_applicable` | yes (review): no matching consent (C42.3) |
 * | `image_unreadable` | `failed` | (failed), unchanged from Phase 1 |
 *
 * `selfie_face_not_present` and `id_portrait_not_present` are legacy: rows stored by Phase 1-3
 * carry them, but Phase 4 evaluators no longer emit them.
 */
import type { CheckId } from '@openverify/core';
import {
  EXECUTION_ERROR_REASON,
  INPUT_MISSING_REASON,
  NOT_REQUESTED_REASON,
  NO_REFERENCE_DATA_REASON,
  PROVIDER_NOT_CONFIGURED_REASON,
} from './government-id-check-reasons.js';
import { IMAGE_UNREADABLE_REASON, PHASE1_CHECK_REASONS } from './phase1-checks.js';

/** C39.2: the check needs the user's matching consent (C42.3), which the user did not give. */
export const NOT_CONSENTED_REASON = 'not_consented';

/** Every check of PLAN §4.2, in its order. */
export const SELFIE_CHECK_IDS = Object.freeze([
  'selfie_image_quality_detection',
  'selfie_glare_detection',
  'selfie_pose_detection',
  'selfie_multiple_faces_detection',
  'selfie_liveness_detection',
  'selfie_pose_repeat_detection',
  'selfie_id_comparison',
  'selfie_account_comparison',
  'selfie_repeat_detection',
  'selfie_similar_background_detection',
  'selfie_face_covering_detection',
  'selfie_glasses_detection',
  'selfie_age_comparison',
  'selfie_public_figure_detection',
  'selfie_suspicious_entity_detection',
] as const satisfies readonly CheckId[]);

export type SelfieCheckId = (typeof SELFIE_CHECK_IDS)[number];

/** The C29.4 shared reasons the selfie checks use, then the new `not_consented` (C39.2). */
export const SHARED_SELFIE_REASONS = Object.freeze([
  INPUT_MISSING_REASON,
  NO_REFERENCE_DATA_REASON,
  EXECUTION_ERROR_REASON,
  PROVIDER_NOT_CONFIGURED_REASON,
  NOT_REQUESTED_REASON,
  IMAGE_UNREADABLE_REASON,
  NOT_CONSENTED_REASON,
] as const);

/** Phase 1 reasons that stored rows carry, though Phase 4 evaluators no longer emit them. */
export const LEGACY_SELFIE_REASONS = Object.freeze([
  'selfie_face_not_present',
  'id_portrait_not_present',
] as const);

// Building blocks, by the evidence a check needs (registry `inputs`, C29.1).
/** Every check whose evidence comes from vision: no face, landmarks or region; or a failure. */
const VISION = [INPUT_MISSING_REASON, EXECUTION_ERROR_REASON, IMAGE_UNREADABLE_REASON] as const;
/** Checks needing a provider (A-tier, C44). */
const PROVIDER = [EXECUTION_ERROR_REASON, PROVIDER_NOT_CONFIGURED_REASON] as const;
/** The matching checks: consent first (C42.3). */
const MATCHING = [NOT_CONSENTED_REASON] as const;

function reasons(...groups: readonly (readonly string[])[]): readonly string[] {
  return Object.freeze([...new Set(groups.flat())]);
}

/** For every §4.2 check, the reason codes it may emit: the shared ones, then its own. */
export const SELFIE_CHECK_REASONS: Readonly<Record<SelfieCheckId, readonly string[]>> =
  Object.freeze({
    selfie_image_quality_detection: reasons(
      VISION,
      PHASE1_CHECK_REASONS.selfie_image_quality_detection,
      ['face_too_small', 'resolution_too_low'],
    ),
    selfie_glare_detection: reasons(VISION, ['face_glare']),
    selfie_pose_detection: reasons(VISION, ['pose_not_center', 'pose_not_left', 'pose_not_right']),
    selfie_multiple_faces_detection: reasons(
      VISION,
      PHASE1_CHECK_REASONS.selfie_multiple_faces_detection,
    ),
    selfie_liveness_detection: reasons(VISION, [
      'passive_liveness_low',
      'pose_identity_mismatch',
      'automated_capture',
      'capture_replayed',
      // not_applicable: no live capture, or a device on the virtual-camera list (review).
      'capture_not_live',
      'capture_device_suspicious',
    ]),
    selfie_pose_repeat_detection: reasons(VISION, [
      NOT_REQUESTED_REASON,
      'planar_motion',
      'pose_frames_identical',
      'duplicate_frame',
    ]),
    selfie_id_comparison: reasons(
      VISION,
      [NO_REFERENCE_DATA_REASON],
      PHASE1_CHECK_REASONS.selfie_id_comparison,
    ),
    selfie_account_comparison: reasons(
      VISION,
      MATCHING,
      [NO_REFERENCE_DATA_REASON],
      ['face_mismatch'],
    ),
    selfie_repeat_detection: reasons(VISION, MATCHING, ['face_seen_on_other_account']),
    selfie_similar_background_detection: reasons(VISION, MATCHING, [
      'background_seen_with_other_faces',
    ]),
    selfie_face_covering_detection: reasons(VISION, ['face_covered']),
    selfie_glasses_detection: reasons(VISION, ['glasses_detected']),
    selfie_age_comparison: reasons(
      VISION,
      PROVIDER,
      [NO_REFERENCE_DATA_REASON],
      ['age_outside_limits', 'age_inconsistent_with_birthdate'],
    ),
    selfie_public_figure_detection: reasons(VISION, PROVIDER, ['public_figure_match']),
    selfie_suspicious_entity_detection: reasons(VISION, PROVIDER, [
      'synthetic_face_suspected',
      'provenance_marks_synthetic',
      'provider_flagged',
    ]),
  });

/**
 * The reasons each §4.2 selfie evaluator of `packages/checks` may emit (C39.2, C43).
 * `SELFIE_CHECK_REASONS` in `@openverify/contracts` lists these and the shared reasons the worker
 * adds (`execution_error`, `image_unreadable`); `apps/api/src/jobs/selfie-contract.test.ts` asserts
 * the two agree. No evaluator emits the legacy Phase 1 reasons (`selfie_face_not_present`,
 * `id_portrait_not_present`) or `not_implemented` any more.
 */
const frozen = (...reasons: string[]): readonly string[] => Object.freeze(reasons);

const MATCHING = ['not_consented', 'input_missing', 'execution_error'];
const PROVIDER = ['provider_not_configured', 'execution_error', 'input_missing'];

export const SELFIE_EVALUATOR_REASONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  selfie_image_quality_detection: frozen(
    'face_not_present',
    'image_blurry',
    'image_too_dark',
    'image_too_bright',
    'face_too_small',
    'resolution_too_low',
    'input_missing',
  ),
  selfie_glare_detection: frozen('face_glare', 'input_missing'),
  selfie_pose_detection: frozen(
    'pose_not_center',
    'pose_not_left',
    'pose_not_right',
    'input_missing',
  ),
  selfie_multiple_faces_detection: frozen('multiple_faces_present', 'input_missing'),
  selfie_liveness_detection: frozen(
    'passive_liveness_low',
    'pose_identity_mismatch',
    'automated_capture',
    'capture_replayed',
    'capture_not_live',
    'capture_device_suspicious',
    'input_missing',
  ),
  selfie_pose_repeat_detection: frozen(
    'planar_motion',
    'pose_frames_identical',
    'duplicate_frame',
    'not_requested',
    'input_missing',
  ),
  selfie_id_comparison: frozen(
    'face_mismatch',
    'no_reference_data',
    'input_missing',
    'execution_error',
  ),
  selfie_account_comparison: frozen('face_mismatch', 'no_reference_data', ...MATCHING),
  selfie_repeat_detection: frozen('face_seen_on_other_account', ...MATCHING),
  selfie_similar_background_detection: frozen('background_seen_with_other_faces', ...MATCHING),
  selfie_face_covering_detection: frozen('face_covered', 'input_missing'),
  selfie_glasses_detection: frozen('glasses_detected', 'input_missing'),
  selfie_age_comparison: frozen(
    'age_outside_limits',
    'age_inconsistent_with_birthdate',
    'no_reference_data',
    ...PROVIDER,
  ),
  selfie_public_figure_detection: frozen('public_figure_match', ...PROVIDER),
  selfie_suspicious_entity_detection: frozen(
    'synthetic_face_suspected',
    'provenance_marks_synthetic',
    'provider_flagged',
    'execution_error',
    'input_missing',
  ),
});

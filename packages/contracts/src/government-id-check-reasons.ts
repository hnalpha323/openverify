/**
 * The reason codes every government ID check (PLAN §4.1) may emit (C29.4), the successor of
 * `PHASE1_CHECK_REASONS`, which stays a subset. `apps/api/src/jobs/government-id-contract.test.ts`
 * asserts that every evaluator emits only listed reasons.
 *
 * Workflow 3A Stage 1 seeded each entry with the shared reasons below; `checks-logic` added each
 * check's own reasons, the ones its evaluator in `packages/checks` emits
 * (`GOVERNMENT_ID_EVALUATOR_REASONS` there). Reasons are codes, never prose, so clients translate
 * them and no PII can leak through them.
 *
 * | Reason | Status | Blocks a required check? |
 * |---|---|---|
 * | `feature_absent` | `not_applicable` | no: the established class has no such feature (C30.2) |
 * | `not_requested` | `not_applicable` | no: the flow did not ask for the input |
 * | `input_missing` | `not_applicable` | yes (review): an input or the class could not be obtained |
 * | `no_reference_data` | `not_applicable` | yes (review): nothing to compare with |
 * | `execution_error` | `not_applicable` | yes (review): the check could not run after retries |
 * | `provider_not_configured` | `not_applicable` | yes (review): no provider here (ADR 0002 §3e) |
 * | `image_unreadable` | `failed` | (failed), unchanged from Phase 1 |
 */
import { NON_BLOCKING_NOT_APPLICABLE_REASONS, type CheckId } from '@openverify/core';
import { IMAGE_UNREADABLE_REASON, PHASE1_CHECK_REASONS } from './phase1-checks.js';

export const FEATURE_ABSENT_REASON = 'feature_absent';
export const NOT_REQUESTED_REASON = 'not_requested';
export const INPUT_MISSING_REASON = 'input_missing';
export const NO_REFERENCE_DATA_REASON = 'no_reference_data';
export const EXECUTION_ERROR_REASON = 'execution_error';
export const PROVIDER_NOT_CONFIGURED_REASON = 'provider_not_configured';
/**
 * C59.4 (a C35 amendment): the licence's jurisdiction does not take part in DLDV, so the AAMVA
 * lookup is `not_applicable` (blocking: review).
 */
export const AAMVA_JURISDICTION_NOT_PARTICIPATING_REASON = 'aamva_jurisdiction_not_participating';

/** The shared reasons of the C29.4 table, in its order. */
export const SHARED_GOVERNMENT_ID_REASONS = Object.freeze([
  FEATURE_ABSENT_REASON,
  NOT_REQUESTED_REASON,
  INPUT_MISSING_REASON,
  NO_REFERENCE_DATA_REASON,
  EXECUTION_ERROR_REASON,
  PROVIDER_NOT_CONFIGURED_REASON,
  IMAGE_UNREADABLE_REASON,
] as const);

/**
 * The reasons that let a required check be `not_applicable` without sending the verification to
 * review (C30.2): the decision engine's `NON_BLOCKING_NOT_APPLICABLE_REASONS`.
 */
export const NON_BLOCKING_REASONS = NON_BLOCKING_NOT_APPLICABLE_REASONS;

/**
 * Every government ID check of PLAN §4.1. `id_nfc_expired_detection`, a §4.1 row that runs on
 * chip data, moved to `nfc-check-reasons.ts` in Phase 5 (C51.2).
 */
export const GOVERNMENT_ID_CHECK_IDS = Object.freeze([
  'id_unprocessable_submission_detection',
  'id_blur_detection',
  'id_glare_detection',
  'id_double_side_detection',
  'id_portrait_detection',
  'id_portrait_clarity_detection',
  'id_mrz_detection',
  'id_mrz_inconsistency_detection',
  'id_barcode_detection',
  'id_barcode_inconsistency_detection',
  'id_extracted_properties_detection',
  'id_extraction_inconsistency_detection',
  'id_number_format_inconsistency_detection',
  'id_expired_detection',
  'id_valid_dates_detection',
  'id_age_comparison',
  'id_age_inconsistency_detection',
  'id_disallowed_country_detection',
  'id_disallowed_type_detection',
  'id_po_box_detection',
  'id_real_id_detection',
  'id_color_inconsistency_detection',
  'id_electronic_replica_detection',
  'id_tamper_detection',
  'id_fabrication_detection',
  'id_handwriting_detection',
  'id_compromised_detection',
  'id_entity_detection',
  'id_repeat_detection',
  'id_inconsistent_repeat_detection',
  'id_account_comparison',
  'id_inquiry_comparison',
  'id_selfie_comparison',
  'id_public_figure_detection',
  'id_aamva_database_lookup',
] as const satisfies readonly CheckId[]);

export type GovernmentIdCheckId = (typeof GOVERNMENT_ID_CHECK_IDS)[number];

// Building blocks of the seed lists, by the evidence a check needs (registry `inputs`, C29.1).
/** Every check: an input it needs could not be obtained, or the class not established. */
const ANY = [INPUT_MISSING_REASON] as const;
/** Checks reading a vision measurement: vision could not read the image, or failed for good. */
const VISION = [EXECUTION_ERROR_REASON, IMAGE_UNREADABLE_REASON] as const;
/** Checks needing a provider (A-tier, C35). */
const PROVIDER = [EXECUTION_ERROR_REASON, PROVIDER_NOT_CONFIGURED_REASON] as const;
/** Checks the C33 feature table decides for, and whose feature may sit on an unrequested back. */
const FEATURE = [FEATURE_ABSENT_REASON, NOT_REQUESTED_REASON] as const;

function reasons(...groups: readonly (readonly string[])[]): readonly string[] {
  return Object.freeze([...new Set(groups.flat())]);
}

const MRZ_CHECK_DIGITS = [
  'document_number_check_digit_invalid',
  'birth_date_check_digit_invalid',
  'expiration_date_check_digit_invalid',
  'optional_data_check_digit_invalid',
  'composite_check_digit_invalid',
] as const;
const MRZ_FORMAT = [
  'mrz_document_code_invalid',
  'mrz_issuing_state_invalid',
  'mrz_nationality_invalid',
  'mrz_birth_date_invalid',
  'mrz_expiration_date_invalid',
  'mrz_sex_invalid',
  'mrz_name_invalid',
] as const;
const MRZ_MISMATCHES = [
  'document_number_mismatch',
  'surname_mismatch',
  'given_names_mismatch',
  'birth_date_mismatch',
  'expiration_date_mismatch',
  'sex_mismatch',
  'nationality_mismatch',
  'issuing_state_mismatch',
] as const;
const AAMVA = [
  'aamva_header_invalid',
  'aamva_subfile_designator_invalid',
  'aamva_mandatory_element_missing',
  'aamva_date_invalid',
  'aamva_iin_unknown',
  'aamva_version_unsupported',
  'aamva_document_subfile_missing',
  'aamva_header_nonstandard',
  'aamva_designator_offset_mismatch',
] as const;
const COMPARISON = [
  'name_mismatch',
  'birthdate_mismatch',
  'address_mismatch',
  'identification_number_mismatch',
] as const;
const EXPIRY = ['expired', 'expired_within_grace_period', 'expiration_date_invalid'] as const;

/** For every §4.1 check, the reason codes it may emit: the shared ones, then its own. */
export const GOVERNMENT_ID_CHECK_REASONS: Readonly<Record<GovernmentIdCheckId, readonly string[]>> =
  Object.freeze({
    id_unprocessable_submission_detection: reasons(ANY, VISION, [
      'document_not_found',
      'insufficient_text',
      'identity_features_not_found',
    ]),
    id_blur_detection: reasons(PHASE1_CHECK_REASONS.id_blur_detection, ANY, VISION, [
      'resolution_too_low',
    ]),
    id_glare_detection: reasons(PHASE1_CHECK_REASONS.id_glare_detection, ANY, VISION),
    id_double_side_detection: reasons(
      PHASE1_CHECK_REASONS.id_double_side_detection,
      ANY,
      VISION,
      FEATURE,
      ['back_feature_not_found'],
    ),
    id_portrait_detection: reasons(PHASE1_CHECK_REASONS.id_portrait_detection, ANY, VISION),
    id_portrait_clarity_detection: reasons(ANY, VISION, [
      'portrait_too_small',
      'portrait_blurry',
      'portrait_obstructed',
    ]),
    id_mrz_detection: reasons(ANY, VISION, FEATURE, ['mrz_unreadable', 'mrz_not_found']),
    id_mrz_inconsistency_detection: reasons(
      ANY,
      FEATURE,
      MRZ_CHECK_DIGITS,
      MRZ_FORMAT,
      MRZ_MISMATCHES,
    ),
    id_barcode_detection: reasons(ANY, VISION, FEATURE, ['barcode_not_found']),
    id_barcode_inconsistency_detection: reasons(ANY, FEATURE, AAMVA, ['barcode_viz_mismatch']),
    id_extracted_properties_detection: reasons(ANY, ['required_fields_missing']),
    id_extraction_inconsistency_detection: reasons(ANY, ['extraction_inconsistent']),
    id_number_format_inconsistency_detection: reasons(ANY, ['number_format_invalid']),
    // An established class without an expiry date in the feature table (C29.6).
    id_expired_detection: reasons(ANY, [FEATURE_ABSENT_REASON], EXPIRY),
    id_valid_dates_detection: reasons(ANY, [
      'birth_date_invalid',
      'issue_date_invalid',
      'expiration_date_invalid',
      'birth_date_in_future',
      'issue_date_in_future',
      'birth_date_not_before_issue_date',
      'issue_date_not_before_expiration_date',
      'birth_date_not_before_expiration_date',
      'age_exceeds_maximum',
      'validity_period_too_long',
    ]),
    id_age_comparison: reasons(ANY, [
      'below_minimum_age',
      'above_maximum_age',
      'birth_date_invalid',
      'birth_date_in_future',
      'age_limits_not_configured',
    ]),
    id_age_inconsistency_detection: reasons(ANY, VISION, PROVIDER, ['apparent_age_inconsistent']),
    id_disallowed_country_detection: reasons(ANY, [
      'issuing_country_not_allowed',
      'issuing_country_disallowed',
    ]),
    id_disallowed_type_detection: reasons(ANY, ['id_class_not_allowed', 'id_class_disallowed']),
    id_po_box_detection: reasons(ANY, ['po_box_detected']),
    id_real_id_detection: reasons(ANY, VISION, FEATURE, [
      'real_id_not_compliant',
      'real_id_marker_inconsistent',
    ]),
    id_color_inconsistency_detection: reasons(ANY, VISION, [
      'grayscale_image',
      'color_cast_detected',
    ]),
    id_electronic_replica_detection: reasons(ANY, VISION, ['screen_recapture_suspected']),
    id_tamper_detection: reasons(ANY, VISION, [
      'editing_software_detected',
      'error_level_anomaly',
      'double_compression_detected',
      'copy_move_detected',
      'portrait_boundary_anomaly',
    ]),
    id_fabrication_detection: reasons(ANY, VISION, ['layout_nonconformant']),
    id_handwriting_detection: reasons(ANY, VISION, ['handwriting_suspected']),
    id_compromised_detection: reasons(ANY, VISION, [
      'specimen_marker_found',
      'specimen_document_number',
      'specimen_issuer',
      'synthetic_test_data',
      'compromised_list_match',
      'compromised_list_unavailable',
    ]),
    id_entity_detection: reasons(ANY, VISION, ['entity_risk_high']),
    id_repeat_detection: reasons(ANY, ['id_repeat_detected']),
    id_inconsistent_repeat_detection: reasons(ANY, VISION, ['inconsistent_repeat_detected']),
    id_account_comparison: reasons(ANY, [NO_REFERENCE_DATA_REASON], COMPARISON),
    id_inquiry_comparison: reasons(ANY, [NO_REFERENCE_DATA_REASON], COMPARISON),
    id_selfie_comparison: reasons(ANY, VISION, ['face_mismatch']),
    id_public_figure_detection: reasons(
      ANY,
      VISION,
      PROVIDER,
      [NO_REFERENCE_DATA_REASON],
      ['public_figure_match'],
    ),
    // An established document that is not a US licence has no AAMVA record to look up.
    id_aamva_database_lookup: reasons(
      ANY,
      PROVIDER,
      [FEATURE_ABSENT_REASON],
      ['aamva_record_mismatch', 'aamva_record_not_found'],
      [AAMVA_JURISDICTION_NOT_PARTICIPATING_REASON],
    ),
  });

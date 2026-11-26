/**
 * The reasons each government ID evaluator of `packages/checks` may emit (C29.4), the NFC expiry
 * included. `GOVERNMENT_ID_CHECK_REASONS` in `@openverify/contracts` lists these and the shared
 * reasons the worker adds (`execution_error`, `image_unreadable`, `input_missing`), and
 * `apps/api/src/jobs/government-id-contract.test.ts` asserts the two agree.
 */
const frozen = (...reasons: string[]): readonly string[] => Object.freeze(reasons);

const MRZ_CHECK_DIGITS = [
  'document_number',
  'birth_date',
  'expiration_date',
  'optional_data',
  'composite',
].map((field) => `${field}_check_digit_invalid`);
const MRZ_FORMAT = [
  'document_code',
  'issuing_state',
  'nationality',
  'birth_date',
  'expiration_date',
  'sex',
  'name',
].map((issue) => `mrz_${issue}_invalid`);
const MRZ_MISMATCHES = [
  'document_number',
  'surname',
  'given_names',
  'birth_date',
  'expiration_date',
  'sex',
  'nationality',
  'issuing_state',
].map((field) => `${field}_mismatch`);
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
];
const COMPARISON = [
  'name_mismatch',
  'birthdate_mismatch',
  'address_mismatch',
  'identification_number_mismatch',
  'no_reference_data',
  'input_missing',
];
const EXPIRY = ['expired', 'expired_within_grace_period', 'expiration_date_invalid'];

export const GOVERNMENT_ID_EVALUATOR_REASONS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    id_unprocessable_submission_detection: frozen(
      'document_not_found',
      'insufficient_text',
      'identity_features_not_found',
      'input_missing',
    ),
    id_blur_detection: frozen('image_blurry', 'resolution_too_low'),
    id_glare_detection: frozen('glare_present'),
    id_double_side_detection: frozen(
      'front_not_present',
      'back_not_present',
      'back_feature_not_found',
      'not_requested',
      'feature_absent',
    ),
    id_portrait_detection: frozen('portrait_not_present'),
    id_portrait_clarity_detection: frozen(
      'portrait_too_small',
      'portrait_blurry',
      'portrait_obstructed',
      'input_missing',
    ),
    id_mrz_detection: frozen(
      'mrz_unreadable',
      'mrz_not_found',
      'feature_absent',
      'not_requested',
      'input_missing',
    ),
    id_mrz_inconsistency_detection: frozen(
      ...MRZ_CHECK_DIGITS,
      ...MRZ_FORMAT,
      ...MRZ_MISMATCHES,
      'feature_absent',
      'not_requested',
      'input_missing',
    ),
    id_barcode_detection: frozen(
      'barcode_not_found',
      'feature_absent',
      'not_requested',
      'input_missing',
    ),
    id_barcode_inconsistency_detection: frozen(
      ...AAMVA,
      'barcode_viz_mismatch',
      'feature_absent',
      'not_requested',
      'input_missing',
    ),
    id_extracted_properties_detection: frozen('required_fields_missing', 'input_missing'),
    id_extraction_inconsistency_detection: frozen('extraction_inconsistent', 'input_missing'),
    id_number_format_inconsistency_detection: frozen('number_format_invalid', 'input_missing'),
    id_expired_detection: frozen(...EXPIRY, 'feature_absent', 'input_missing'),
    id_valid_dates_detection: frozen(
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
      'input_missing',
    ),
    id_age_comparison: frozen(
      'below_minimum_age',
      'above_maximum_age',
      'birth_date_invalid',
      'birth_date_in_future',
      'age_limits_not_configured',
      'input_missing',
    ),
    id_age_inconsistency_detection: frozen(
      'apparent_age_inconsistent',
      'provider_not_configured',
      'execution_error',
      'input_missing',
    ),
    id_disallowed_country_detection: frozen(
      'issuing_country_not_allowed',
      'issuing_country_disallowed',
      'input_missing',
    ),
    id_disallowed_type_detection: frozen(
      'id_class_not_allowed',
      'id_class_disallowed',
      'input_missing',
    ),
    id_po_box_detection: frozen('po_box_detected', 'input_missing'),
    id_real_id_detection: frozen(
      'real_id_not_compliant',
      'real_id_marker_inconsistent',
      'feature_absent',
      'input_missing',
    ),
    id_color_inconsistency_detection: frozen(
      'grayscale_image',
      'color_cast_detected',
      'input_missing',
    ),
    id_electronic_replica_detection: frozen('screen_recapture_suspected', 'input_missing'),
    id_tamper_detection: frozen(
      'editing_software_detected',
      'error_level_anomaly',
      'double_compression_detected',
      'copy_move_detected',
      'portrait_boundary_anomaly',
      'input_missing',
    ),
    id_fabrication_detection: frozen('layout_nonconformant', 'input_missing'),
    id_handwriting_detection: frozen('handwriting_suspected', 'input_missing'),
    id_compromised_detection: frozen(
      'specimen_marker_found',
      'specimen_document_number',
      'specimen_issuer',
      'synthetic_test_data',
      'compromised_list_match',
      'compromised_list_unavailable',
      'input_missing',
    ),
    id_entity_detection: frozen('entity_risk_high', 'input_missing'),
    id_repeat_detection: frozen('id_repeat_detected', 'input_missing'),
    id_inconsistent_repeat_detection: frozen('inconsistent_repeat_detected', 'input_missing'),
    id_account_comparison: frozen(...COMPARISON),
    id_inquiry_comparison: frozen(...COMPARISON),
    id_selfie_comparison: frozen('face_mismatch', 'input_missing'),
    id_public_figure_detection: frozen(
      'public_figure_match',
      'provider_not_configured',
      'execution_error',
      'no_reference_data',
      'input_missing',
    ),
    id_aamva_database_lookup: frozen(
      'aamva_record_mismatch',
      'aamva_record_not_found',
      'aamva_jurisdiction_not_participating',
      'feature_absent',
      'provider_not_configured',
      'execution_error',
      'input_missing',
    ),
    id_nfc_expired_detection: frozen(...EXPIRY, 'input_missing'),
  });

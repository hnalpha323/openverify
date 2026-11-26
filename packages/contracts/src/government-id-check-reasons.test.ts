import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  NON_BLOCKING_NOT_APPLICABLE_REASONS,
  getCheckDefinition,
  reasonCodeSchema,
} from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  EXECUTION_ERROR_REASON,
  FEATURE_ABSENT_REASON,
  GOVERNMENT_ID_CHECK_IDS,
  GOVERNMENT_ID_CHECK_REASONS,
  INPUT_MISSING_REASON,
  NON_BLOCKING_REASONS,
  NOT_REQUESTED_REASON,
  NO_REFERENCE_DATA_REASON,
  PROVIDER_NOT_CONFIGURED_REASON,
  SHARED_GOVERNMENT_ID_REASONS,
} from './government-id-check-reasons.js';
import { IMAGE_UNREADABLE_REASON, PHASE1_CHECK_REASONS } from './phase1-checks.js';

/** The §4.1 check ids, read from PLAN.md. */
function planGovernmentIdChecks(): string[] {
  const plan = readFileSync(path.resolve(import.meta.dirname, '../../../docs/PLAN.md'), 'utf8');
  const start = plan.indexOf('### 4.1 Government ID');
  const section = plan.slice(start, plan.indexOf('### 4.2', start));
  return section
    .split('\n')
    .filter((line) => /^\| id_[a-z0-9_]+ \|/.test(line))
    .map((line) => /id_[a-z0-9_]+/.exec(line)?.[0] ?? '');
}

/** The checks C33's feature table decides for: MRZ, PDF417 and expiry, and the back they sit on. */
const FEATURE_CHECKS = [
  'id_double_side_detection',
  'id_mrz_detection',
  'id_mrz_inconsistency_detection',
  'id_barcode_detection',
  'id_barcode_inconsistency_detection',
  'id_real_id_detection',
];

/** The reasons each check's own evaluator emits beyond the shared ones (packages/checks). */
const CHECK_SPECIFIC: Readonly<Record<string, readonly string[]>> = {
  id_unprocessable_submission_detection: [
    'document_not_found',
    'insufficient_text',
    'identity_features_not_found',
  ],
  id_blur_detection: ['image_blurry', 'resolution_too_low'],
  id_glare_detection: ['glare_present'],
  id_double_side_detection: ['front_not_present', 'back_not_present', 'back_feature_not_found'],
  id_portrait_detection: ['portrait_not_present'],
  id_portrait_clarity_detection: ['portrait_too_small', 'portrait_blurry', 'portrait_obstructed'],
  id_mrz_detection: ['mrz_unreadable', 'mrz_not_found'],
  id_mrz_inconsistency_detection: [
    'document_number_check_digit_invalid',
    'birth_date_check_digit_invalid',
    'expiration_date_check_digit_invalid',
    'optional_data_check_digit_invalid',
    'composite_check_digit_invalid',
    'mrz_document_code_invalid',
    'mrz_issuing_state_invalid',
    'mrz_nationality_invalid',
    'mrz_birth_date_invalid',
    'mrz_expiration_date_invalid',
    'mrz_sex_invalid',
    'mrz_name_invalid',
    'document_number_mismatch',
    'surname_mismatch',
    'given_names_mismatch',
    'birth_date_mismatch',
    'expiration_date_mismatch',
    'sex_mismatch',
    'nationality_mismatch',
    'issuing_state_mismatch',
  ],
  id_barcode_detection: ['barcode_not_found'],
  id_barcode_inconsistency_detection: [
    'aamva_header_invalid',
    'aamva_subfile_designator_invalid',
    'aamva_mandatory_element_missing',
    'aamva_date_invalid',
    'aamva_iin_unknown',
    'aamva_version_unsupported',
    'aamva_document_subfile_missing',
    'aamva_header_nonstandard',
    'aamva_designator_offset_mismatch',
    'barcode_viz_mismatch',
  ],
  id_extracted_properties_detection: ['required_fields_missing'],
  id_extraction_inconsistency_detection: ['extraction_inconsistent'],
  id_number_format_inconsistency_detection: ['number_format_invalid'],
  id_expired_detection: ['expired', 'expired_within_grace_period', 'expiration_date_invalid'],
  id_valid_dates_detection: [
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
  ],
  id_age_comparison: [
    'below_minimum_age',
    'above_maximum_age',
    'birth_date_invalid',
    'birth_date_in_future',
    'age_limits_not_configured',
  ],
  id_age_inconsistency_detection: ['apparent_age_inconsistent'],
  id_disallowed_country_detection: ['issuing_country_not_allowed', 'issuing_country_disallowed'],
  id_disallowed_type_detection: ['id_class_not_allowed', 'id_class_disallowed'],
  id_po_box_detection: ['po_box_detected'],
  id_real_id_detection: ['real_id_not_compliant', 'real_id_marker_inconsistent'],
  id_color_inconsistency_detection: ['grayscale_image', 'color_cast_detected'],
  id_electronic_replica_detection: ['screen_recapture_suspected'],
  id_tamper_detection: [
    'editing_software_detected',
    'error_level_anomaly',
    'double_compression_detected',
    'copy_move_detected',
    'portrait_boundary_anomaly',
  ],
  id_fabrication_detection: ['layout_nonconformant'],
  id_handwriting_detection: ['handwriting_suspected'],
  id_compromised_detection: [
    'specimen_marker_found',
    'specimen_document_number',
    'specimen_issuer',
    'synthetic_test_data',
    'compromised_list_match',
  ],
  id_entity_detection: ['entity_risk_high'],
  id_repeat_detection: ['id_repeat_detected'],
  id_inconsistent_repeat_detection: ['inconsistent_repeat_detected'],
  id_account_comparison: [
    'name_mismatch',
    'birthdate_mismatch',
    'address_mismatch',
    'identification_number_mismatch',
  ],
  id_inquiry_comparison: [
    'name_mismatch',
    'birthdate_mismatch',
    'address_mismatch',
    'identification_number_mismatch',
  ],
  id_selfie_comparison: ['face_mismatch'],
  id_public_figure_detection: ['public_figure_match'],
  id_aamva_database_lookup: [
    'aamva_record_mismatch',
    'aamva_record_not_found',
    // C59.4 (a C35 amendment).
    'aamva_jurisdiction_not_participating',
  ],
};

const reasonsOf = (id: string): readonly string[] =>
  (GOVERNMENT_ID_CHECK_REASONS as Readonly<Record<string, readonly string[]>>)[id] ?? [];

describe('the shared government ID reasons (C29.4)', () => {
  it('are the seven reasons of the C29.4 table', () => {
    expect(SHARED_GOVERNMENT_ID_REASONS).toEqual([
      FEATURE_ABSENT_REASON,
      NOT_REQUESTED_REASON,
      INPUT_MISSING_REASON,
      NO_REFERENCE_DATA_REASON,
      EXECUTION_ERROR_REASON,
      PROVIDER_NOT_CONFIGURED_REASON,
      IMAGE_UNREADABLE_REASON,
    ]);
    expect([...SHARED_GOVERNMENT_ID_REASONS]).toEqual([
      'feature_absent',
      'not_requested',
      'input_missing',
      'no_reference_data',
      'execution_error',
      'provider_not_configured',
      'image_unreadable',
    ]);
  });

  it('name the decision engine non-blocking ones: feature_absent and not_requested, and since Phase 5 no_allowlist and chip_auth_not_server_verifiable (C30.2 amendment)', () => {
    expect(NON_BLOCKING_REASONS).toEqual([
      'feature_absent',
      'not_requested',
      'no_allowlist',
      'chip_auth_not_server_verifiable',
    ]);
    expect(NON_BLOCKING_REASONS).toEqual(NON_BLOCKING_NOT_APPLICABLE_REASONS);
  });
});

describe('GOVERNMENT_ID_CHECK_REASONS (C29.4)', () => {
  it('lists every §4.1 check but the chip expiry, which moved to the NFC file (C51.2), and nothing else', () => {
    const plan = planGovernmentIdChecks();
    expect(plan).toHaveLength(36);
    const governmentId = plan.filter((id) => id !== 'id_nfc_expired_detection');
    expect([...GOVERNMENT_ID_CHECK_IDS].sort()).toEqual([...governmentId].sort());
    expect(Object.keys(GOVERNMENT_ID_CHECK_REASONS).sort()).toEqual([...governmentId].sort());
  });

  it('keeps every Phase 1 reason, so PHASE1_CHECK_REASONS stays a subset', () => {
    for (const [id, reasons] of Object.entries(PHASE1_CHECK_REASONS)) {
      if (id.startsWith('id_')) {
        expect(reasonsOf(id), id).toEqual(expect.arrayContaining([...reasons]));
      }
    }
  });

  it('lets every check answer input_missing', () => {
    for (const id of GOVERNMENT_ID_CHECK_IDS) {
      expect(reasonsOf(id), id).toContain('input_missing');
    }
  });

  it('gives execution_error and image_unreadable to the checks that need vision, and only them', () => {
    for (const id of GOVERNMENT_ID_CHECK_IDS) {
      const inputs = getCheckDefinition(id)?.inputs ?? [];
      const vision = inputs.includes('vision');
      const remote = vision || inputs.includes('provider');
      expect(reasonsOf(id).includes('execution_error'), id).toBe(remote);
      expect(reasonsOf(id).includes('image_unreadable'), id).toBe(vision);
    }
  });

  it('gives provider_not_configured to the checks that need a provider, and only them', () => {
    for (const id of GOVERNMENT_ID_CHECK_IDS) {
      const provider = getCheckDefinition(id)?.inputs.includes('provider') ?? false;
      expect(reasonsOf(id).includes('provider_not_configured'), id).toBe(provider);
    }
    expect(reasonsOf('id_aamva_database_lookup')).toContain('provider_not_configured');
  });

  it('gives feature_absent to the feature-table checks, expiry and the AAMVA lookup, not_requested to the back-side ones', () => {
    for (const id of GOVERNMENT_ID_CHECK_IDS) {
      expect(reasonsOf(id).includes('feature_absent'), id).toBe(
        FEATURE_CHECKS.includes(id) ||
          id === 'id_expired_detection' ||
          id === 'id_aamva_database_lookup',
      );
      expect(reasonsOf(id).includes('not_requested'), id).toBe(FEATURE_CHECKS.includes(id));
    }
  });

  it('gives no_reference_data to the comparisons with reference data', () => {
    for (const id of GOVERNMENT_ID_CHECK_IDS) {
      expect(reasonsOf(id).includes('no_reference_data'), id).toBe(
        ['id_account_comparison', 'id_inquiry_comparison', 'id_public_figure_detection'].includes(
          id,
        ),
      );
    }
  });

  it.each(Object.entries(CHECK_SPECIFIC))(
    'lists the reasons the %s evaluator emits (checks-logic)',
    (id, reasons) => {
      expect(reasonsOf(id)).toEqual(expect.arrayContaining([...reasons]));
    },
  );

  it('lists no tamper reason for signals that only add up: the strongest component decides', () => {
    expect(reasonsOf('id_tamper_detection')).not.toContain('tampering_suspected');
  });

  it('never lists not_implemented: every check has an evaluator from Phase 3', () => {
    for (const id of GOVERNMENT_ID_CHECK_IDS) {
      expect(reasonsOf(id), id).not.toContain('not_implemented');
    }
  });

  it('holds only snake_case reason codes, each once, and is frozen', () => {
    expect(Object.isFrozen(GOVERNMENT_ID_CHECK_REASONS)).toBe(true);
    for (const [id, reasons] of Object.entries(GOVERNMENT_ID_CHECK_REASONS)) {
      expect(Object.isFrozen(reasons), id).toBe(true);
      expect(new Set(reasons).size, id).toBe(reasons.length);
      for (const reason of reasons) {
        expect(reasonCodeSchema.safeParse(reason).success, `${id}: ${reason}`).toBe(true);
      }
    }
  });
});

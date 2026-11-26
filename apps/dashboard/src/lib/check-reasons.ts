/**
 * Check reason codes in words (C37). Reasons are codes, never prose (C29.4), so the console
 * says each one in short English words. A code the console does not know yet is shown as the
 * code itself (`check-results.tsx`), never as a crash.
 *
 * The test (`check-reasons.test.ts`) iterates every list the contracts publish
 * (`GOVERNMENT_ID_CHECK_REASONS`, `PHASE1_CHECK_REASONS`, `SHARED_GOVERNMENT_ID_REASONS`,
 * `SELFIE_CHECK_REASONS`, `SHARED_SELFIE_REASONS`, `LEGACY_SELFIE_REASONS`,
 * `NOT_IMPLEMENTED_REASON`) and fails for a code without words, or for words of a code no list
 * has. Fraud reasons are worded too: the console is for operators, never for the end user.
 * The Phase 5 types word their own checks' codes in `reason-words/<type>.ts` (C54.5).
 */
import { typeReasonText } from './reason-words';

/** How the console says one reason: short words, and a sentence where the words need one. */
export interface ReasonText {
  readonly words: string;
  readonly explanation?: string;
}

/** Every reason code the API can return for a check, in words. */
export const REASON_WORDS: Readonly<Record<string, string>> = Object.freeze({
  // Shared by every check (C29.4).
  feature_absent: 'Not on this kind of document',
  not_requested: 'Not asked for by the flow',
  input_missing: 'Input it needs is missing',
  no_reference_data: 'Nothing to compare with',
  execution_error: 'Could not run',
  provider_not_configured: 'Not configured',
  image_unreadable: 'Image unreadable',
  not_implemented: 'Not implemented yet',
  // Image and capture.
  document_not_found: 'No document found',
  insufficient_text: 'Too little text read',
  identity_features_not_found: 'No identity features found',
  image_blurry: 'Image blurry',
  resolution_too_low: 'Resolution too low',
  glare_present: 'Glare',
  front_not_present: 'Front missing',
  back_not_present: 'Back missing',
  back_feature_not_found: 'Expected feature missing on the back',
  portrait_not_present: 'No portrait',
  portrait_too_small: 'Portrait too small',
  portrait_blurry: 'Portrait blurry',
  portrait_obstructed: 'Portrait obstructed',
  // The machine-readable zone.
  mrz_unreadable: 'MRZ unreadable',
  mrz_not_found: 'MRZ not found',
  document_number_check_digit_invalid: 'Document number check digit wrong',
  birth_date_check_digit_invalid: 'Birth date check digit wrong',
  expiration_date_check_digit_invalid: 'Expiry date check digit wrong',
  optional_data_check_digit_invalid: 'Optional data check digit wrong',
  composite_check_digit_invalid: 'Composite check digit wrong',
  mrz_document_code_invalid: 'MRZ document code invalid',
  mrz_issuing_state_invalid: 'MRZ issuing state invalid',
  mrz_nationality_invalid: 'MRZ nationality invalid',
  mrz_birth_date_invalid: 'MRZ birth date invalid',
  mrz_expiration_date_invalid: 'MRZ expiry date invalid',
  mrz_sex_invalid: 'MRZ sex invalid',
  mrz_name_invalid: 'MRZ name invalid',
  document_number_mismatch: 'Document number differs from the MRZ',
  surname_mismatch: 'Surname differs from the MRZ',
  given_names_mismatch: 'Given names differ from the MRZ',
  birth_date_mismatch: 'Birth date differs from the MRZ',
  expiration_date_mismatch: 'Expiry date differs from the MRZ',
  sex_mismatch: 'Sex differs from the MRZ',
  nationality_mismatch: 'Nationality differs from the MRZ',
  issuing_state_mismatch: 'Issuing state differs from the MRZ',
  // The barcode (AAMVA PDF417).
  barcode_not_found: 'Barcode not found',
  aamva_header_invalid: 'Barcode header invalid',
  aamva_subfile_designator_invalid: 'Barcode subfile designator invalid',
  aamva_mandatory_element_missing: 'Barcode lacks a mandatory element',
  aamva_date_invalid: 'Barcode date invalid',
  aamva_iin_unknown: 'Barcode issuer number unknown',
  aamva_version_unsupported: 'Barcode version unsupported',
  aamva_document_subfile_missing: 'Barcode document subfile missing',
  aamva_header_nonstandard: 'Barcode header of an older standard',
  aamva_designator_offset_mismatch: 'Barcode subfile offset off by a few bytes',
  barcode_viz_mismatch: 'Barcode differs from the printed card',
  real_id_not_compliant: 'Not REAL ID compliant',
  real_id_marker_inconsistent: 'REAL ID markers disagree',
  // Extraction and logic.
  required_fields_missing: 'Required fields missing',
  extraction_inconsistent: 'Sources disagree',
  number_format_invalid: 'Number format invalid',
  expired: 'Expired',
  expired_within_grace_period: 'Expired, within the grace period',
  expiration_date_invalid: 'Expiry date invalid',
  birth_date_invalid: 'Birth date invalid',
  issue_date_invalid: 'Issue date invalid',
  birth_date_in_future: 'Birth date in the future',
  issue_date_in_future: 'Issue date in the future',
  birth_date_not_before_issue_date: 'Born after the issue date',
  issue_date_not_before_expiration_date: 'Issued after the expiry date',
  birth_date_not_before_expiration_date: 'Born after the expiry date',
  age_exceeds_maximum: 'Age not plausible',
  validity_period_too_long: 'Validity period too long',
  below_minimum_age: 'Below the minimum age',
  above_maximum_age: 'Above the maximum age',
  age_limits_not_configured: 'No age limits set',
  apparent_age_inconsistent: 'Apparent age does not match',
  issuing_country_not_allowed: 'Issuing country not allowed',
  issuing_country_disallowed: 'Issuing country disallowed',
  id_class_not_allowed: 'ID type not allowed',
  id_class_disallowed: 'ID type disallowed',
  po_box_detected: 'PO box address',
  // Heuristics and fraud signals.
  grayscale_image: 'Grayscale image',
  color_cast_detected: 'Color cast',
  screen_recapture_suspected: 'Photographed from a screen',
  editing_software_detected: 'Editing software',
  error_level_anomaly: 'Error level anomaly',
  double_compression_detected: 'Compressed twice',
  copy_move_detected: 'Copied region',
  portrait_boundary_anomaly: 'Portrait edge anomaly',
  layout_nonconformant: 'Layout does not conform',
  handwriting_suspected: 'Handwriting suspected',
  specimen_marker_found: 'Specimen marker',
  specimen_document_number: 'Specimen document number',
  specimen_issuer: 'Test issuer outside the sandbox',
  synthetic_test_data: 'Synthetic test data',
  compromised_list_match: 'On a compromised list',
  compromised_list_unavailable: 'A compromised list could not be read',
  entity_risk_high: 'High document risk',
  // Repeats, comparisons and providers.
  id_repeat_detected: 'ID used before',
  inconsistent_repeat_detected: 'ID used before by another identity',
  name_mismatch: 'Name differs',
  birthdate_mismatch: 'Birthdate differs',
  address_mismatch: 'Address differs',
  identification_number_mismatch: 'ID number differs',
  face_mismatch: 'Faces do not match',
  public_figure_match: 'Matches a public figure',
  aamva_record_mismatch: 'AAMVA record differs',
  aamva_record_not_found: 'No AAMVA record',
  // C59.4: the jurisdiction does not answer AAMVA lookups, so an operator decides.
  aamva_jurisdiction_not_participating: 'Jurisdiction not in the AAMVA lookup',
  // The selfie (Phase 1).
  image_too_dark: 'Image too dark',
  image_too_bright: 'Image too bright',
  face_not_present: 'No face',
  multiple_faces_present: 'Several faces',
  selfie_face_not_present: 'No face in the selfie',
  id_portrait_not_present: 'No ID portrait',
  // The selfie (Phase 4, C39.2): capture and pose, the user can fix them.
  face_too_small: 'Face too small',
  face_glare: 'Glare on the face',
  pose_not_center: 'Not looking straight ahead',
  pose_not_left: 'Head not turned to the left',
  pose_not_right: 'Head not turned to the right',
  face_covered: 'Face covered',
  glasses_detected: 'Glasses',
  // Liveness and replays.
  passive_liveness_low: 'Passive liveness score too low',
  pose_identity_mismatch: 'A pose shows another person',
  automated_capture: 'Automated capture',
  capture_replayed: 'Photo seen before',
  capture_not_live: 'Not a live capture',
  capture_device_suspicious: 'Suspicious camera',
  planar_motion: 'Flat motion between poses',
  pose_frames_identical: 'Poses identical',
  duplicate_frame: 'Duplicate photo',
  // Matching, age and synthetic faces.
  not_consented: 'No matching consent',
  face_seen_on_other_account: 'Face seen on another account',
  background_seen_with_other_faces: 'Background seen with other faces',
  age_outside_limits: 'Apparent age outside the limits',
  age_inconsistent_with_birthdate: 'Apparent age differs from the birthdate',
  synthetic_face_suspected: 'Synthetic face suspected',
  provenance_marks_synthetic: 'Image metadata marks it synthetic',
  provider_flagged: 'Flagged by the provider',
});

// Maps, so a code such as `constructor` never reaches `Object.prototype`.
const WORDS: ReadonlyMap<string, string> = new Map(Object.entries(REASON_WORDS));

/** The reasons whose words need a sentence of explanation. */
const EXPLANATIONS: ReadonlyMap<string, string> = new Map([
  ['provider_not_configured', 'No provider is bound to this check in this environment.'],
  [
    'not_consented',
    'The user did not give the optional matching consent this check needs, so it did not run.',
  ],
  [
    'capture_not_live',
    'No live camera capture: an uploaded photo, or a selfie taken before captures existed.',
  ],
  [
    'capture_device_suspicious',
    'The camera label is on the virtual-camera list, so a reviewer decides.',
  ],
  ['capture_replayed', 'A photo has the same bytes as a file already stored in this environment.'],
]);

/**
 * The words of `code`, or `undefined` for a code the console does not know. With the name of the
 * check that gave it, the words of the check's verification type come first (C54.5,
 * `reason-words/<type>.ts`), then the shared ones.
 */
export function reasonText(code: string, checkName?: string): ReasonText | undefined {
  const typed = checkName === undefined ? undefined : typeReasonText(code, checkName);
  if (typed !== undefined) {
    return typed;
  }
  const words = WORDS.get(code);
  if (words === undefined) {
    return undefined;
  }
  const explanation = EXPLANATIONS.get(code);
  return explanation === undefined ? { words } : { words, explanation };
}

/**
 * The reasons each database and AAMVA evaluator may emit (C51.2, C59), in the order of the C51.2
 * table: the shared reasons of the check's inputs, then its failures, then its `not_applicable`
 * reasons. `DATABASE_CHECK_REASONS` in `@openverify/contracts` lists the same per check; the
 * API's database contract test asserts the two agree. No evaluator emits `not_implemented`.
 */
const frozen = (...reasons: string[]): readonly string[] => Object.freeze(reasons);

const PROVIDER = ['input_missing', 'execution_error', 'provider_not_configured'];
const FIELD_NA = ['not_requested', 'no_reference_data', 'no_matching_record'];
const AAMVA_NA = ['record_not_found', 'jurisdiction_not_participating'];

export const DATABASE_EVALUATOR_REASONS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    database_identity_comparison: frozen(
      ...PROVIDER,
      'low_confidence_match',
      'record_not_found',
      'no_matching_record',
      'insufficient_data',
      'unsupported_country',
    ),
    database_name_comparison: frozen(...PROVIDER, 'name_mismatch', ...FIELD_NA),
    database_address_comparison: frozen(...PROVIDER, 'address_mismatch', ...FIELD_NA),
    database_birthdate_comparison: frozen(
      ...PROVIDER,
      'birthdate_mismatch',
      ...FIELD_NA,
      'birthdate_ambiguous',
    ),
    database_inquiry_comparison: frozen(
      'input_missing',
      'inquiry_field_mismatch',
      'not_requested',
      'no_reference_data',
    ),
    database_po_box_detection: frozen('input_missing', 'po_box_detected', 'not_requested'),
    aamva_identity_comparison: frozen(...PROVIDER, 'record_mismatch', ...AAMVA_NA),
    aamva_name_comparison: frozen(...PROVIDER, 'name_mismatch', ...AAMVA_NA),
    aamva_identification_number_comparison: frozen(
      ...PROVIDER,
      'identification_number_mismatch',
      ...AAMVA_NA,
    ),
  });

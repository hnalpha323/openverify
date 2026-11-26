/**
 * The reason codes of the database and AAMVA checks (C51.2, C58, C59). `checks-matching` owns
 * this file from 5A Stage 2 and may add fraud reasons only, recorded as plan amendments; the
 * user-behaviour failure reason (`po_box_detected`) is frozen.
 */
import type { CheckId } from '@openverify/core';
import { checkReasonsOf, outcome, type CheckOutcomeTable } from './check-outcome-reasons.js';

export const DATABASE_CHECK_IDS = Object.freeze([
  'database_identity_comparison',
  'database_name_comparison',
  'database_address_comparison',
  'database_birthdate_comparison',
  'database_inquiry_comparison',
  'database_po_box_detection',
  'aamva_identity_comparison',
  'aamva_name_comparison',
  'aamva_identification_number_comparison',
] as const satisfies readonly CheckId[]);

export type DatabaseCheckId = (typeof DATABASE_CHECK_IDS)[number];

/** `not_requested` is non-blocking: the step did not collect the field. */
const FIELD_NA = ['not_requested', 'no_reference_data', 'no_matching_record'] as const;
const AAMVA_NA = ['jurisdiction_not_participating', 'input_missing'] as const;

export const DATABASE_CHECK_OUTCOMES: CheckOutcomeTable<DatabaseCheckId> = Object.freeze({
  // `record_not_found` only from an authoritative source; `no_matching_record` otherwise (C59.3).
  database_identity_comparison: outcome(
    ['low_confidence_match', 'record_not_found'],
    ['no_matching_record', 'insufficient_data', 'unsupported_country'],
  ),
  database_name_comparison: outcome(['name_mismatch'], FIELD_NA),
  database_address_comparison: outcome(['address_mismatch'], FIELD_NA),
  database_birthdate_comparison: outcome(
    ['birthdate_mismatch'],
    [...FIELD_NA, 'birthdate_ambiguous'],
  ),
  // `no_reference_data`: the inquiry was prefilled with none of the compared fields.
  database_inquiry_comparison: outcome(
    ['inquiry_field_mismatch'],
    ['not_requested', 'no_reference_data'],
  ),
  database_po_box_detection: outcome(['po_box_detected'], ['not_requested']),
  aamva_identity_comparison: outcome(['record_mismatch', 'record_not_found'], AAMVA_NA),
  aamva_name_comparison: outcome(['name_mismatch', 'record_not_found'], AAMVA_NA),
  aamva_identification_number_comparison: outcome(
    ['identification_number_mismatch', 'record_not_found'],
    AAMVA_NA,
  ),
});

export const DATABASE_CHECK_REASONS = checkReasonsOf(DATABASE_CHECK_OUTCOMES);

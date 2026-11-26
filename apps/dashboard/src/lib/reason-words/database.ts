/**
 * C51.2, C59.3, C66: the reason codes of the `verification/database` checks in words, for
 * operators. Every reason of a check's C51.2 row is worded here, because what a database source
 * answered is not what a document or a government ID answered; `input_missing` and
 * `provider_not_configured` keep their shared words (`check-reasons.ts`). A source that is not
 * authoritative (every sandbox record) cannot say that a person does not exist, so its misses go
 * to review, never to a failure (C59.3).
 */
import type { ReasonWords } from './types';

export const DATABASE_REASON_WORDS: ReasonWords = Object.freeze({
  // database_identity_comparison (C58.1, C59.3).
  low_confidence_match: {
    words: 'Record does not match',
    explanation:
      'Every configured match group was unmet: a field differs from the record or falls below the level its group needs.',
  },
  record_not_found: {
    words: 'No record at an authoritative source',
    explanation:
      'A source that is authoritative for this country holds no record of the values entered.',
  },
  no_matching_record: {
    words: 'No matching record',
    explanation:
      'The source found no record; it is not authoritative, so the verification goes to review rather than failing.',
  },
  insufficient_data: {
    words: 'Not enough data to decide',
    explanation:
      'No match group was met and not every group was unmet: a field a group needs is missing on one side, such as a record without a birth date.',
  },
  unsupported_country: {
    words: 'Country not covered by the source',
    explanation: 'The bound source holds no records for the country entered.',
  },
  execution_error: {
    words: 'Could not ask the source',
    explanation: 'The source failed or timed out after the job’s retries, so a reviewer decides.',
  },
  // The per-field comparisons (C59.3).
  name_mismatch: { words: 'Name differs from the record' },
  address_mismatch: { words: 'Address differs from the record' },
  birthdate_mismatch: { words: 'Birth date differs from the record' },
  birthdate_ambiguous: {
    words: 'Birth date may have day and month swapped',
    explanation:
      'The day and month of the birth date are transposed against the record, so a reviewer decides.',
  },
  no_reference_data: {
    words: 'Nothing to compare with',
    explanation:
      'The record holds nothing comparable for this field or, for the inquiry comparison, the inquiry was prefilled with none of the fields.',
  },
  not_requested: {
    words: 'Not collected by the step',
    explanation: 'The step does not collect this field, so the check does not count.',
  },
  // database_inquiry_comparison and database_po_box_detection.
  inquiry_field_mismatch: {
    words: 'Differs from the inquiry’s fields',
    explanation: 'A value entered differs from the field the inquiry was prefilled with.',
  },
  po_box_detected: {
    words: 'Address is a PO box',
    explanation:
      'The street address is a post office box, a military address or a mail-receiving agency; the user can enter where they live.',
  },
});

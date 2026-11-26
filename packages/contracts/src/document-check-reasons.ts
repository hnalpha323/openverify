/**
 * The reason codes of the document and proof-of-address checks (C51.2, C60). The 5B document
 * checks agent owns this file from 5B Stage 2 and may add fraud reasons only, recorded as plan
 * amendments; the user-behaviour failure reasons are frozen.
 */
import type { CheckId } from '@openverify/core';
import { checkReasonsOf, outcome, type CheckOutcomeTable } from './check-outcome-reasons.js';

export const DOCUMENT_CHECK_IDS = Object.freeze([
  'document_type_detection',
  'document_extracted_properties_detection',
  'document_expired_detection',
  'document_recency_detection',
  'document_fabrication_detection',
  'document_name_comparison',
  'document_address_comparison',
] as const satisfies readonly CheckId[]);

export type DocumentCheckId = (typeof DOCUMENT_CHECK_IDS)[number];

export const DOCUMENT_CHECK_OUTCOMES: CheckOutcomeTable<DocumentCheckId> = Object.freeze({
  // C60.6: only a recognised class outside the step's list, or an identity document, is refused;
  // anything else unrecognised goes to review.
  document_type_detection: outcome(
    [
      'document_type_not_accepted',
      'document_unreadable',
      'document_password_protected',
      'document_too_large',
      'document_too_many_pages',
    ],
    ['document_type_unknown'],
  ),
  document_extracted_properties_detection: outcome(
    ['name_not_found', 'address_not_found', 'issue_date_not_found', 'issuer_not_found'],
    ['input_missing'],
  ),
  // `feature_absent` (non-blocking): a class without an expiry in the feature table, or a lease
  // that prints no end date.
  document_expired_detection: outcome(['document_expired'], ['feature_absent', 'input_missing']),
  // `input_missing` also for a future or ambiguous date.
  document_recency_detection: outcome(['document_too_old'], ['input_missing']),
  document_fabrication_detection: outcome(
    [
      'pdf_incremental_update',
      'pdf_editor_producer',
      'pdf_created_before_issue_date',
      'pdf_metadata_inconsistent',
      'pdf_font_inconsistent',
      'pdf_hidden_text',
      'pdf_text_layer_mismatch',
      'pdf_signature_invalidated',
      'pdf_active_content',
      'image_editor_software',
      'image_tampered',
    ],
    ['input_missing'],
  ),
  document_name_comparison: outcome(
    ['document_name_mismatch'],
    ['no_reference_data', 'input_missing'],
  ),
  document_address_comparison: outcome(
    ['address_mismatch', 'postal_code_mismatch'],
    ['no_reference_data', 'input_missing'],
  ),
});

export const DOCUMENT_CHECK_REASONS = checkReasonsOf(DOCUMENT_CHECK_OUTCOMES);

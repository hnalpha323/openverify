/**
 * The reasons each document evaluator may emit (C51.2, C60.6), in the order of the C51.2 table:
 * the shared reasons of the check's inputs, then its failures, then its `not_applicable` reasons.
 * `DOCUMENT_CHECK_REASONS` in `@openverify/contracts` lists the same per check; an API contract
 * test asserts the two agree. No evaluator emits `not_implemented`.
 */
const frozen = (...reasons: string[]): readonly string[] => Object.freeze(reasons);

export const DOCUMENT_EVALUATOR_REASONS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    document_type_detection: frozen(
      'input_missing',
      'execution_error',
      'document_type_not_accepted',
      'document_unreadable',
      'document_password_protected',
      'document_too_large',
      'document_too_many_pages',
      'document_type_unknown',
    ),
    document_extracted_properties_detection: frozen(
      'input_missing',
      'execution_error',
      'name_not_found',
      'address_not_found',
      'issue_date_not_found',
      'issuer_not_found',
    ),
    document_expired_detection: frozen('input_missing', 'document_expired', 'feature_absent'),
    document_recency_detection: frozen('input_missing', 'document_too_old'),
    document_fabrication_detection: frozen(
      'input_missing',
      'execution_error',
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
    ),
    document_name_comparison: frozen(
      'input_missing',
      'document_name_mismatch',
      'no_reference_data',
    ),
    document_address_comparison: frozen(
      'input_missing',
      'address_mismatch',
      'postal_code_mismatch',
      'no_reference_data',
    ),
  });

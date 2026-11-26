/**
 * C51.2, C66: the reason codes of the `verification/document` checks in words, said for a
 * proof-of-address document (C60.6). Every code of the C51.2 table has words here
 * (`document.test.ts` reads the contracts' list first); `reasonText` falls back to the shared
 * words for the C29.4 reasons the registry inputs add (`execution_error`).
 *
 * The fabrication reasons are cues of a heuristic (H tier, `beta`): each is a trace an edit can
 * leave, never proof of one, and a clean document can still be a forgery (docs/checks/document.md).
 */
import type { ReasonWords } from './types';

export const DOCUMENT_REASON_WORDS: ReasonWords = Object.freeze({
  // document_type_detection (C60.6): the class, and vision's refusals of the file.
  document_type_not_accepted: {
    words: 'Document type not accepted',
    explanation:
      'It reads as a class the step does not accept, or as an identity document, which a proof-of-address step never takes.',
  },
  document_unreadable: {
    words: 'Document unreadable',
    explanation: 'The file could not be opened, or no text could be read from it.',
  },
  document_password_protected: {
    words: 'Password-protected PDF',
    explanation: 'The PDF needs a password to open; the user is asked for another file.',
  },
  document_too_large: { words: 'File too large' },
  document_too_many_pages: { words: 'Too many pages', explanation: 'A PDF may have 50 pages.' },
  document_type_unknown: {
    words: 'Document not recognised',
    explanation:
      'No accepted class was established (another language or layout, or too little evidence), so the document goes to review.',
  },
  // document_extracted_properties_detection.
  name_not_found: { words: 'No name found' },
  address_not_found: { words: 'No address found' },
  issue_date_not_found: { words: 'No issue date found' },
  issuer_not_found: { words: 'No issuer found' },
  // Shared by the gated checks (C60.6: one mistake fails one check).
  input_missing: {
    words: 'Not enough read to judge',
    explanation:
      'The document’s class was not established, or what this check reads (a date, the name, the address, a medium or strong fabrication cue) was missing or ambiguous.',
  },
  // document_expired_detection.
  document_expired: {
    words: 'Document expired',
    explanation: 'Its printed end date (a lease’s end) has passed.',
  },
  feature_absent: {
    words: 'Prints no expiry',
    explanation:
      'This class of document prints no expiry date, or the lease prints no end date (a periodic tenancy).',
  },
  // document_recency_detection.
  document_too_old: {
    words: 'Document too old',
    explanation: 'It was issued before the recency window the template sets.',
  },
  // document_fabrication_detection (H, beta): each a trace an edit can leave.
  pdf_incremental_update: {
    words: 'Edited after it was first saved',
    explanation:
      'The PDF holds incremental revisions or a repaired cross-reference: a weak trace of an edit.',
  },
  pdf_editor_producer: {
    words: 'Saved by an editor',
    explanation: 'The PDF names editing software as its producer: a weak trace of an edit.',
  },
  pdf_created_before_issue_date: {
    words: 'Created before its issue date',
    explanation: 'The PDF’s creation date is earlier than the date printed on it: a weak trace.',
  },
  pdf_metadata_inconsistent: {
    words: 'Metadata disagrees',
    explanation: 'The PDF’s document information and its XMP metadata disagree: a weak trace.',
  },
  pdf_font_inconsistent: {
    words: 'Inconsistent fonts',
    explanation:
      'Another font inside an amount line, or mixed subsets of one font: a medium trace of an edit.',
  },
  pdf_hidden_text: {
    words: 'Hidden or covered text',
    explanation:
      'Text holding a figure is covered by a shape or painted in the background’s colour: a strong trace of an edit.',
  },
  pdf_text_layer_mismatch: {
    words: 'Text layer differs from the page',
    explanation:
      'The text stored in the PDF disagrees with what OCR reads on the rendered page: a medium trace.',
  },
  pdf_signature_invalidated: {
    words: 'Changed after it was signed',
    explanation: 'Content was added after a digital signature: a strong trace of an edit.',
  },
  pdf_active_content: {
    words: 'Active content',
    explanation:
      'The PDF carries JavaScript, a launch or a form submission: a strong cue, as a bill needs none.',
  },
  image_editor_software: {
    words: 'Saved by an image editor',
    explanation: 'The photo’s EXIF data names editing software: a weak trace.',
  },
  image_tampered: {
    words: 'Image edited',
    explanation:
      'Double JPEG compression with uneven error levels, or a copy-move region: a medium or strong trace.',
  },
  // document_name_comparison and document_address_comparison (C60.6).
  document_name_mismatch: {
    words: 'Name differs from the applicant',
    explanation:
      'The name printed on the document does not match the reference (the inquiry, the latest government ID, or the account).',
  },
  no_reference_data: {
    words: 'Nothing to compare with',
    explanation: 'The inquiry, its government ID and its account hold no name or address.',
  },
  address_mismatch: { words: 'Address differs from the applicant' },
  postal_code_mismatch: {
    words: 'Postal code differs',
    explanation: 'Only the postal code contradicts the reference address.',
  },
});

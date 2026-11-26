/** Human-readable labels for API values. Records over the domain types fail typecheck when a value is added. */
import type { FileKind, ReportResourceType, VerificationResourceType } from '@openverify/contracts';
import type {
  CheckCategory,
  CheckStatus,
  ExtractionField,
  ExtractionSource,
  InquiryStatus,
  ReportStatus,
  VerificationStatus,
} from '@openverify/core';

/** In `INQUIRY_STATUSES` order, so the status filter lists them the same way. */
export const INQUIRY_STATUS_LABELS: Readonly<Record<InquiryStatus, string>> = Object.freeze({
  created: 'Created',
  pending: 'Pending',
  completed: 'Completed',
  failed: 'Failed',
  expired: 'Expired',
  approved: 'Approved',
  declined: 'Declined',
  needs_review: 'Needs review',
});

export const VERIFICATION_STATUS_LABELS: Readonly<Record<VerificationStatus, string>> =
  Object.freeze({
    initiated: 'Initiated',
    confirmed: 'Confirmed',
    submitted: 'Submitted',
    passed: 'Passed',
    failed: 'Failed',
    requires_retry: 'Requires retry',
    canceled: 'Canceled',
    skipped: 'Skipped',
    needs_review: 'Needs review',
  });

export const CHECK_STATUS_LABELS: Readonly<Record<CheckStatus, string>> = Object.freeze({
  passed: 'Passed',
  failed: 'Failed',
  not_applicable: 'Not applicable',
  pending: 'Pending',
});

/** C50.8: what a check describes, as the API derives it from the registry. */
export const CHECK_CATEGORY_LABELS: Readonly<Record<CheckCategory, string>> = Object.freeze({
  biometrics: 'Biometrics',
  fraud: 'Fraud',
  user_action_required: 'User action required',
  validity: 'Validity',
});

export const VERIFICATION_TYPE_LABELS: Readonly<Record<VerificationResourceType, string>> =
  Object.freeze({
    'verification/government-id': 'Government ID',
    'verification/selfie': 'Selfie',
    // C50.1: the Phase 5 types.
    'verification/document': 'Document',
    'verification/database': 'Database',
    'verification/aamva': 'AAMVA',
    'verification/phone-number': 'Phone number',
    'verification/email-address': 'Email address',
    'verification/government-id-nfc': 'Government ID chip',
    'verification/crypto-wallet': 'Crypto wallet',
    'verification/database-business': 'Business registry',
    'verification/business-website': 'Business website',
  });

/** The C31.5 extraction attributes of a government ID, in words, in their API order. */
export const EXTRACTION_FIELD_LABELS: Readonly<Record<ExtractionField, string>> = Object.freeze({
  'name-first': 'First name',
  'name-middle': 'Middle name',
  'name-last': 'Last name',
  birthdate: 'Date of birth',
  sex: 'Sex',
  nationality: 'Nationality',
  'identification-number': 'Document number',
  'personal-number': 'Personal number',
  'issue-date': 'Issue date',
  'expiration-date': 'Expiry date',
  'issuing-authority-code': 'Issuing authority code',
  'address-street-1': 'Street address',
  'address-street-2': 'Street address, line 2',
  'address-city': 'City',
  'address-subdivision': 'State or region',
  'address-postal-code': 'Postal code',
  'address-country-code': 'Country',
  endorsements: 'Endorsements',
  restrictions: 'Restrictions',
  'vehicle-class': 'Vehicle class',
});

/** Where an extracted field was read (C31.1), in words. */
export const EXTRACTION_SOURCE_LABELS: Readonly<Record<ExtractionSource, string>> = Object.freeze({
  mrz: 'Machine-readable zone',
  barcode: 'Barcode',
  viz: 'Visual zone',
  nfc: 'NFC chip',
});

export const FILE_KIND_LABELS: Readonly<Record<FileKind, string>> = Object.freeze({
  front: 'Front',
  back: 'Back',
  portrait: 'Portrait',
  'selfie-center': 'Center',
  'selfie-left': 'Left',
  'selfie-right': 'Right',
  // C52.4: the document and its server-written preview; the chip files and their portrait.
  document: 'Document',
  'document-preview': 'Document preview',
  'chip-sod': 'Chip security object (SOD)',
  'chip-dg1': 'Chip data group 1 (MRZ)',
  'chip-dg2': 'Chip data group 2 (photo)',
  'chip-dg14': 'Chip data group 14 (chip authentication)',
  'chip-dg15': 'Chip data group 15 (active authentication)',
  'chip-card-security': 'Chip card security file',
  'chip-card-access': 'Chip card access file',
  'chip-com': 'Chip index file (COM)',
  'chip-portrait': 'Chip portrait',
});

/** C69.1 (Phase 6): the report types, in the registry's order. */
export const REPORT_TYPE_LABELS: Readonly<Record<ReportResourceType, string>> = Object.freeze({
  'report/watchlist': 'Watchlist',
  'report/business-watchlist': 'Business watchlist',
  'report/crypto-address-watchlist': 'Crypto address watchlist',
  'report/politically-exposed-person': 'Politically exposed person',
  'report/adverse-media': 'Adverse media',
  'report/business-adverse-media': 'Business adverse media',
  'report/email-address': 'Email address',
  'report/phone-number': 'Phone number',
  'report/address-lookup': 'Address lookup',
  // C106.1 (Phase 7).
  'report/ip-address': 'IP address',
  // C106.2 (Workflow 7B).
  'report/custom-list': 'Custom list',
});

/**
 * C69.2: report statuses, in `REPORT_STATUSES` order. A status is about processing, never the
 * result; an errored report was not screened, so it never reads as "no match" (C69.4, C86).
 */
export const REPORT_STATUS_LABELS: Readonly<Record<ReportStatus, string>> = Object.freeze({
  pending: 'Pending',
  submitted: 'Submitted',
  ready: 'Ready',
  errored: 'Errored (not screened)',
});

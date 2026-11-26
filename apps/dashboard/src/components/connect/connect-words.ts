/**
 * Connect in words (C242; Workflow 11A console-connect): every status, reason, side, method and
 * category the Connect pages show, said for an operator. A code is never shown as it is spelt on the
 * wire. A module client components may import: it holds no server-only import.
 */
import type {
  AttestedConsentMode,
  ConnectSide,
  ConnectionDirection,
  ConnectionStatus,
  ConsentMethod,
  ConsentRecordStatus,
  ConsentWithdrawalReason,
  ConsentWithdrawnVia,
  SharePurpose,
  ShareRedeemMode,
  ShareSourceType,
  ShareTokenExpiryReason,
  ShareTokenFailureReason,
  ShareTokenStatus,
  ShareVerificationType,
} from '@openverify/contracts';
import type { ShareCategory } from '@openverify/core';
import type { BadgeTone } from '../status-badge';

type Words<Key extends string> = Readonly<Record<Key, string>>;
type Tones<Key extends string> = Readonly<Record<Key, BadgeTone>>;

export const CONNECTION_STATUS_WORDS: Words<ConnectionStatus> = Object.freeze({
  pending: 'Pending',
  active: 'Active',
  inactive: 'Inactive',
  archived: 'Archived',
});

/** Pending waits for the destination; only an active connection carries shares. */
export const CONNECTION_STATUS_TONES: Tones<ConnectionStatus> = Object.freeze({
  pending: 'attention',
  active: 'success',
  inactive: 'neutral',
  archived: 'neutral',
});

export const CONNECTION_DIRECTION_WORDS: Words<ConnectionDirection> = Object.freeze({
  inbound: 'Inbound: you receive shares',
  outbound: 'Outbound: you share',
  self: 'Self-connection: you are both sides (for testing)',
});

export const SHARE_TOKEN_STATUS_WORDS: Words<ShareTokenStatus> = Object.freeze({
  created: 'Created',
  pending: 'Redeeming',
  redeemed: 'Redeemed',
  expired: 'Expired',
  failed: 'Failed',
});

export const SHARE_TOKEN_STATUS_TONES: Tones<ShareTokenStatus> = Object.freeze({
  created: 'progress',
  pending: 'progress',
  redeemed: 'success',
  expired: 'neutral',
  failed: 'danger',
});

export const SHARE_TOKEN_FAILURE_WORDS: Words<ShareTokenFailureReason> = Object.freeze({
  source_not_found: 'The shared object no longer exists at the source.',
  source_redacted: 'The source redacted the shared object.',
  import_failed:
    'The copy could not be written: a mapped field failed validation, or the copy was over the limits.',
  unrecoverable_error: 'The redemption failed after its retries.',
  connection_inactive: 'The connection was deactivated before the copy was made.',
  consent_withdrawn: 'A consent the share rests on was withdrawn.',
  consent_expired: 'A consent the share rests on expired before the copy was made.',
  consent_scope_exceeded:
    'The source now holds data of a category the consent does not cover, so nothing was copied.',
  source_is_copy: 'The source object is itself a copy, and a copy is never shared on.',
});

export const SHARE_TOKEN_EXPIRY_WORDS: Words<ShareTokenExpiryReason> = Object.freeze({
  time: 'Its time ran out.',
  source_expired: 'The source expired it.',
  connection_deactivated: 'The connection was deactivated.',
  consent_withdrawn: 'The consent it cited was withdrawn.',
});

export const SHARE_REDEEM_MODE_WORDS: Words<ShareRedeemMode> = Object.freeze({
  clone: 'Clone (a copy of the object, marked as cloned)',
  hydrate: 'Hydrate (fields filled into an object of yours)',
  'fill-inquiry': 'Filled into an inquiry in the flow',
});

export const SHARE_SOURCE_TYPE_WORDS: Words<ShareSourceType> = Object.freeze({
  inquiry: 'Inquiries',
  account: 'Accounts',
  transaction: 'Transactions',
  verification: 'Verifications',
});

/** One source type in the singular, as a token's source is named. */
export const SHARE_SOURCE_TYPE_SINGULAR: Words<ShareSourceType> = Object.freeze({
  inquiry: 'Inquiry',
  account: 'Account',
  transaction: 'Transaction',
  verification: 'Verification',
});

export const SHARE_VERIFICATION_TYPE_WORDS: Words<ShareVerificationType> = Object.freeze({
  'government-id': 'Government ID',
  selfie: 'Selfie',
  database: 'Database',
  document: 'Document',
  'email-address': 'Email address',
  'phone-number': 'Phone number',
});

export const ATTESTED_CONSENT_WORDS: Words<AttestedConsentMode> = Object.freeze({
  none: 'Not accepted: only consent witnessed in the flow authorises a share',
  'non-biometric':
    'Accepted for shares without biometric data; a share with biometric data needs consent witnessed in the flow',
  all: 'Accepted for every share, biometric data included',
});

export const SHARE_PURPOSE_WORDS: Words<SharePurpose> = Object.freeze({
  'share.reuse-kyc': 'Reusing an identity verification',
});

export const SHARE_CATEGORY_WORDS: Words<ShareCategory> = Object.freeze({
  'identity-fields': 'Identity fields (names, dates, addresses, ID numbers)',
  'contact-fields': 'Contact fields (email addresses, phone numbers)',
  'other-fields': 'Other fields',
  'document-images': 'Document images and other uploads',
  biometric: 'Biometric data (selfies, ID portraits, liveness and face-match results)',
  'check-results': 'Check results',
});

/** C242.3, C236.9: a flow record is witnessed only in what the platform saw; an attested one is not. */
export const CONSENT_METHOD_WORDS: Words<ConsentMethod> = Object.freeze({
  flow: 'Witnessed in the flow',
  attested: 'Attested by the operator, not witnessed',
});

export const CONNECT_SIDE_WORDS: Words<ConnectSide> = Object.freeze({
  source: 'Source: consent to disclose',
  destination: 'Destination: consent to receive',
});

export const CONSENT_STATUS_WORDS: Words<ConsentRecordStatus> = Object.freeze({
  active: 'Active',
  expired: 'Expired',
  withdrawn: 'Withdrawn',
  redacted: 'Redacted',
  declined: 'Declined',
});

/** A decline is never shown as a consent in force (C236.11). */
export const CONSENT_STATUS_TONES: Tones<ConsentRecordStatus> = Object.freeze({
  active: 'success',
  expired: 'neutral',
  withdrawn: 'attention',
  redacted: 'neutral',
  declined: 'danger',
});

export const CONSENT_WITHDRAWN_VIA_WORDS: Words<ConsentWithdrawnVia> = Object.freeze({
  api: 'Through the API',
  operator: 'By an operator in the console',
  flow: 'By the person in the flow',
});

export const CONSENT_WITHDRAWAL_REASON_WORDS: Words<ConsentWithdrawalReason> = Object.freeze({
  'subject-request': 'The person asked',
  'operator-decision': 'The operator decided',
  other: 'Another reason',
});

/** A list of words joined as English writes it ("a, b and c"); `none` when empty. */
export function listInWords(items: readonly string[], none: string): string {
  if (items.length === 0) {
    return none;
  }
  if (items.length === 1) {
    return items[0] ?? none;
  }
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}

/**
 * The categories in words, in the order given; the first keeps its capital and the others are
 * lower-cased, so the list reads as one sentence.
 */
export function categoriesInWords(categories: readonly ShareCategory[]): string {
  return listInWords(
    categories.map((category, index) => {
      const words = SHARE_CATEGORY_WORDS[category];
      return index === 0 ? words : words.charAt(0).toLowerCase() + words.slice(1);
    }),
    'No data',
  );
}

/** Each category in a few words, for a table cell or a term's value. */
export const SHARE_CATEGORY_SHORT: Words<ShareCategory> = Object.freeze({
  'identity-fields': 'Identity fields',
  'contact-fields': 'Contact fields',
  'other-fields': 'Other fields',
  'document-images': 'Document images',
  biometric: 'Biometric data',
  'check-results': 'Check results',
});

/** The categories as a short list ("Identity fields, Biometric data"); "No data" for none. */
export function categoryList(categories: readonly ShareCategory[]): string {
  return categories.length === 0
    ? 'No data'
    : categories.map((category) => SHARE_CATEGORY_SHORT[category]).join(', ');
}

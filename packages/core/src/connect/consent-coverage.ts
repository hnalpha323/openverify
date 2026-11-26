/**
 * C232.1, C234.1, C234.2 (Phase 11, Workflow 11A Stage 2; `connect-logic`): whether a consent record
 * covers a share, as a pure decision over the record, the share's categories and the policy. Every
 * refusal is 422 `consent_required` with one of {@link CONSENT_REQUIRED_REASONS}, the closed list of
 * `consentRequiredProblemSchema`.
 */
import type { ShareCategory } from './categories.js';
import {
  attestedConsentAllows,
  type ShareAttestedConsent,
  type ShareSourceKind,
} from './policy.js';

/** The `reason` of 422 `consent_required` (the contracts' closed list, in its order). */
export const CONSENT_REQUIRED_REASONS = Object.freeze([
  'missing',
  'subject',
  'recipient',
  'categories',
  'explicit_biometric',
  'attested_not_accepted',
  'withdrawn',
  'expired',
  'already_used',
] as const);
export type ConsentRequiredReason = (typeof CONSENT_REQUIRED_REASONS)[number];

/** A consent record's facts, as the repository reads them (C236.1). */
export interface ConsentRecordFacts {
  readonly side: 'source' | 'destination';
  readonly outcome: 'accepted' | 'declined';
  readonly method: 'flow' | 'attested';
  readonly purpose: string;
  /** The record's subject; `null` once its subject was redacted (C241.3). */
  readonly subject: { readonly type: string; readonly id: string } | null;
  /** A source record: the token that cites it; a destination record: the token it is about. */
  readonly shareTokenId: string | null;
  readonly recipientOrganizationId: string;
  readonly categories: readonly ShareCategory[];
  readonly explicitBiometric: boolean;
  readonly expiresAt: Date;
  readonly withdrawnAt: Date | null;
  readonly redactedAt: Date | null;
}

/** C232.1: the share a source-side record must cover. */
export interface SourceShareFacts {
  readonly source: {
    readonly type: ShareSourceKind;
    readonly id: string;
    /** The inquiry holding a verification source; `null` for any other source. */
    readonly holdingInquiryId: string | null;
  };
  /** The connection's destination organisation. */
  readonly recipientOrganizationId: string;
  /** The policy's purpose. */
  readonly purpose: string;
  /** The share's categories (computed now at creation, the token's stored ones after). */
  readonly categories: readonly ShareCategory[];
  /** The policy's `attested-consent`. */
  readonly attestedConsent: ShareAttestedConsent;
  /** The token that may cite the record: `null` while it is being created. */
  readonly shareTokenId: string | null;
  readonly now: Date;
}

/** C234.1: the redemption a destination-side record must cover. */
export interface DestinationShareFacts {
  readonly shareTokenId: string;
  /** The caller's organisation, the recipient. */
  readonly recipientOrganizationId: string;
  readonly purpose: string;
  /** The token's stored categories. */
  readonly categories: readonly ShareCategory[];
  /** Another redemption already cited the record. */
  readonly citedByAnotherRedemption: boolean;
  readonly now: Date;
}

/** C230.4, C232.1: a consent covers a share when its categories include every one the share has. */
export function categoriesCover(
  consented: readonly ShareCategory[],
  carried: readonly ShareCategory[],
): boolean {
  return carried.every((category) => consented.includes(category));
}

/** Whether a share may cite a record: of this side, accepted and not redacted (C236.11, C241.3). */
const usable = (record: ConsentRecordFacts, side: ConsentRecordFacts['side']): boolean =>
  record.side === side &&
  record.outcome === 'accepted' &&
  record.redactedAt === null &&
  record.subject !== null;

/**
 * C232.1 (review P34): a source-side record's subject is the source object, or the inquiry that
 * holds a verification source. A `flow` record's subject is always the inquiry whose session made
 * it, so an account or a transaction source needs an `attested` record naming it.
 */
function subjectCovers(
  subject: NonNullable<ConsentRecordFacts['subject']>,
  method: ConsentRecordFacts['method'],
  source: SourceShareFacts['source'],
): boolean {
  if (method === 'flow' && subject.type !== 'inquiry') {
    return false;
  }
  return (
    (subject.type === source.type && subject.id === source.id) ||
    (source.type === 'verification' &&
      subject.type === 'inquiry' &&
      source.holdingInquiryId === subject.id)
  );
}

/** The checks both sides share after the subject, in order. */
function coverageRefusal(
  record: ConsentRecordFacts,
  recipientOrganizationId: string,
  purpose: string,
  categories: readonly ShareCategory[],
  now: Date,
): ConsentRequiredReason | null {
  if (record.recipientOrganizationId !== recipientOrganizationId || record.purpose !== purpose) {
    return 'recipient';
  }
  if (!categoriesCover(record.categories, categories)) {
    return 'categories';
  }
  if (categories.includes('biometric') && !record.explicitBiometric) {
    return 'explicit_biometric';
  }
  if (record.withdrawnAt !== null) {
    return 'withdrawn';
  }
  if (record.expiresAt.getTime() <= now.getTime()) {
    return 'expired';
  }
  return null;
}

/**
 * C232.1: why `record` does not authorise the share, or `null` when it does. In order: `missing`
 * (no record, a destination-side, declined or redacted one), `subject`, `attested_not_accepted`
 * (an attested record the policy's `attested-consent` does not admit for this share), `recipient`
 * (another recipient or purpose), `categories`, `explicit_biometric`, `withdrawn`, `expired` (at or
 * past `expires-at`), `already_used` (another token cites it: one consent authorises one token).
 * The redeem job calls it again with the token's id and stored categories (C234.2).
 */
export function sourceConsentRefusal(
  record: ConsentRecordFacts | null,
  share: SourceShareFacts,
): ConsentRequiredReason | null {
  if (record === null || !usable(record, 'source') || record.subject === null) {
    return 'missing';
  }
  if (!subjectCovers(record.subject, record.method, share.source)) {
    return 'subject';
  }
  if (
    record.method === 'attested' &&
    !attestedConsentAllows(share.attestedConsent, share.categories.includes('biometric'))
  ) {
    return 'attested_not_accepted';
  }
  const refusal = coverageRefusal(
    record,
    share.recipientOrganizationId,
    share.purpose,
    share.categories,
    share.now,
  );
  if (refusal !== null) {
    return refusal;
  }
  return record.shareTokenId !== null && record.shareTokenId !== share.shareTokenId
    ? 'already_used'
    : null;
}

/**
 * C234.1, C234.2 (review P02): why a destination-side `record` does not authorise the redemption,
 * or `null` when it does. In order: `missing`, `subject` (it is about another token),
 * `recipient`, `categories` (the token's stored ones), `explicit_biometric`, `withdrawn`,
 * `expired`, `already_used`. An attested destination record is the destination's own statement and
 * is not bound by the source's `attested-consent`.
 */
export function destinationConsentRefusal(
  record: ConsentRecordFacts | null,
  share: DestinationShareFacts,
): ConsentRequiredReason | null {
  if (record === null || !usable(record, 'destination')) {
    return 'missing';
  }
  if (record.shareTokenId !== share.shareTokenId) {
    return 'subject';
  }
  const refusal = coverageRefusal(
    record,
    share.recipientOrganizationId,
    share.purpose,
    share.categories,
    share.now,
  );
  if (refusal !== null) {
    return refusal;
  }
  return share.citedByAnotherRedemption ? 'already_used' : null;
}

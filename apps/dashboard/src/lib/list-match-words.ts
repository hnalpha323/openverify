/**
 * List screening and list matches in words (C99, C108; H02, H15, H31). An unscreened list reads
 * "not screened" with its reason and never "no match"; a list the subject had no value for reads
 * "no value to compare"; a pending, partial or errored screening never reads "no match". Each
 * vocabulary's test iterates the contracts' list first.
 */
import type {
  ListMatchMethod,
  ListProbeSource,
  ListMatchStatus,
  ListMatchTier,
  ListNotApplicableReason,
  ListReviewCause,
  ListScreeningStatus,
  ListUnscreenedReason,
} from '@openverify/core';
/** C99.4: the screening's state. A count only ever follows `completed`. */
export const LIST_SCREENING_STATUS_WORDS: Readonly<Record<ListScreeningStatus, string>> =
  Object.freeze({
    pending: 'Screening not finished',
    completed: 'Screened',
    partial: 'Partly screened: some lists were not screened',
    errored: 'Screening errored: not screened',
  });

/** C99.1: why a selected list was not screened, after "Not screened:". */
export const LIST_UNSCREENED_REASON_WORDS: Readonly<Record<ListUnscreenedReason, string>> =
  Object.freeze({
    list_items_pending: 'its items are still being prepared',
    probe_unavailable: 'a value exists but could not be read',
    probe_too_coarse: 'the value is too coarse to compare (an IP location without a city)',
    consent_not_given: 'the end user did not consent to biometric matching',
    normaliser_outdated: 'its items were keyed by an older version and need a rebuild',
    key_rotated: 'its items were keyed under an earlier blind-index key',
    limit_exceeded: 'too many candidates to compare',
    list_archived: 'the list is archived',
    method_not_on_demand: 'its method does not run on demand',
    kind_not_collected: 'this environment does not collect values of its kind',
    client_address_untrusted: 'the client address cannot be trusted',
  });

/** C99.1 (H16): a list the subject had no value for was screened, with nothing to compare. */
export const LIST_NOT_APPLICABLE_REASON_WORDS: Readonly<Record<ListNotApplicableReason, string>> =
  Object.freeze({ subject_has_no_value: 'no value to compare' });

/** C99.6: what the screening did to the inquiry. */
export const LIST_REVIEW_CAUSE_WORDS: Readonly<Record<ListReviewCause, string>> = Object.freeze({
  list_match: 'A list matched, so the inquiry was marked for review',
  list_unscreened: 'A list could not be screened, so the inquiry was marked for review',
  inquiry_already_decided: 'Decided before the list screening finished',
});

/** C99.1: how an item matched. */
export const LIST_MATCH_METHOD_WORDS: Readonly<Record<ListMatchMethod, string>> = Object.freeze({
  exact: 'Exact',
  cidr: 'Inside an IP range',
  radius: 'Within the radius',
  fuzzy_name: 'Similar name',
  face_cosine: 'Similar face',
  background: 'Similar selfie background',
});

export const LIST_MATCH_STATUS_WORDS: Readonly<Record<ListMatchStatus, string>> = Object.freeze({
  open: 'Open',
  dismissed: 'Dismissed',
});

/** C99.1 (H15): the tier of the evidence. */
export const LIST_MATCH_TIER_WORDS: Readonly<Record<ListMatchTier, string>> = Object.freeze({
  R: 'R (an exact comparison)',
  H: 'H (a heuristic, beta)',
});

/** C99.5: where the compared value came from. */
export const LIST_PROBE_SOURCE_WORDS: Readonly<Record<ListProbeSource, string>> = Object.freeze({
  'otp.email-address': 'Confirmed email address',
  'otp.phone-number': 'Confirmed phone number',
  'inquiry.fields': "The inquiry's fields",
  'account.fields': "The account's fields",
  'government-id.identification-number': 'Government ID number',
  'government-id.name': 'Name on the government ID',
  'government-id.issuing-country': 'Issuing country of the government ID',
  'database.input': 'Database verification input',
  'session.ip-address': 'Session IP address',
  'session.ip-country': 'Session IP country (approximate)',
  'session.ip-point': 'Session IP location (approximate)',
  'session.browser-fingerprint': 'Session browser fingerprint',
  'session.device-fingerprint': 'Session device fingerprint',
  'selfie.center': 'Centre selfie',
  'report.query': 'Report query',
  request: 'The request',
});

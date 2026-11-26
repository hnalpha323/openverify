/**
 * Connect's problems in words (C242: "every problem code in words"). The API titles a problem with
 * its HTTP status ("Conflict"), so a refused Connect action is titled with these words instead; the
 * API's detail, field errors and request id are kept. `consent_required` also says its `reason` in
 * words. None of these sentences names another organisation, a person or a value (rule 11). A module
 * client components may import.
 */
import {
  CONNECT_PROBLEM_CODES,
  CONSENT_REQUIRED_REASONS,
  type ConnectProblemCode,
  type ConsentRequiredReason,
} from '@openverify/contracts';
import type { DisplayProblem } from '../../lib/action-state';

/** The Connect codes and the reused step-up code, each in words. */
export type ConnectProblemWordCode = ConnectProblemCode | 'step_up_required';

export const CONNECT_PROBLEM_WORDS: Readonly<Record<ConnectProblemWordCode, string>> =
  Object.freeze({
    destination_not_found:
      'No such destination: the organization is unknown, has not turned on inbound connections, or the destination object is not in this environment.',
    connection_exists: 'These two organizations already have a connection in this direction.',
    connection_not_active: 'The connection is not active.',
    share_policy_changed:
      'The share policy changed since you opened the page. Read the new version before you accept it.',
    share_policy_invalid: 'The share policy breaks one of its rules.',
    environment_kind_mismatch:
      'The destination has no environment of this kind: sandbox shares go only to sandbox, production only to production.',
    source_redacted: 'The object to share was redacted.',
    source_not_decided: 'The verification to share is not decided yet.',
    source_is_copy:
      'The object to share is a copy from another organization, or holds one, and a copy is never shared on.',
    share_source_not_allowed: 'The share policy does not share this kind of object.',
    share_source_not_supported: 'This kind of object cannot be shared.',
    consent_required: 'No consent record covers this share.',
    share_token_outlives_consent: 'The share token would outlive the consent it cites.',
    share_token_not_expirable: 'Only a share token that is not redeemed yet can be expired.',
    share_token_not_redeemable: 'This share token can no longer be redeemed or peeked.',
    connect_peek_unavailable:
      'Peeking is unavailable for the moment because the rate limiter cannot be reached. Try again later.',
    share_token_peek_limit: 'This share token was peeked as often as it may be.',
    share_token_already_redeemed: 'This share token is already being redeemed, or was redeemed.',
    share_token_expired: 'This share token expired.',
    share_redeem_mode_invalid: 'This kind of object cannot be redeemed into that destination.',
    share_redeem_meta_conflict:
      'Choose one way to link an account: an existing account, a new one, or a destination object.',
    destination_inquiry_not_open: 'The destination inquiry is no longer open.',
    consent_declined_in_flow:
      'The person declined this share in the flow, and a decline is not overridden.',
    consent_already_withdrawn: 'This consent was already withdrawn.',
    explicit_consent_required:
      'This share carries biometric data, which needs its own explicit consent.',
    share_consent_step_missing:
      'The template has no sharing-consent step for the destination, so it cannot receive this share.',
    share_token_in_use: 'This share token is already reserved for another inquiry.',
    step_up_required:
      'Confirm it is you: enter a code from your second factor, or use your security key, then try again.',
  });

export const CONSENT_REQUIRED_REASON_WORDS: Readonly<Record<ConsentRequiredReason, string>> =
  Object.freeze({
    missing: 'There is no accepted source-side consent record for this share.',
    subject: 'The consent record is about another object.',
    recipient: 'The consent record names another recipient or purpose.',
    categories: 'The consent record does not cover every kind of data the share carries.',
    explicit_biometric:
      'The share carries biometric data, and the consent record has no explicit consent to it.',
    attested_not_accepted: 'The connection’s policy does not accept an attested consent here.',
    withdrawn: 'The consent record was withdrawn.',
    expired: 'The consent record expired.',
    already_used: 'Another share token already cites this consent record.',
  });

const CODES: ReadonlySet<string> = new Set<string>([...CONNECT_PROBLEM_CODES, 'step_up_required']);
const REASONS: ReadonlySet<string> = new Set<string>(CONSENT_REQUIRED_REASONS);

/**
 * `problem`, titled in words when its code is Connect's (or the step-up's); anything else unchanged.
 * A `consent_required` with a known `reason` says the reason as its detail.
 */
export function describeConnectProblem(
  problem: DisplayProblem,
  reason?: string | null,
): DisplayProblem {
  if (problem.code === undefined || !CODES.has(problem.code)) {
    return problem;
  }
  const title = CONNECT_PROBLEM_WORDS[problem.code as ConnectProblemWordCode];
  const because =
    problem.code === 'consent_required' && typeof reason === 'string' && REASONS.has(reason)
      ? CONSENT_REQUIRED_REASON_WORDS[reason as ConsentRequiredReason]
      : undefined;
  return { ...problem, title, ...(because === undefined ? {} : { detail: because }) };
}

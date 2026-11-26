/**
 * The reason codes of the phone and email checks (C51.2, C55, C56). `checks-contact-crypto` owns
 * this file from 5A Stage 2 and may add fraud reasons only, recorded as plan amendments; the
 * user-behaviour failure reasons are frozen.
 */
import type { CheckId } from '@openverify/core';
import { checkReasonsOf, outcome, type CheckOutcomeTable } from './check-outcome-reasons.js';

export const CONTACT_CHECK_IDS = Object.freeze([
  'phone_number_otp_comparison',
  'email_address_otp_comparison',
  'email_address_disposable_detection',
  'email_address_mx_detection',
] as const satisfies readonly CheckId[]);

export type ContactCheckId = (typeof CONTACT_CHECK_IDS)[number];

/**
 * `otp_attempts_exhausted`: ten wrong entries submitted the verification (C55.5);
 * `otp_not_confirmed`: no code was confirmed before the sends ran out (C55.6), so the user starts
 * again; `otp_delivery_unavailable`: a limit refused the user (C55.6), so review.
 */
const OTP = outcome(['otp_attempts_exhausted', 'otp_not_confirmed'], ['otp_delivery_unavailable']);

export const CONTACT_CHECK_OUTCOMES: CheckOutcomeTable<ContactCheckId> = Object.freeze({
  phone_number_otp_comparison: OTP,
  email_address_otp_comparison: OTP,
  email_address_disposable_detection: outcome(['disposable_domain'], ['list_unavailable']),
  email_address_mx_detection: outcome(
    ['domain_not_found', 'domain_rejects_mail', 'no_mail_server'],
    ['execution_error'],
  ),
});

export const CONTACT_CHECK_REASONS = checkReasonsOf(CONTACT_CHECK_OUTCOMES);

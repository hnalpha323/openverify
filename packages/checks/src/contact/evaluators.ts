/**
 * The evaluator of every contact check of PLAN §4.3 (C56), by verification type: a function of
 * the type's shared context. `evaluatePhoneNumberChecks` and `evaluateEmailAddressChecks` run the
 * enabled ones.
 */
import type { CheckResult } from '@openverify/core';
import type { EmailAddressContext, PhoneNumberContext } from './context.js';
import { emailAddressDisposableDetection } from './email-address-disposable-detection.js';
import { emailAddressMxDetection } from './email-address-mx-detection.js';
import { emailAddressOtpComparison, phoneNumberOtpComparison } from './otp-comparison.js';

export type PhoneNumberEvaluator = (context: PhoneNumberContext) => CheckResult;
export type EmailAddressEvaluator = (context: EmailAddressContext) => CheckResult;

/** Every `phone_number` check, by id. */
export const PHONE_NUMBER_EVALUATORS = Object.freeze({
  phone_number_otp_comparison: phoneNumberOtpComparison,
}) satisfies Readonly<Record<string, PhoneNumberEvaluator>>;

/** Every `email_address` check, by id. */
export const EMAIL_ADDRESS_EVALUATORS = Object.freeze({
  email_address_otp_comparison: emailAddressOtpComparison,
  email_address_disposable_detection: emailAddressDisposableDetection,
  email_address_mx_detection: emailAddressMxDetection,
}) satisfies Readonly<Record<string, EmailAddressEvaluator>>;

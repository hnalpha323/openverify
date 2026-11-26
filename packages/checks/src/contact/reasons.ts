/**
 * The reasons each contact evaluator may emit (C51.2, C56): the C29.4 shared reasons its registry
 * inputs call for, then its C51.2 row. `CONTACT_CHECK_REASONS` in `@openverify/contracts` lists
 * the same; the API's contact job contract test asserts the two agree. No evaluator emits
 * `not_implemented`.
 */
const frozen = (...reasons: string[]): readonly string[] => Object.freeze(reasons);

const OTP = frozen(
  'input_missing',
  'otp_attempts_exhausted',
  'otp_not_confirmed',
  'otp_delivery_unavailable',
);

export const CONTACT_EVALUATOR_REASONS: Readonly<Record<string, readonly string[]>> = Object.freeze(
  {
    phone_number_otp_comparison: OTP,
    email_address_otp_comparison: OTP,
    email_address_disposable_detection: frozen(
      'input_missing',
      'disposable_domain',
      'list_unavailable',
    ),
    email_address_mx_detection: frozen(
      'input_missing',
      'execution_error',
      'provider_not_configured',
      'domain_not_found',
      'domain_rejects_mail',
      'no_mail_server',
    ),
  },
);

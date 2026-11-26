/**
 * C55: phone and email one-time codes, sent from the API process on the flow request. The code is
 * never stored, logged or returned: only an HMAC of it, under a key derived from the KEK.
 *
 * Every value here is provisional (decision 7): SP 800-63B-4 §3.1.3 and ASVS 5.0.0 V6.5/V6.6
 * give the code length and lifetime; the attempt, send and limit values are ours.
 */
import { z } from 'zod';
import { timestampSchema } from './json-api.js';

/** C55.2: six to ten digits (SP 800-63B-4 §3.1.3.2; ASVS 5.0.0 6.5.4), six by default. */
export const OTP_CODE_LENGTH = Object.freeze({ min: 6, max: 10, default: 6 });
/** C55.4: ten minutes (ASVS 6.5.5). */
export const OTP_CODE_TTL_SECONDS = 600;
/** C55.5: wrong tries that exhaust one code (`otp_code_exhausted`). */
export const OTP_MAX_ATTEMPTS_PER_CODE = 5;
/** C55.5: wrong entries across a verification's codes that submit it (`otp_attempts_exhausted`). */
export const OTP_MAX_WRONG_ENTRIES = 10;
/** C55.6: accepted sends per verification; an errored send does not count. */
export const OTP_MAX_SENDS = 5;
/** C55.6: the wait after sends 1 to 4 before the next (`otp_resend_too_soon`). */
export const OTP_RESEND_COOLDOWNS_SECONDS = Object.freeze([30, 60, 120, 240]);

/**
 * C55.7 (a C12 amendment): the OTP limits, a closed set outside `RATE_LIMIT_POLICIES`, each a
 * GCRA in Valkey that fails closed (503) when Valkey is down. Per environment; `otp-ip-hour` keys
 * on an IPv4 address or an IPv6 /64; `otp-sms-prefix-hour` on the first
 * {@link OTP_SMS_PREFIX_DIGITS} E.164 digits; `otp-sms-country-hour` takes at most half the
 * environment's `otp-sms-max-per-hour` per destination country, and applies only when the step
 * allows more than one country; `otp-sms-max-per-hour` is that whole budget per environment;
 * `otp-destination-guess-day` counts wrong codes per destination and channel.
 */
export const OTP_LIMIT_NAMES = [
  'otp-destination-hour',
  'otp-destination-day',
  'otp-ip-hour',
  'otp-inquiry-day',
  'otp-sms-prefix-hour',
  'otp-sms-country-hour',
  'otp-sms-max-per-hour',
  'otp-destination-guess-day',
] as const;
export const otpLimitNameSchema = z.enum(OTP_LIMIT_NAMES);
export type OtpLimitName = z.infer<typeof otpLimitNameSchema>;

const HOUR = 3600;
const DAY = 86_400;

export const OTP_LIMITS = Object.freeze({
  'otp-destination-hour': Object.freeze({ limit: 5, windowSeconds: HOUR }),
  'otp-destination-day': Object.freeze({ limit: 10, windowSeconds: DAY }),
  'otp-ip-hour': Object.freeze({ limit: 10, windowSeconds: HOUR }),
  'otp-inquiry-day': Object.freeze({ limit: 10, windowSeconds: DAY }),
  'otp-sms-prefix-hour': Object.freeze({ limit: 20, windowSeconds: HOUR }),
  'otp-sms-country-hour': Object.freeze({ budgetShare: 0.5, windowSeconds: HOUR }),
  'otp-sms-max-per-hour': Object.freeze({ budgetShare: 1, windowSeconds: HOUR }),
  'otp-destination-guess-day': Object.freeze({ limit: 20, windowSeconds: DAY }),
} as const satisfies Record<
  OtpLimitName,
  { windowSeconds: number } & ({ limit: number } | { budgetShare: number })
>);

/** C55.7: the leading E.164 digits `otp-sms-prefix-hour` keys on. */
export const OTP_SMS_PREFIX_DIGITS = 8;

/**
 * C55.7 (V08): the environment setting `otp-sms-max-per-hour`, at least 1 and at most the install
 * ceiling `OPENVERIFY_OTP_SMS_MAX_PER_HOUR_CEILING` (default {@link ceilingDefault}), itself at
 * most `max`.
 */
export const OTP_SMS_MAX_PER_HOUR = Object.freeze({
  min: 1,
  default: 200,
  ceilingDefault: 1000,
  max: 1_000_000,
});
export const otpSmsMaxPerHourSchema = z
  .int()
  .min(OTP_SMS_MAX_PER_HOUR.min)
  .max(OTP_SMS_MAX_PER_HOUR.max);

/** C55.7: the audit action written, at most once an hour, when the environment budget trips. */
export const OTP_SMS_BUDGET_TRIPPED_AUDIT_ACTION = 'environment.otp-sms-budget-tripped';

/** C55.10: the sandbox SMS sink keeps at most this many codes per environment, this long. */
export const SANDBOX_SMS_SINK = Object.freeze({ maxEntries: 100, ttlSeconds: 900 });

/** C55.3: the HKDF info of the code key, and the prefix of the HMAC input. */
export const OTP_KEY_INFO = 'openverify/otp/v1';
export const OTP_HMAC_PREFIX = 'otp/v1|';

/** A code as the user types it: six to ten digits. */
export const otpCodeSchema = z.string().regex(/^[0-9]{6,10}$/, 'must be six to ten digits');

/**
 * `POST /api/v1/flow/verifications/:id/otp`: where to send the code, the phone number for a
 * phone verification or the email address for an email one. The server validates the
 * destination (C55.8) before anything is sent; bounds here only cap the input.
 */
export const flowOtpSendBodySchema = z.union([
  z.strictObject({ 'phone-number': z.string().min(1).max(32) }),
  z.strictObject({ 'email-address': z.string().min(3).max(254) }),
]);
export type FlowOtpSendBody = z.infer<typeof flowOtpSendBodySchema>;

/**
 * `POST /api/v1/flow/verifications/:id/otp/confirm`. The member is named `code`, so stored API
 * logs redact it (`API_LOG_REDACTED_KEYS`).
 */
export const flowOtpConfirmBodySchema = z.strictObject({ code: otpCodeSchema });
export type FlowOtpConfirmBody = z.infer<typeof flowOtpConfirmBodySchema>;

/**
 * C55.11 `POST /api/v1/sandbox/sms-messages/search` (scope `sandbox:read`, sandbox only): the
 * number goes in the body, never in a URL.
 */
export const sandboxSmsSearchBodySchema = z.strictObject({
  'phone-number': z.string().min(1).max(32),
});

/** The codes sent to that number, newest first; `code` is redacted in stored API logs. */
export const sandboxSmsSearchResponseSchema = z.strictObject({
  data: z.array(z.strictObject({ code: otpCodeSchema, 'sent-at': timestampSchema })),
});
export type SandboxSmsSearchResponse = z.infer<typeof sandboxSmsSearchResponseSchema>;

/**
 * Test builders of the contact checks (C56): synthetic destinations at reserved names, OTP states
 * and templates. Never imported by runtime code.
 */
import type { CheckId, VerificationTemplateConfig } from '@openverify/core';
import type {
  DisposableDomainList,
  EmailAddressCheckInput,
  OtpCheckState,
  PhoneNumberCheckInput,
} from './inputs.js';

/** A synthetic US number in the 555-01xx range. */
export const TEST_PHONE_NUMBER = '+12025550100';
/** A synthetic address at an RFC 2606 name. */
export const TEST_EMAIL_ADDRESS = 'ada.lovelace@mail.example.org';

export const SANDBOX_SMS_SENDER = Object.freeze({ id: 'sandbox', sandbox: true });
export const SMTP_SENDER = Object.freeze({ id: 'smtp', sandbox: false });

/** The list file's identity as `api-otp` records it. */
export const TEST_DISPOSABLE_LIST_SOURCE = Object.freeze({
  id: 'disposable-email-domains@6fcca80',
  sha256: 'e3bd73552549f2fef7997b4892909835907f0045742a06d961bc9af8d7380f79',
});

export function disposableList(domains: readonly string[]): DisposableDomainList {
  return { domains: new Set(domains), source: TEST_DISPOSABLE_LIST_SOURCE };
}

/** A confirmed first code: one send, no wrong entry, no limit. */
export function otpState(overrides: Partial<OtpCheckState> = {}): OtpCheckState {
  return {
    confirmed: true,
    sends: 1,
    wrongEntries: 0,
    maxWrongEntries: 10,
    limitedReason: null,
    ...overrides,
  };
}

export function phoneInput(overrides: Partial<PhoneNumberCheckInput> = {}): PhoneNumberCheckInput {
  return {
    phoneNumber: TEST_PHONE_NUMBER,
    otp: otpState(),
    sender: SANDBOX_SMS_SENDER,
    ...overrides,
  };
}

export function emailInput(
  overrides: Partial<EmailAddressCheckInput> = {},
): EmailAddressCheckInput {
  return {
    emailAddress: TEST_EMAIL_ADDRESS,
    otp: otpState(),
    sender: SMTP_SENDER,
    disposableList: disposableList(['trash.example']),
    mx: {
      kind: 'result',
      provider: { id: 'dns', sandbox: false },
      result: { kind: 'mx', exchanges: ['mx1.mail.example.org'] },
    },
    environment: 'production',
    ...overrides,
  };
}

/** Every listed check enabled and required, in that order, with optional per-check config. */
export function templateOf(
  checks: readonly CheckId[],
  config: Partial<Record<CheckId, Record<string, unknown>>> = {},
): VerificationTemplateConfig {
  return {
    checks: Object.fromEntries(
      checks.map((id) => [
        id,
        {
          enabled: true,
          required: true,
          ...(config[id] === undefined ? {} : { config: config[id] }),
        },
      ]),
    ),
  };
}

export const PHONE_CHECKS: readonly CheckId[] = ['phone_number_otp_comparison'];
export const EMAIL_CHECKS: readonly CheckId[] = [
  'email_address_otp_comparison',
  'email_address_disposable_detection',
  'email_address_mx_detection',
];

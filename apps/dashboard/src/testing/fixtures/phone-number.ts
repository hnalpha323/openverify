/**
 * Synthetic phone number verifications for the console's tests (C55, C56, C66), built on the
 * golden fixture (`contracts/fixtures/api/verification-phone-number.json` through
 * `phase5Verification`). The number is in the NANP 555-01xx range kept for fiction; every other
 * value is invented.
 */
import type { VerificationCheck } from '@openverify/contracts';
import type { PhoneNumberVerification } from '../../lib/otp-evidence';
import { phase5Verification } from '../phase5-fixtures';

/** The golden fixture's number. */
export const PHONE_NUMBER = '+15555550100';
/** The golden fixture's confirmation time. */
export const PHONE_CONFIRMED_AT = '2026-10-20T12:05:20.000Z';

/** `phone_number_otp_comparison` as the evaluator writes it (C56), passed, with `overrides`. */
export function phoneComparison(overrides: Partial<VerificationCheck> = {}): VerificationCheck {
  return {
    name: 'phone_number_otp_comparison',
    status: 'passed',
    reasons: [],
    requirement: 'required',
    metadata: { channel: 'sms', sends: 2, 'failed-attempts': 1 },
    stage: 'ga',
    confidence: null,
    provenance: {
      'implementation-version': 1,
      provider: { id: 'sandbox', sandbox: true },
      thresholds: {},
    },
    category: 'user_action_required',
    ...overrides,
  };
}

export interface PhoneNumberFixtureOptions {
  readonly id?: string;
  /** Replaces the golden's status, checks and type attributes, member by member. */
  readonly attributes?: Partial<PhoneNumberVerification['attributes']>;
  /** As the API serves it to an operator without `pii:view`, or after a redaction. */
  readonly masked?: boolean;
}

/** The golden phone number verification (passed), with `attributes` over it. */
export function phoneNumberVerification(
  options: PhoneNumberFixtureOptions = {},
): PhoneNumberVerification {
  const golden = phase5Verification('verification/phone-number');
  const verification = phase5Verification('verification/phone-number', {
    ...(options.id === undefined ? {} : { id: options.id }),
    masked: options.masked ?? false,
    attributes: { ...golden.attributes, ...options.attributes },
  });
  if (verification.type !== 'verification/phone-number') {
    throw new Error('The phone number fixture is of another type');
  }
  return verification;
}

/**
 * C55.6: a limit refused the user (the environment's budget), who continued without a code, so
 * the comparison answers `otp_delivery_unavailable` and the verification went to review.
 */
export function limitedPhoneNumberVerification(
  options: Omit<PhoneNumberFixtureOptions, 'attributes'> = {},
): PhoneNumberVerification {
  return phoneNumberVerification({
    ...options,
    attributes: {
      status: 'needs_review',
      'confirmed-at': null,
      sends: 1,
      'failed-attempts': 0,
      checks: [
        phoneComparison({
          status: 'not_applicable',
          reasons: ['otp_delivery_unavailable'],
          metadata: {
            channel: 'sms',
            sends: 1,
            'failed-attempts': 0,
            'limited-reason': 'environment',
          },
        }),
      ],
    },
  });
}

/** A code was sent and none confirmed yet: no check has run. */
export function initiatedPhoneNumberVerification(): PhoneNumberVerification {
  return phoneNumberVerification({
    attributes: {
      status: 'initiated',
      'confirmed-at': null,
      sends: 1,
      'failed-attempts': 0,
      checks: [],
    },
  });
}

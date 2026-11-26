/**
 * Synthetic email address verifications for the console's tests (C55, C56, C66), built on the
 * golden fixture (`contracts/fixtures/api/verification-email-address.json` through
 * `phase5Verification`), with the domain checks' metadata as the evaluators write it (C56). The
 * addresses are under `example.test`, a name reserved for tests.
 */
import type { VerificationCheck } from '@openverify/contracts';
import type { EmailAddressVerification } from '../../lib/otp-evidence';
import { phase5Verification } from '../phase5-fixtures';

/** The golden fixture's address. */
export const EMAIL_ADDRESS = 'avery@example.test';

const PROVENANCE = { 'implementation-version': 1, thresholds: {} };

/** `email_address_otp_comparison` as the evaluator writes it (C56), passed, with `overrides`. */
export function emailComparison(overrides: Partial<VerificationCheck> = {}): VerificationCheck {
  return {
    name: 'email_address_otp_comparison',
    status: 'passed',
    reasons: [],
    requirement: 'required',
    metadata: { channel: 'email', sends: 1, 'failed-attempts': 0 },
    stage: 'ga',
    confidence: null,
    provenance: { ...PROVENANCE, provider: { id: 'smtp', sandbox: false } },
    category: 'user_action_required',
    ...overrides,
  };
}

/** `email_address_disposable_detection`, advisory, passed on no list, with `overrides`. */
export function disposableCheck(overrides: Partial<VerificationCheck> = {}): VerificationCheck {
  return {
    name: 'email_address_disposable_detection',
    status: 'passed',
    reasons: [],
    requirement: 'not_required',
    metadata: { match: 'none' },
    stage: 'ga',
    confidence: null,
    provenance: {
      'implementation-version': 1,
      thresholds: { 'allow-domains': [], 'deny-domains': [] },
    },
    category: 'fraud',
    ...overrides,
  };
}

/** `email_address_mx_detection`, advisory, passed on MX records, with `overrides`. */
export function mxCheck(overrides: Partial<VerificationCheck> = {}): VerificationCheck {
  return {
    name: 'email_address_mx_detection',
    status: 'passed',
    reasons: [],
    requirement: 'not_required',
    metadata: { route: 'mx', 'record-count': 2 },
    stage: 'ga',
    confidence: null,
    provenance: PROVENANCE,
    category: 'user_action_required',
    ...overrides,
  };
}

export interface EmailAddressFixtureOptions {
  readonly id?: string;
  /** Replaces the golden's status, checks and type attributes, member by member. */
  readonly attributes?: Partial<EmailAddressVerification['attributes']>;
  /** As the API serves it to an operator without `pii:view`, or after a redaction. */
  readonly masked?: boolean;
}

/**
 * The golden email address verification (passed), its domain checks as the evaluators write
 * them, with `attributes` over it.
 */
export function emailAddressVerification(
  options: EmailAddressFixtureOptions = {},
): EmailAddressVerification {
  const golden = phase5Verification('verification/email-address');
  const verification = phase5Verification('verification/email-address', {
    ...(options.id === undefined ? {} : { id: options.id }),
    masked: options.masked ?? false,
    attributes: {
      ...golden.attributes,
      checks: [emailComparison(), disposableCheck(), mxCheck()],
      ...options.attributes,
    },
  });
  if (verification.type !== 'verification/email-address') {
    throw new Error('The email address fixture is of another type');
  }
  return verification;
}

/**
 * C56: the address's own domain is on the template's deny list, so the advisory disposable check
 * failed, while the required code comparison passed and so did the verification; the domain is a
 * reserved sandbox name, so the MX check made no DNS query.
 */
export function deniedDomainEmailAddressVerification(
  options: Omit<EmailAddressFixtureOptions, 'attributes'> = {},
): EmailAddressVerification {
  return emailAddressVerification({
    ...options,
    attributes: {
      checks: [
        emailComparison(),
        disposableCheck({
          status: 'failed',
          reasons: ['disposable_domain'],
          metadata: { match: 'denied', 'match-depth': 0 },
        }),
        mxCheck({ metadata: { route: 'reserved' } }),
      ],
    },
  });
}

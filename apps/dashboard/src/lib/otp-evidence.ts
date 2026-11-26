/**
 * The phone and email evidence as the console shows it (C52.8, C55, C66), read from the
 * verification answer only: the destination (PII, exactly as the API masked it for this
 * operator), when the code was confirmed, the accepted sends and the wrong entries, and from the
 * OTP comparison the channel and the limit that refused the user. Metadata is `unknown` in the
 * contract, so a value of the wrong shape counts as not recorded.
 */
import type { VerificationCheck, VerificationResource } from '@openverify/contracts';
import type { CheckProvider } from '@openverify/core';

export type PhoneNumberVerification = Extract<
  VerificationResource,
  { type: 'verification/phone-number' }
>;
export type EmailAddressVerification = Extract<
  VerificationResource,
  { type: 'verification/email-address' }
>;

export interface OtpEvidence {
  /** The phone number or email address as the API sent it: `null` when masked or redacted. */
  readonly destination: string | null;
  /** When the code was accepted; `null` until then, `undefined` when the API did not say. */
  readonly confirmedAt: string | null | undefined;
  /** Accepted sends (an errored send does not count). */
  readonly sends: number | null;
  /** Wrong entries across the verification's codes (C55.5). */
  readonly failedAttempts: number | null;
  /** The OTP comparison's `channel`, or `null` before it ran. */
  readonly channel: string | null;
  /** The limit that refused the user (C55.6 `limited-reason`), or `null`. */
  readonly limitedReason: string | null;
  /** The sender the OTP comparison's provenance names (C56), or `null` before it ran. */
  readonly sender: CheckProvider | null;
}

const COMPARISONS: ReadonlySet<string> = new Set([
  'phone_number_otp_comparison',
  'email_address_otp_comparison',
]);

/** A non-empty string member of `metadata`, else `null`. */
export function metadataString(
  metadata: VerificationCheck['metadata'] | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

export function otpEvidenceOf(
  verification: PhoneNumberVerification | EmailAddressVerification,
): OtpEvidence {
  const { attributes } = verification;
  const destination =
    verification.type === 'verification/phone-number'
      ? verification.attributes['phone-number']
      : verification.attributes['email-address'];
  const comparison = attributes.checks.find((check) => COMPARISONS.has(check.name));
  const metadata = comparison?.metadata;
  return {
    destination: destination ?? null,
    confirmedAt: attributes['confirmed-at'],
    sends: attributes.sends ?? null,
    failedAttempts: attributes['failed-attempts'] ?? null,
    channel: metadataString(metadata, 'channel'),
    limitedReason: metadataString(metadata, 'limited-reason'),
    sender: comparison?.provenance?.provider ?? null,
  };
}

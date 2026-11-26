import type { FlowVerificationResource } from '@openverify/contracts';

/** The open code of a phone or email verification (C52.2 `guidance.otp`), never the code. */
export interface OpenCode {
  /** The destination with most characters hidden, so the user can spot a typo. */
  readonly maskedDestination: string;
  /** Milliseconds since the epoch. */
  readonly expiresAt: number;
  /** When the next code may be asked for; `null` once no send is left. */
  readonly resendAt: number | null;
  readonly sendsRemaining: number;
  readonly attemptsRemaining: number;
}

export interface CodeGuidance {
  /** The code's length (C55.2), when the server said. */
  readonly codeLength: number | null;
  readonly openCode: OpenCode | null;
}

/** The guidance of a phone or email verification; nothing for any other resource. */
export function codeGuidanceOf(verification: FlowVerificationResource | undefined): CodeGuidance {
  if (
    verification?.type !== 'verification/phone-number' &&
    verification?.type !== 'verification/email-address'
  ) {
    return { codeLength: null, openCode: null };
  }
  const guidance = verification.attributes.guidance;
  const otp = guidance?.otp ?? null;
  return {
    codeLength: guidance?.['code-length'] ?? null,
    openCode:
      otp === null
        ? null
        : {
            maskedDestination: otp['masked-destination'],
            expiresAt: Date.parse(otp['expires-at']),
            resendAt:
              otp['resend-available-at'] === null ? null : Date.parse(otp['resend-available-at']),
            sendsRemaining: otp['sends-remaining'],
            attemptsRemaining: otp['attempts-remaining'],
          },
  };
}

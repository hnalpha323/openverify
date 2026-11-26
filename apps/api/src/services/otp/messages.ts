/**
 * C55.9: the code's message, in English or Spanish (the language of the consent the user gave).
 * SMS: `"<org>: <code> is your verification code. Do not share it.\n\n@<flow host> #<code>"`, the
 * last line in the origin-bound one-time code format; email: subject `"<org> verification code"`,
 * plain text, no links. `<org>` is the organization name as `sanitizeOrganizationName` leaves it
 * (no control characters, `@`, `#`, URLs or runs of four or more digits, at most 40 characters);
 * `<flow host>` comes from `OPENVERIFY_FLOW_PUBLIC_URL`, never from a request's `Host` or
 * `Origin`.
 */
import { sanitizeOrganizationName } from '@openverify/checks';
import { OTP_CODE_TTL_SECONDS } from '@openverify/contracts';

/** The languages the messages are written in. */
export const OTP_MESSAGE_LOCALES = ['en', 'es'] as const;
export type OtpMessageLocale = (typeof OTP_MESSAGE_LOCALES)[number];

export interface OtpMessageInput {
  /** The organization's name as stored; sanitized here. */
  organizationName: string;
  code: string;
  locale: OtpMessageLocale;
}

const MINUTES = OTP_CODE_TTL_SECONDS / 60;

/** The language of a consent's locale (`es`, `es-MX`, …); English otherwise. */
export function otpMessageLocale(consentLocale: string | null | undefined): OtpMessageLocale {
  const language = consentLocale?.split('-')[0]?.toLowerCase();
  return language === 'es' ? 'es' : 'en';
}

/** The host of the flow's public URL, as the origin-bound line names it (with a port, if any). */
export function flowHostOf(flowPublicUrl: string): string {
  return new URL(flowPublicUrl).host;
}

/** The SMS text (C55.9). */
export function otpSmsBody(input: OtpMessageInput & { flowHost: string }): string {
  const name = sanitizeOrganizationName(input.organizationName);
  const prefix = name === '' ? '' : `${name}: `;
  const sentence =
    input.locale === 'es'
      ? `${input.code} es tu código de verificación. No lo compartas.`
      : `${input.code} is your verification code. Do not share it.`;
  return `${prefix}${sentence}\n\n@${input.flowHost} #${input.code}`;
}

/** The email (C55.9): plain text, no links. */
export function otpEmailMessage(input: OtpMessageInput): { subject: string; text: string } {
  const name = sanitizeOrganizationName(input.organizationName);
  if (input.locale === 'es') {
    return {
      subject: name === '' ? 'Código de verificación' : `Código de verificación de ${name}`,
      text:
        `Tu código de verificación es ${input.code}.\n\n` +
        `Caduca en ${String(MINUTES)} minutos. No lo compartas con nadie.\n\n` +
        'Si no lo pediste, puedes ignorar este correo.\n',
    };
  }
  return {
    subject: name === '' ? 'Verification code' : `${name} verification code`,
    text:
      `Your verification code is ${input.code}.\n\n` +
      `It expires in ${String(MINUTES)} minutes. Do not share it with anyone.\n\n` +
      'If you did not ask for it, you can ignore this email.\n',
  };
}

/**
 * C96.3, C96.5 (Workflow 7A): the email and SMS that carry a handoff link to the phone, in English
 * or Spanish (the language of the issuing session's consent). Each names the organisation (as
 * `sanitizeOrganizationName` leaves it), says the link works once and when it expires, and advises
 * what the context screen advises: use it only right after asking for it on the organisation's
 * own site (RFC 10027 §6.1.14). The confirmation code, when the step asks for one, is never in the
 * message: it is shown on the desktop only (C96.5).
 */
import { sanitizeOrganizationName } from '@openverify/checks';
import type { OtpMessageLocale } from '../otp/messages.js';

export interface HandoffMessageInput {
  organizationName: string;
  /** The whole link, the token in its fragment. */
  link: string;
  /** Whole minutes until the token expires (at least 1). */
  minutes: number;
  locale: OtpMessageLocale;
}

/** The email: plain text with the one link. */
export function handoffEmailMessage(input: HandoffMessageInput): { subject: string; text: string } {
  const name = sanitizeOrganizationName(input.organizationName);
  const minutes = String(input.minutes);
  if (input.locale === 'es') {
    return {
      subject: name === '' ? 'Continúa tu verificación' : `Continúa tu verificación con ${name}`,
      text:
        'Abre este enlace en tu teléfono para continuar tu verificación:\n\n' +
        `${input.link}\n\n` +
        `El enlace funciona una sola vez y caduca en ${minutes} minutos. Úsalo solo si acabas de ` +
        'pedirlo en el sitio de la organización. Si no lo pediste, ignora este correo.\n',
    };
  }
  return {
    subject: name === '' ? 'Continue your verification' : `Continue your verification with ${name}`,
    text:
      'Open this link on your phone to continue your verification:\n\n' +
      `${input.link}\n\n` +
      `The link works once and expires in ${minutes} minutes. Use it only if you just asked for ` +
      "it on the organization's own site. If you did not, ignore this email.\n",
  };
}

/** The SMS: the organisation, the link, its lifetime and the advice. */
export function handoffSmsBody(input: HandoffMessageInput): string {
  const name = sanitizeOrganizationName(input.organizationName);
  const prefix = name === '' ? '' : `${name}: `;
  const minutes = String(input.minutes);
  return input.locale === 'es'
    ? `${prefix}continúa tu verificación en tu teléfono: ${input.link} (caduca en ${minutes} min). ` +
        'Ignóralo si no lo pediste.'
    : `${prefix}continue your verification on your phone: ${input.link} (expires in ${minutes} ` +
        'min). Ignore this if you did not ask for it.';
}

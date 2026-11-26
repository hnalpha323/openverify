/**
 * The C15 invitation email. The `ovi_` token travels in the URL fragment of the dashboard's
 * acceptance page, so it never reaches a server log or a `Referer` header.
 */
import { safeUrl } from '@openverify/contracts';
import type { MailMessage } from '../ports.js';

const ACCEPT_PATH = 'accept-invitation';

/** `${OPENVERIFY_DASHBOARD_PUBLIC_URL}/accept-invitation#token=ovi_...`. */
export function invitationAcceptUrl(dashboardPublicUrl: string, token: string): string {
  return `${dashboardPublicUrl.replace(/\/+$/, '')}/${ACCEPT_PATH}#token=${token}`;
}

/** The token of an acceptance URL, or `null` (tests read it back from captured email). */
export function invitationTokenFromUrl(url: string): string | null {
  const parsed = safeUrl(url);
  if (parsed === null) {
    return null;
  }
  return new URLSearchParams(parsed.hash.slice(1)).get('token');
}

export interface InvitationEmailInput {
  to: string;
  organizationName: string;
  acceptUrl: string;
  expiresAt: Date;
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);

/** `2026-10-27 12:00 UTC`: unambiguous for every reader, whatever their locale. */
const utcMinute = (date: Date): string =>
  `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC`;

/** The invitation message: a plain text part and an equivalent HTML part. */
export function invitationEmail(input: InvitationEmailInput): MailMessage {
  const expires = utcMinute(input.expiresAt);
  const text = [
    `You have been invited to join ${input.organizationName} on OpenVerify.`,
    '',
    'Choose your name and password here. The link works once and expires on ' + `${expires}:`,
    input.acceptUrl,
    '',
    'If you did not expect this invitation, you can ignore this email.',
  ].join('\n');
  const organization = escapeHtml(input.organizationName);
  const href = escapeHtml(input.acceptUrl);
  const html = [
    `<p>You have been invited to join <strong>${organization}</strong> on OpenVerify.</p>`,
    `<p><a href="${href}">Accept the invitation</a></p>`,
    `<p>The link works once and expires on ${expires}.</p>`,
    '<p>If you did not expect this invitation, you can ignore this email.</p>',
  ].join('\n');
  return {
    to: { address: input.to },
    subject: `You are invited to ${input.organizationName} on OpenVerify`,
    text,
    html,
  };
}

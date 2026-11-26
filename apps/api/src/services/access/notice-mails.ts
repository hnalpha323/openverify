/**
 * C168.3 (Phase 9, Workflow 9B; decision 46): the notice a user is sent when an administrator resets
 * its second factors. It holds a link to the console's sign-in page only: no code, token or secret,
 * and nothing about who did it beyond the organisation (a reactivation sends the invitation email,
 * whose link is the invitation itself).
 */
import type { MailMessage } from '../../ports.js';

const SIGN_IN_PATH = 'login';

/** `${OPENVERIFY_DASHBOARD_PUBLIC_URL}/login`. */
export function consoleSignInUrl(dashboardPublicUrl: string): string {
  return `${dashboardPublicUrl.replace(/\/+$/, '')}/${SIGN_IN_PATH}`;
}

export interface MfaResetNoticeInput {
  to: string;
  organizationName: string;
  signInUrl: string;
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

/** The reset notice: a plain text part and an equivalent HTML part. */
export function mfaResetNoticeEmail(input: MfaResetNoticeInput): MailMessage {
  const text = [
    `An administrator of ${input.organizationName} reset the second factors of your OpenVerify account.`,
    'Your sessions were signed out. Sign in here to set up a new factor:',
    input.signInUrl,
    '',
    'If you did not expect this, tell an administrator of your organization.',
  ].join('\n');
  const html = [
    `<p>An administrator of <strong>${escapeHtml(input.organizationName)}</strong> reset the second factors of your OpenVerify account.</p>`,
    '<p>Your sessions were signed out.</p>',
    `<p><a href="${escapeHtml(input.signInUrl)}">Sign in to set up a new factor</a></p>`,
    '<p>If you did not expect this, tell an administrator of your organization.</p>',
  ].join('\n');
  return {
    to: { address: input.to },
    subject: 'Your OpenVerify second factors were reset',
    text,
    html,
  };
}

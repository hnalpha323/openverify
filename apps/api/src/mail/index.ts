/**
 * Outgoing email (C15 invitations): SMTP through `nodemailer`, configured by
 * `OPENVERIFY_SMTP_URL` (`smtp://` or `smtps://`, credentials in the URL) and
 * `OPENVERIFY_MAIL_FROM`. Development sends to Mailpit (`smtp://127.0.0.1:1025`); tests use
 * the capturing fake in `test-support/fakes.ts`.
 */
import { safeUrl } from '@openverify/contracts';
import { createTransport } from 'nodemailer';
import type { Mailer } from '../ports.js';
import { formatSender } from './sender-name.js';

export { invitationAcceptUrl, invitationEmail, invitationTokenFromUrl } from './invitation.js';

export interface MailerOptions {
  /** `OPENVERIFY_SMTP_URL`. Without it every send rejects with {@link MailerNotConfiguredError}. */
  smtpUrl: string | undefined;
  /** `OPENVERIFY_MAIL_FROM`, e.g. `OpenVerify <no-reply@example.com>`. */
  from: string;
  /** Connection, greeting and socket timeout. Defaults to 10 seconds. */
  timeoutMs?: number;
}

/** Sending was asked for, but the deployment configured no SMTP server. */
export class MailerNotConfiguredError extends Error {
  override name = 'MailerNotConfiguredError';

  constructor() {
    super('Email is not configured: set OPENVERIFY_SMTP_URL');
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;
const SMTP_PROTOCOLS = ['smtp:', 'smtps:'];

/**
 * The SMTP mailer. Each message opens its own connection, so a broken connection never
 * outlives one invitation.
 * @throws {RangeError} when `smtpUrl` is not an `smtp://` or `smtps://` URL.
 */
export function createMailer(options: MailerOptions): Mailer {
  const { smtpUrl, from } = options;
  if (smtpUrl === undefined) {
    return { configured: false, send: () => Promise.reject(new MailerNotConfiguredError()) };
  }
  const url = safeUrl(smtpUrl);
  if (url === null || !SMTP_PROTOCOLS.includes(url.protocol)) {
    throw new RangeError('OPENVERIFY_SMTP_URL must be an smtp:// or smtps:// URL');
  }
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const transport = createTransport({
    url: smtpUrl,
    connectionTimeout: timeout,
    greetingTimeout: timeout,
    socketTimeout: timeout,
  });
  return {
    configured: true,
    async send(message) {
      await transport.sendMail({
        // C169.8 (Workflow 9B Stage 1b (W); contracts B33): the sender name before the install-wide
        // address (`formatSender`, `api-keys-webhooks`).
        from: formatSender(message.senderName ?? null, from),
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html === undefined ? {} : { html: message.html }),
      });
    },
  };
}

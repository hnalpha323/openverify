/**
 * C169.8 (S24; ours; Workflow 9B; review P29): the From header of a message. `mail-sender-name` is a
 * display name only (`mailSenderNameSchema`: control characters, `<`, `>`, `@` and `"` refused), put
 * before the install-wide address of `OPENVERIFY_MAIL_FROM` (Phase 8 decision 37), encoded with RFC 2047
 * when it is not ASCII and quoted under RFC 5322 on every send.
 *
 * The hook site is `createMailer`'s send (`mail/index.ts`), which `foundation-9b` (W) placed with
 * `MailMessage.senderName` (contracts B33). Owner: `api-keys-webhooks`.
 *
 * What this answers is an RFC 5322 mailbox, `"<name>" <address>`, with the name as a quoted string
 * (`\` and `"` escaped; `"` never passes the grammar). nodemailer reads it back as a name and an
 * address and writes the header itself: a non-ASCII name as RFC 2047 encoded words, an ASCII one with
 * specials as a quoted string. An encoded word written here would not survive that (nodemailer would
 * quote it, and RFC 2047 forbids an encoded word inside quotes), so the encoding is left to it; the
 * tests render each case through nodemailer's composer and read the header back.
 *
 * Fail closed: a name the grammar refuses, one holding a Unicode format character (a bidi override
 * can reorder what a reader sees) or an encoded word of its own (`=?`, which some clients decode even
 * inside quotes, into an address) keeps the install-wide From as it is.
 */
import { mailSenderNameSchema, resolvePlatformSettings } from '@openverify/contracts';
import type { MailMessage } from '../ports.js';

/** The `from` to send with: `from` is `OPENVERIFY_MAIL_FROM`, `name` the message's sender name. */
export type FormatSender = (name: string | null, from: string) => string;

/** Names the send refuses beyond the grammar: format characters and encoded words. */
const REFUSED_AT_SEND = /\p{Cf}|=\?/u;

/** The address of `OPENVERIFY_MAIL_FROM`: inside its last `<...>`, or the whole value. */
function addressOf(from: string): string {
  const trimmed = from.trim();
  const open = trimmed.lastIndexOf('<');
  return trimmed.endsWith('>') && open >= 0 ? trimmed.slice(open + 1, -1).trim() : trimmed;
}

/** An RFC 5322 quoted string. */
const quoted = (text: string): string =>
  `"${text.replace(/[\\"]/g, (character) => `\\${character}`)}"`;

export const formatSender: FormatSender = (name, from) => {
  if (name === null) {
    return from;
  }
  const parsed = mailSenderNameSchema.safeParse(name);
  if (!parsed.success || REFUSED_AT_SEND.test(parsed.data)) {
    return from;
  }
  return `${quoted(parsed.data)} <${addressOf(from)}>`;
};

/**
 * K9-25 (C169.8): `message` sent from the environment whose `settings` are given, with that
 * environment's `mail-sender-name`; the member is left out when the environment names none, so the
 * install-wide From goes as it is. Every per-environment sender passes its message through this.
 */
export function fromEnvironment<Message extends MailMessage>(
  message: Message,
  settings: Readonly<Record<string, unknown>> | null | undefined,
): Message {
  const name = resolvePlatformSettings(settings ?? {})['mail-sender-name'];
  return name === null ? message : { ...message, senderName: name };
}

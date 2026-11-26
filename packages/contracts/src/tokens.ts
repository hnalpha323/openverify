/**
 * Bearer tokens and secrets (contracts C1, C5 and C9). Each is a fixed prefix plus 256 random
 * bits in unpadded base64url (43 characters). Servers store only a SHA-256 hash of tokens and
 * compare in constant time; webhook secrets are returned once and afterwards shown only by
 * their last four characters.
 */
import { z } from 'zod';
import { randomBytesOf, webCryptoRandomBytes, type RandomBytes } from './ids.js';

export const SESSION_TOKEN_PREFIX = 'ovs_';
export const USER_SESSION_TOKEN_PREFIX = 'ovu_';
export const WEBHOOK_SECRET_PREFIX = 'wbhsec_';
/** Single-use one-time link token (C9, C10). */
export const ONE_TIME_LINK_TOKEN_PREFIX = 'ovo_';
/** Single-use MFA challenge token, issued after a correct password when MFA is on (C9, C15). */
export const MFA_TOKEN_PREFIX = 'ovm_';
/** Single-use invitation token (C9, C15). */
export const INVITATION_TOKEN_PREFIX = 'ovi_';
/**
 * Single-use device handoff token (C96.2, ours): bound to the inquiry and to the issuing session,
 * stored as SHA-256 only, never a C10 one-time link (issuing one revokes nothing else).
 */
export const HANDOFF_TOKEN_PREFIX = 'ovh_';
/**
 * C96.1 (H27, ours): a QR handoff token lives `qr-ttl-seconds` (2 to 15 minutes, 5 by default), an
 * email or SMS one `link-ttl-seconds` (5 to 60 minutes, 15 by default), never past the inquiry's
 * `expires-at`. Shorter than the public product's hour, for the phishing reason of C96.6.
 */
export const HANDOFF_QR_TTL_SECONDS = Object.freeze({ min: 120, max: 900, default: 300 });
export const HANDOFF_LINK_TTL_SECONDS = Object.freeze({ min: 300, max: 3600, default: 900 });

/** Hosted flow and Android session tokens expire after 24 hours. */
export const SESSION_TOKEN_TTL_SECONDS = 24 * 60 * 60;
/** Dashboard user session tokens expire after 12 hours. */
export const USER_SESSION_TOKEN_TTL_SECONDS = 12 * 60 * 60;
/**
 * One-time links live 24 hours by default (the template's `one-time-link-expiration-seconds`),
 * between 5 minutes and 30 days, and never past the inquiry's `expires-at`.
 */
export const ONE_TIME_LINK_DEFAULT_TTL_SECONDS = 24 * 60 * 60;
export const ONE_TIME_LINK_MIN_TTL_SECONDS = 5 * 60;
export const ONE_TIME_LINK_MAX_TTL_SECONDS = 30 * 24 * 60 * 60;
/** An MFA challenge token lives 5 minutes. */
export const MFA_TOKEN_TTL_SECONDS = 5 * 60;
/** Five wrong codes revoke the MFA challenge token. */
export const MFA_MAX_FAILED_ATTEMPTS = 5;
/** An invitation lives 7 days. */
export const INVITATION_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

const TOKEN_BYTES = 32;
const TOKEN_BODY = '[A-Za-z0-9_-]{43}';

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Unpadded base64url (RFC 4648 §5). */
export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += BASE64URL.charAt((buffer >> bits) & 63);
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) {
    out += BASE64URL.charAt((buffer << (6 - bits)) & 63);
  }
  return out;
}

function tokenSchema(prefix: string, label: string) {
  return z.string().regex(new RegExp(`^${prefix}${TOKEN_BODY}$`), `must be ${label}`);
}

export const sessionTokenSchema = tokenSchema(SESSION_TOKEN_PREFIX, 'an ovs_ session token');
export const userSessionTokenSchema = tokenSchema(
  USER_SESSION_TOKEN_PREFIX,
  'an ovu_ user session token',
);
export const webhookSecretSchema = tokenSchema(WEBHOOK_SECRET_PREFIX, 'a wbhsec_ webhook secret');
export const oneTimeLinkTokenSchema = tokenSchema(
  ONE_TIME_LINK_TOKEN_PREFIX,
  'an ovo_ one-time link token',
);
export const mfaTokenSchema = tokenSchema(MFA_TOKEN_PREFIX, 'an ovm_ MFA challenge token');
export const invitationTokenSchema = tokenSchema(
  INVITATION_TOKEN_PREFIX,
  'an ovi_ invitation token',
);
export const handoffTokenSchema = tokenSchema(HANDOFF_TOKEN_PREFIX, 'an ovh_ handoff token');

function newToken(prefix: string, random: RandomBytes): string {
  return prefix + toBase64Url(randomBytesOf(random, TOKEN_BYTES));
}

/** A new hosted-flow session token (`ovs_...`). Store only its SHA-256 hash. */
export function newSessionToken(random: RandomBytes = webCryptoRandomBytes): string {
  return newToken(SESSION_TOKEN_PREFIX, random);
}

/** A new dashboard user session token (`ovu_...`). Store only its hash. */
export function newUserSessionToken(random: RandomBytes = webCryptoRandomBytes): string {
  return newToken(USER_SESSION_TOKEN_PREFIX, random);
}

/** A new one-time link token (`ovo_...`). Store only its SHA-256 hash. */
export function newOneTimeLinkToken(random: RandomBytes = webCryptoRandomBytes): string {
  return newToken(ONE_TIME_LINK_TOKEN_PREFIX, random);
}

/** A new MFA challenge token (`ovm_...`). Store only its SHA-256 hash. */
export function newMfaToken(random: RandomBytes = webCryptoRandomBytes): string {
  return newToken(MFA_TOKEN_PREFIX, random);
}

/** A new invitation token (`ovi_...`), sent only by email. Store only its SHA-256 hash. */
export function newInvitationToken(random: RandomBytes = webCryptoRandomBytes): string {
  return newToken(INVITATION_TOKEN_PREFIX, random);
}

/** A new device handoff token (`ovh_...`, C96.2). */
export function newHandoffToken(random: RandomBytes = webCryptoRandomBytes): string {
  return newToken(HANDOFF_TOKEN_PREFIX, random);
}

/** A new webhook signing secret (`wbhsec_...`), returned to the customer exactly once. */
export function newWebhookSecret(random: RandomBytes = webCryptoRandomBytes): string {
  return newToken(WEBHOOK_SECRET_PREFIX, random);
}

/**
 * The only part of a webhook secret shown after creation.
 * @throws {TypeError} when `secret` does not look like a webhook secret.
 */
export function webhookSecretLast4(secret: string): string {
  if (
    !secret.startsWith(WEBHOOK_SECRET_PREFIX) ||
    secret.length < WEBHOOK_SECRET_PREFIX.length + 4
  ) {
    throw new TypeError('Not a webhook secret');
  }
  return secret.slice(-4);
}

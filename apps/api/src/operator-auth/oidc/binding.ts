/**
 * C248.4 (review F21; Stage 1a amendment 11): the browser binding of one SSO attempt. The start
 * answers a fresh `ovsb_` value, which the console's start handler sets as the `__Host-` cookie; the
 * API keeps only its SHA-256 as the key of the single-use `sso_login_states` row, so a database read
 * cannot replay it. The `state` is likewise kept only as its SHA-256.
 */
import { createHash, randomBytes } from 'node:crypto';
import { SSO_BINDING_PREFIX } from '@openverify/contracts';

/** A new binding: `ovsb_` and 32 random bytes as base64url (`ssoBindingSchema`). */
export function newSsoBinding(): string {
  return `${SSO_BINDING_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/** The lower-case hex SHA-256 of a binding or a `state`, as stored. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * WebAuthn second factors (contract C15) with `@simplewebauthn/server` (MIT): the relying
 * party comes from `OPENVERIFY_WEBAUTHN_RP_ID`, `_RP_NAME` and `_ORIGIN`, user verification is
 * preferred (not required), the signature counter is checked, and challenges are stored only
 * as SHA-256 hashes for 5 minutes.
 */
import { createHash } from 'node:crypto';
import { AppError } from '../errors.js';

/** Registration and login challenges live 5 minutes. */
export const WEBAUTHN_CHALLENGE_TTL_SECONDS = 5 * 60;
/** Browsers get as long to complete the ceremony. */
export const WEBAUTHN_TIMEOUT_MS = WEBAUTHN_CHALLENGE_TTL_SECONDS * 1000;
export const DEFAULT_WEBAUTHN_FACTOR_NAME = 'Security key';

/** 503: the deployment configured no WebAuthn relying party. */
export class WebauthnNotConfiguredError extends AppError {
  override name = 'WebauthnNotConfiguredError';

  constructor() {
    super({
      status: 503,
      detail:
        'WebAuthn is not configured: set OPENVERIFY_WEBAUTHN_RP_ID and ' +
        'OPENVERIFY_WEBAUTHN_ORIGIN, or OPENVERIFY_DASHBOARD_PUBLIC_URL.',
    });
  }
}

/** How a challenge is stored: the SHA-256 hex of its base64url text. */
export function challengeHash(challenge: string): string {
  return createHash('sha256').update(challenge, 'utf8').digest('hex');
}

/**
 * The challenge a browser signed, from a credential's base64url `clientDataJSON`, or `null`
 * when it cannot be read. Only used to find the stored challenge; the library then checks the
 * whole client data against it.
 */
export function clientDataChallenge(clientDataJSON: string): string | null {
  try {
    const data: unknown = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8'));
    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
      const { challenge } = data as { challenge?: unknown };
      return typeof challenge === 'string' ? challenge : null;
    }
    return null;
  } catch {
    return null;
  }
}

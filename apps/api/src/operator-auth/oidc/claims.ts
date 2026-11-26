/**
 * C248.3, C248.4, C248.6 (reviews P06, P07): what the platform checks in an ID token after
 * `openid-client` verified its signature, issuer, audience, nonce and expiry: the tenant pin, the
 * verified email inside the provider's domains (a first link only), whether the token meets the
 * provider's `required-amr` and `required-acr`, and a step-up's `auth_time`.
 */
import type { SsoTenantPin } from './issuer.js';

/** The claims of a verified ID token. */
export type IdTokenClaims = Readonly<Record<string, unknown>>;

/** Whether the token carries the provider's tenant pin; a provider without a pin always holds. */
export function tenantPinHolds(claims: IdTokenClaims, pin: SsoTenantPin | null): boolean {
  return pin === null || claims[pin.claim] === pin.value;
}

/**
 * C248.6: whether the ID token stands in for the user's local second factor: the provider names at
 * least one requirement, every `required-amr` value is in the token's `amr`, and, when
 * `required-acr` is set, the token's `acr` is one of its values. A provider that names none never
 * stands in (ours: the secure reading of "does not meet").
 */
export function meetsAuthenticationRequirement(
  claims: IdTokenClaims,
  requiredAmr: readonly string[],
  requiredAcr: readonly string[],
): boolean {
  if (requiredAmr.length === 0 && requiredAcr.length === 0) {
    return false;
  }
  const amr = Array.isArray(claims.amr) ? (claims.amr as unknown[]) : [];
  const amrMet = requiredAmr.every((value) => amr.includes(value));
  const { acr } = claims;
  const acrMet = requiredAcr.length === 0 || (typeof acr === 'string' && requiredAcr.includes(acr));
  return amrMet && acrMet;
}

export type VerifiedEmail =
  | { ok: true; email: string }
  | { ok: false; failure: 'email_missing' | 'email_unverified' | 'email_domain_not_allowed' };

/**
 * C248.4 (review P07): the email a first link may match by: present, `email_verified` exactly
 * `true` (absent or any other value is false), and its domain one of `allowedDomains`. Normalised as
 * the users table stores emails (trimmed, lower-case).
 */
export function verifiedEmailOf(
  claims: IdTokenClaims,
  allowedDomains: readonly string[],
): VerifiedEmail {
  const raw = claims.email;
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) {
    return { ok: false, failure: 'email_missing' };
  }
  if (claims.email_verified !== true) {
    return { ok: false, failure: 'email_unverified' };
  }
  return allowedDomains.includes(email.slice(at + 1))
    ? { ok: true, email }
    : { ok: false, failure: 'email_domain_not_allowed' };
}

/** The tolerance for an `auth_time` slightly ahead of the platform's clock. */
export const AUTH_TIME_SKEW_SECONDS = 60;

/**
 * C248.6: a step-up's re-authentication is fresh when `auth_time` is present, at most
 * `windowSeconds` old and not ahead of `now` beyond the skew.
 */
export function reauthenticatedWithin(
  claims: IdTokenClaims,
  now: Date,
  windowSeconds: number,
): boolean {
  const authTime = claims.auth_time;
  if (typeof authTime !== 'number' || !Number.isFinite(authTime)) {
    return false;
  }
  const nowSeconds = now.getTime() / 1000;
  return nowSeconds - authTime <= windowSeconds && authTime - nowSeconds <= AUTH_TIME_SKEW_SECONDS;
}

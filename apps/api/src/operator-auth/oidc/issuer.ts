/**
 * C248.3 (review P07): issuers. A provider stores the exact `iss` its ID tokens carry. A
 * multi-tenant issuer (the shared `common`, `organizations` or `consumers` issuer of the Entra shape,
 * whose discovery document names `{tenantid}`, and a shared Google-shaped issuer, where any account
 * of the identity provider signs in) is accepted only with a tenant pin (`tid` or `hd`), stored on
 * the provider and checked on every ID token.
 */
import type { z } from 'zod';
import type { ssoTenantPinSchema } from '@openverify/contracts';

export type SsoTenantPin = z.infer<typeof ssoTenantPinSchema>;

/** The placeholder the Entra shape's multi-tenant discovery document puts in its issuer. */
export const TENANT_ID_PLACEHOLDER = '{tenantid}';

/** The first path segments of the Entra shape's shared, multi-tenant issuers. */
export const MULTI_TENANT_SEGMENTS: readonly string[] = Object.freeze([
  'common',
  'organizations',
  'consumers',
]);

/**
 * Shared issuers any account of their identity provider signs in through (public identifiers, used
 * only as behaviour): the Google shape's one issuer, which needs the `hd` pin.
 */
export const SHARED_ISSUERS: readonly string[] = Object.freeze(['https://accounts.google.com']);

/** Whether `issuer` is one that many tenants share, so a provider needs a tenant pin. */
export function isMultiTenantIssuer(
  issuer: string,
  sharedIssuers: readonly string[] = SHARED_ISSUERS,
): boolean {
  const bare = issuer.replace(/\/+$/, '');
  if (sharedIssuers.some((shared) => shared.replace(/\/+$/, '') === bare)) {
    return true;
  }
  if (issuer.includes(TENANT_ID_PLACEHOLDER)) {
    return true;
  }
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    return false;
  }
  const [first] = url.pathname.split('/').filter((segment) => segment !== '');
  return first !== undefined && MULTI_TENANT_SEGMENTS.includes(first);
}

/** Where an issuer's discovery document is (OpenID Connect Discovery 1.0 §4). */
export function discoveryUrlOf(issuer: string): string {
  return `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
}

/**
 * The `iss` every ID token of this provider must carry, or `null` when the discovery document's
 * issuer does not fit the stored one: the stored issuer itself when the document names it, or the
 * Entra shape's `{tenantid}` template filled with the provider's `tid` pin, on the same origin.
 */
export function expectedIdTokenIssuer(
  stored: string,
  discovered: string,
  pin: SsoTenantPin | null,
): string | null {
  if (discovered === stored) {
    return stored;
  }
  if (!discovered.includes(TENANT_ID_PLACEHOLDER) || pin?.claim !== 'tid') {
    return null;
  }
  const filled = discovered.replace(TENANT_ID_PLACEHOLDER, pin.value);
  try {
    return new URL(filled).origin === new URL(stored).origin ? filled : null;
  } catch {
    return null;
  }
}

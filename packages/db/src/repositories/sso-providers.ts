/**
 * C248.3, C248.4, C248.6, C248.8 (Phase 11, Workflow 11B, `sso-oidc`): an organisation's OIDC
 * identity providers, its sign-in name, the single-use sign-in attempts and the break-glass grant.
 *
 * - The client secret is sealed for its row (`sso_providers.client_secret#<ssop id>`) and opened only
 *   to talk to the provider; nothing here returns it but {@link openSsoProviderSecret}.
 * - An attempt (`sso_login_states`) is keyed by the SHA-256 of its browser binding, its nonce and PKCE
 *   verifier sealed for that key, and consumed once by one `UPDATE ... RETURNING`.
 * - The break-glass grant (`users.password_login_allowed_until`) allows one password sign-in before
 *   its time while the organisation enforces SSO, and is cleared when used.
 */
import { and, asc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { openValue, sealValue } from '../sealed.js';
import {
  ssoLoginStates,
  ssoProviders,
  type SsoLoginState,
  type SsoProvider,
} from '../tables/sso.js';
import { organizations } from '../tables/tenancy.js';
import { users } from '../tables/users.js';

const SECRET = SEALED.ssoProviderClientSecret;
const NONCE = SEALED.ssoLoginStateNonce;
const VERIFIER = SEALED.ssoLoginStateCodeVerifier;

export interface SsoProviderInput {
  displayName: string;
  issuer: string;
  clientId: string;
  allowedEmailDomains: readonly string[];
  tenantPinClaim: 'tid' | 'hd' | null;
  tenantPinValue: string | null;
  requiredAmr: readonly string[];
  requiredAcr: readonly string[];
  jitProvisioning: boolean;
  defaultRoleIds: readonly string[];
  enforced: boolean;
}

export interface NewSsoProviderInput extends SsoProviderInput {
  id: string;
  organizationId: string;
  /** Plaintext, sealed here for the row. */
  clientSecret: string;
  at: Date;
}

export async function createSsoProvider(db: Db, input: NewSsoProviderInput): Promise<SsoProvider> {
  const [row] = await db
    .insert(ssoProviders)
    .values({
      id: input.id,
      organizationId: input.organizationId,
      displayName: input.displayName,
      issuer: input.issuer,
      clientId: input.clientId,
      clientSecret: sealValue(SECRET, input.id, input.clientSecret),
      allowedEmailDomains: [...input.allowedEmailDomains],
      tenantPinClaim: input.tenantPinClaim,
      tenantPinValue: input.tenantPinValue,
      requiredAmr: [...input.requiredAmr],
      requiredAcr: [...input.requiredAcr],
      jitProvisioning: input.jitProvisioning,
      defaultRoleIds: [...input.defaultRoleIds],
      enforced: input.enforced,
      createdAt: input.at,
      updatedAt: input.at,
    })
    .returning();
  if (row === undefined) {
    throw new Error('createSsoProvider inserted no row');
  }
  return row;
}

function providerColumns(input: Partial<SsoProviderInput>) {
  return {
    ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
    ...(input.issuer === undefined ? {} : { issuer: input.issuer }),
    ...(input.clientId === undefined ? {} : { clientId: input.clientId }),
    ...(input.allowedEmailDomains === undefined
      ? {}
      : { allowedEmailDomains: [...input.allowedEmailDomains] }),
    ...(input.tenantPinClaim === undefined ? {} : { tenantPinClaim: input.tenantPinClaim }),
    ...(input.tenantPinValue === undefined ? {} : { tenantPinValue: input.tenantPinValue }),
    ...(input.requiredAmr === undefined ? {} : { requiredAmr: [...input.requiredAmr] }),
    ...(input.requiredAcr === undefined ? {} : { requiredAcr: [...input.requiredAcr] }),
    ...(input.jitProvisioning === undefined ? {} : { jitProvisioning: input.jitProvisioning }),
    ...(input.defaultRoleIds === undefined ? {} : { defaultRoleIds: [...input.defaultRoleIds] }),
    ...(input.enforced === undefined ? {} : { enforced: input.enforced }),
  };
}

/** The organisation's providers, oldest first. */
export function listSsoProviders(db: Db, organizationId: string): Promise<SsoProvider[]> {
  return db
    .select()
    .from(ssoProviders)
    .where(eq(ssoProviders.organizationId, organizationId))
    .orderBy(asc(ssoProviders.createdAt), asc(ssoProviders.id));
}

/** One provider of the organisation, or `null`. */
export async function getSsoProvider(
  db: Db,
  organizationId: string,
  id: string,
): Promise<SsoProvider | null> {
  const [row] = await db
    .select()
    .from(ssoProviders)
    .where(and(eq(ssoProviders.organizationId, organizationId), eq(ssoProviders.id, id)))
    .limit(1);
  return row ?? null;
}

/** A provider by id alone: the public callback names only its id; the caller checks its attempt. */
export async function findSsoProvider(db: Db, id: string): Promise<SsoProvider | null> {
  const [row] = await db.select().from(ssoProviders).where(eq(ssoProviders.id, id)).limit(1);
  return row ?? null;
}

/** Changes a provider; a new secret is sealed for the row. `null` when it is not the organisation's. */
export async function updateSsoProvider(
  db: Db,
  organizationId: string,
  id: string,
  changes: Partial<SsoProviderInput> & { clientSecret?: string; at: Date },
): Promise<SsoProvider | null> {
  const [row] = await db
    .update(ssoProviders)
    .set({
      ...providerColumns(changes),
      ...(changes.clientSecret === undefined
        ? {}
        : { clientSecret: sealValue(SECRET, id, changes.clientSecret) }),
      updatedAt: changes.at,
    })
    .where(and(eq(ssoProviders.organizationId, organizationId), eq(ssoProviders.id, id)))
    .returning();
  return row ?? null;
}

/** Deletes a provider (its identities and attempts go with it). False when it was not there. */
export async function deleteSsoProvider(
  db: Db,
  organizationId: string,
  id: string,
): Promise<boolean> {
  const rows = await db
    .delete(ssoProviders)
    .where(and(eq(ssoProviders.organizationId, organizationId), eq(ssoProviders.id, id)))
    .returning({ id: ssoProviders.id });
  return rows.length > 0;
}

/** The provider's client secret, opened for one call to the provider. */
export function openSsoProviderSecret(provider: Pick<SsoProvider, 'id' | 'clientSecret'>): string {
  return openValue(SECRET, provider.id, provider.clientSecret);
}

/** Whether a provider of the organisation is enforced (password sign-in refused, C248.6). */
export async function organizationEnforcesSso(db: Db, organizationId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: ssoProviders.id })
    .from(ssoProviders)
    .where(and(eq(ssoProviders.organizationId, organizationId), eq(ssoProviders.enforced, true)))
    .limit(1);
  return row !== undefined;
}

/** C248.8: the organisation of a sign-in name, or `null`. */
export async function findOrganizationIdBySlug(db: Db, slug: string): Promise<string | null> {
  const [row] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  return row?.id ?? null;
}

/** The organisation's sign-in name, or `null`. */
export async function getOrganizationSlug(db: Db, organizationId: string): Promise<string | null> {
  const [row] = await db
    .select({ slug: organizations.slug })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return row?.slug ?? null;
}

/** Sets or clears the sign-in name; `'taken'` when another organisation holds it. */
export async function setOrganizationSlug(
  db: Db,
  organizationId: string,
  slug: string | null,
): Promise<'set' | 'taken'> {
  // A savepoint, so a unique violation leaves the caller's transaction usable.
  try {
    await db.transaction(async (tx) => {
      await tx.update(organizations).set({ slug }).where(eq(organizations.id, organizationId));
    });
    return 'set';
  } catch (error) {
    if (uniqueViolation(error, 'organizations_slug_key')) {
      return 'taken';
    }
    throw error;
  }
}

function uniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const { code, constraint: named } = current as { code?: unknown; constraint?: unknown };
    if (code === '23505' && (named === undefined || named === constraint)) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export interface NewSsoLoginStateInput {
  bindingSha256: string;
  organizationId: string;
  providerId: string;
  purpose: 'sign-in' | 'step-up';
  sessionId: string | null;
  stateSha256: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string | null;
  createdAt: Date;
  expiresAt: Date;
}

/** The attempt as the service reads it: its nonce and verifier opened. */
export interface OpenedSsoLoginState extends Omit<SsoLoginState, 'nonce' | 'codeVerifier'> {
  nonce: string;
  codeVerifier: string;
}

export async function insertSsoLoginState(db: Db, input: NewSsoLoginStateInput): Promise<void> {
  await db.insert(ssoLoginStates).values({
    ...input,
    nonce: sealValue(NONCE, input.bindingSha256, input.nonce),
    codeVerifier: sealValue(VERIFIER, input.bindingSha256, input.codeVerifier),
  });
}

/**
 * C248.4: consumes the unused, unexpired attempt of a binding's digest, once: two callbacks with one
 * binding never both find it.
 */
export async function consumeSsoLoginState(
  db: Db,
  bindingSha256: string,
  now: Date,
): Promise<OpenedSsoLoginState | null> {
  const [row] = await db
    .update(ssoLoginStates)
    .set({ consumedAt: now })
    .where(
      and(
        eq(ssoLoginStates.bindingSha256, bindingSha256),
        isNull(ssoLoginStates.consumedAt),
        gt(ssoLoginStates.expiresAt, now),
      ),
    )
    .returning();
  if (row === undefined) {
    return null;
  }
  return {
    ...row,
    nonce: openValue(NONCE, row.bindingSha256, row.nonce),
    codeVerifier: openValue(VERIFIER, row.bindingSha256, row.codeVerifier),
  };
}

/**
 * C16: deletes the attempts that expired before `before` (the pass passes a day before now), at most
 * `limit` of them, oldest first; their count.
 */
export async function deleteExpiredSsoLoginStates(
  db: Db,
  before: Date,
  limit?: number,
): Promise<number> {
  const due = db
    .select({ key: ssoLoginStates.bindingSha256 })
    .from(ssoLoginStates)
    .where(lt(ssoLoginStates.expiresAt, before))
    .orderBy(asc(ssoLoginStates.expiresAt))
    .limit(limit ?? 500);
  const rows = await db
    .delete(ssoLoginStates)
    .where(inArray(ssoLoginStates.bindingSha256, due))
    .returning({ key: ssoLoginStates.bindingSha256 });
  return rows.length;
}

/** C248.6 (review F11): grants the user one password sign-in before `until`. False: no such user. */
export async function grantPasswordLogin(
  db: Db,
  organizationId: string,
  userId: string,
  until: Date,
): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({ passwordLoginAllowedUntil: until })
    .where(and(eq(users.organizationId, organizationId), eq(users.id, userId)))
    .returning({ id: users.id });
  return rows.length > 0;
}

/** Uses the grant if it is live at `now`, clearing it; true when one was used. */
export async function takePasswordLoginGrant(
  db: Db,
  organizationId: string,
  userId: string,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({ passwordLoginAllowedUntil: sql`NULL` })
    .where(
      and(
        eq(users.organizationId, organizationId),
        eq(users.id, userId),
        gt(users.passwordLoginAllowedUntil, now),
      ),
    )
    .returning({ id: users.id });
  return rows.length > 0;
}

/**
 * C248 (Phase 11, Workflow 11B Stage 1b (A)): OIDC sign-in for the console.
 *
 * - `sso_providers` (`ssop_`, ours): an organisation's identity providers. The exact `issuer` is
 *   stored; `allowed_email_domains` is required and non-empty; a multi-tenant issuer is accepted
 *   only with a tenant pin (`tid` or `hd`) checked on every ID token (review P07); `required_amr` and
 *   `required_acr` say when the provider's own second factor suffices (P06); just-in-time
 *   provisioning is off by default and its roles are role ids (Stage 1a amendment 36). The client
 *   secret is sealed for the row (`sso_providers.client_secret#<ssop id>`; review P35) and never
 *   served.
 * - `user_sso_identities`: a console user's link to a provider, matched only by `(provider, issuer,
 *   subject)` once it exists (review P07, F11); one link per user and provider.
 * - `sso_login_states` (Stage 1a amendment 11): the single-use browser binding of a start, keyed by
 *   the SHA-256 of the `__Host-` cookie's value, with the state's digest and the nonce and PKCE
 *   verifier sealed for the row (`sso_login_states.<column>#<binding_sha256>`): rule 11 keeps them
 *   out of Valkey. Consumed once, deleted by the C16 pass a day after it expires. It holds no data
 *   subject's data.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import { sealedColumn } from '../sealed.js';
import { createdAt, hexDigest, idFormat, timestamptz, updatedAt } from './columns.js';
import { organizations } from './tenancy.js';
import { users, userSessions } from './users.js';

/** C248.3: the claims a tenant pin may name (Microsoft's `tid`, Google's `hd`). */
export const SSO_TENANT_PIN_CLAIM_VALUES = ['tid', 'hd'] as const;
/** Stage 1a amendment 11: what a login state was started for. */
export const SSO_LOGIN_PURPOSE_VALUES = ['sign-in', 'step-up'] as const;

const textArray = (name: string) =>
  text(name)
    .array()
    .notNull()
    .default(sql`'{}'::text[]`);

export const ssoProviders = pgTable(
  'sso_providers',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    /** The exact `iss` every ID token must carry. */
    issuer: text('issuer').notNull(),
    clientId: text('client_id').notNull(),
    /** Sealed for the row; write-only through the API. */
    clientSecret: sealedColumn('client_secret').notNull(),
    allowedEmailDomains: text('allowed_email_domains').array().notNull(),
    tenantPinClaim: text('tenant_pin_claim', { enum: SSO_TENANT_PIN_CLAIM_VALUES }),
    tenantPinValue: text('tenant_pin_value'),
    requiredAmr: textArray('required_amr'),
    requiredAcr: textArray('required_acr'),
    jitProvisioning: boolean('jit_provisioning').notNull().default(false),
    /** C248.5: the roles a just-in-time user is given, by id (Stage 1a amendment 36). */
    defaultRoleIds: textArray('default_role_ids'),
    /** C248.6: password sign-in refused for the organisation's users but for the break-glass grant. */
    enforced: boolean('enforced').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('sso_providers_organization_id_id_key').on(table.organizationId, table.id),
    index('sso_providers_organization_id_created_at_id_idx').on(
      table.organizationId,
      table.createdAt,
      table.id,
    ),
    check(
      'sso_providers_allowed_email_domains_present',
      sql`cardinality(${table.allowedEmailDomains}) >= 1`,
    ),
    check('sso_providers_tenant_pin_claim_valid', sql`${table.tenantPinClaim} IN ('tid', 'hd')`),
    check(
      'sso_providers_tenant_pin',
      sql`(${table.tenantPinClaim} IS NULL) = (${table.tenantPinValue} IS NULL)`,
    ),
    idFormat('sso_providers', table.id, 'ssop'),
  ],
);

export const userSsoIdentities = pgTable(
  'user_sso_identities',
  {
    organizationId: text('organization_id').notNull(),
    userId: text('user_id').notNull(),
    providerId: text('provider_id').notNull(),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    linkedAt: timestamptz('linked_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'user_sso_identities_pkey',
      columns: [table.providerId, table.issuer, table.subject],
    }),
    unique('user_sso_identities_provider_id_user_id_key').on(table.providerId, table.userId),
    index('user_sso_identities_user_id_idx').on(table.userId),
    foreignKey({
      name: 'user_sso_identities_user_fk',
      columns: [table.organizationId, table.userId],
      foreignColumns: [users.organizationId, users.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'user_sso_identities_provider_fk',
      columns: [table.organizationId, table.providerId],
      foreignColumns: [ssoProviders.organizationId, ssoProviders.id],
    }).onDelete('cascade'),
  ],
);

export const ssoLoginStates = pgTable(
  'sso_login_states',
  {
    /** SHA-256 of the binding cookie's value (`ovsb_...`), lowercase hex. */
    bindingSha256: text('binding_sha256').primaryKey(),
    organizationId: text('organization_id').notNull(),
    providerId: text('provider_id').notNull(),
    purpose: text('purpose', { enum: SSO_LOGIN_PURPOSE_VALUES }).notNull(),
    /** The session a step-up re-authenticates (`uss_`); `NULL` for a sign-in. */
    sessionId: text('session_id').references(() => userSessions.id, { onDelete: 'cascade' }),
    stateSha256: text('state_sha256').notNull(),
    /** Sealed for the row (`sso_login_states.nonce#<binding_sha256>`). */
    nonce: sealedColumn('nonce').notNull(),
    /** Sealed for the row (`sso_login_states.code_verifier#<binding_sha256>`). */
    codeVerifier: sealedColumn('code_verifier').notNull(),
    /** A console path with one leading `/`, or `NULL`. */
    returnTo: text('return_to'),
    createdAt: createdAt(),
    expiresAt: timestamptz('expires_at').notNull(),
    consumedAt: timestamptz('consumed_at'),
  },
  (table) => [
    foreignKey({
      name: 'sso_login_states_provider_fk',
      columns: [table.organizationId, table.providerId],
      foreignColumns: [ssoProviders.organizationId, ssoProviders.id],
    }).onDelete('cascade'),
    index('sso_login_states_expires_at_idx').on(table.expiresAt),
    hexDigest('sso_login_states_binding_sha256_hex', table.bindingSha256),
    hexDigest('sso_login_states_state_sha256_hex', table.stateSha256),
    check('sso_login_states_purpose_valid', sql`${table.purpose} IN ('sign-in', 'step-up')`),
    check(
      'sso_login_states_step_up_session',
      sql`(${table.purpose} = 'step-up') = (${table.sessionId} IS NOT NULL)`,
    ),
  ],
);

export type SsoProvider = typeof ssoProviders.$inferSelect;
export type NewSsoProvider = typeof ssoProviders.$inferInsert;
export type UserSsoIdentity = typeof userSsoIdentities.$inferSelect;
export type NewUserSsoIdentity = typeof userSsoIdentities.$inferInsert;
export type SsoLoginState = typeof ssoLoginStates.$inferSelect;
export type NewSsoLoginState = typeof ssoLoginStates.$inferInsert;

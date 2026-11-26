/** Dashboard operators, their login sessions, and their roles (C15). */
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
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { idPattern } from '../ids.js';
import { createdAt, hexDigest, idFormat, timestamptz, updatedAt } from './columns.js';
import { userStatus } from './enums.js';
import { environmentId } from './environment-id.js';
import { environments, organizations } from './tenancy.js';

/**
 * Operators belong to an organization, not to one environment, so the same person can
 * work in sandbox and production; each login session picks its environment.
 *
 * `email` is stored in plaintext on purpose. It is operator account data, not the
 * personal data of the people being verified, and login must find the account by email
 * with an indexed equality lookup, which a randomised ciphertext cannot support. It is
 * normalised (trimmed, lowercased) by the repository and the `users_email_lowercase`
 * check, and unique per organization.
 *
 * C15 invitations: an invited user has no password until it accepts, and carries the
 * SHA-256 of its `ovi_...` token with an expiry.
 */
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    /** Argon2id PHC string (`$argon2id$v=19$m=...`); hashing happens in the API. */
    passwordHash: text('password_hash'),
    name: text('name'),
    status: userStatus('status').notNull().default('active'),
    /** `hashSessionToken` of the `ovi_...` invitation token, while it is outstanding. */
    invitationTokenHash: text('invitation_token_hash'),
    invitationExpiresAt: timestamptz('invitation_expires_at'),
    /** The user who sent the invitation. */
    invitedBy: text('invited_by').references((): AnyPgColumn => users.id, {
      onDelete: 'set null',
    }),
    /**
     * C248.6 (Workflow 11B Stage 1b (A); review F11): the break-glass `user:allow-password` grants
     * one password sign-in before this time while the organisation enforces SSO; cleared on use.
     * `NULL` when no grant is outstanding.
     */
    passwordLoginAllowedUntil: timestamptz('password_login_allowed_until'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('users_organization_id_email_key').on(table.organizationId, table.email),
    unique('users_organization_id_id_key').on(table.organizationId, table.id),
    index('users_email_idx').on(table.email),
    index('users_organization_id_created_at_id_idx').on(
      table.organizationId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    uniqueIndex('users_invitation_token_hash_key').on(table.invitationTokenHash),
    check('users_email_lowercase', sql`${table.email} = lower(btrim(${table.email}))`),
    check('users_password_hash_argon2id', sql`${table.passwordHash} LIKE '$argon2id$%'`),
    check(
      'users_password_unless_invited',
      sql`${table.passwordHash} IS NOT NULL OR ${table.status} = 'invited'`,
    ),
    check(
      'users_invitation_expiry',
      sql`(${table.invitationTokenHash} IS NULL) = (${table.invitationExpiresAt} IS NULL)`,
    ),
    hexDigest('users_invitation_token_hash_hex', table.invitationTokenHash),
    idFormat('users', table.id, 'usr'),
  ],
);

/** Dashboard sessions (`ovu_...` tokens, C1). Only the SHA-256 of the token is stored. */
export const userSessions = pgTable(
  'user_sessions',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    userId: text('user_id').notNull(),
    /** The environment this session works in (C4 scopes every query by it). */
    environmentId: environmentId(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    revokedAt: timestamptz('revoked_at'),
    /**
     * C15: `false` until the login passed MFA, or when the organization requires MFA and
     * the user has no factor yet. Defaults to `false`, the restrictive value.
     */
    mfaSatisfied: boolean('mfa_satisfied').notNull().default(false),
    /**
     * C168.1 (Workflow 9B Stage 1b (U); review P02): when a second factor was last checked on this
     * session (`api-access` sets it on every factor check, the sign-in and the step-up); a reset or a
     * reactivation needs it within `STEP_UP_WINDOW_SECONDS`. `NULL` until a factor is checked.
     */
    mfaVerifiedAt: timestamptz('mfa_verified_at'),
    /**
     * C245.1 (Workflow 11B Stage 1b (A); Stage 1a amendment 5): the last authenticated request that
     * counted as activity, written at most once a minute per session from the injected clock; the
     * idle limit is measured from it. Rows before 0036 take their `updated_at`.
     */
    lastSeenAt: timestamptz('last_seen_at').notNull().defaultNow(),
    /**
     * C248.6 (KP11-26, Workflow 11F; migration 0037): the identity provider's `amr` of an SSO
     * sign-in, shown in the console, never trusted (the requirement checks read the token); at most
     * ten short values (`providerAmrOf`); `null` for a password sign-in and a provider naming none.
     */
    providerAmr: text('provider_amr').array(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      'user_sessions_provider_amr_limit',
      sql`${table.providerAmr} is null or cardinality(${table.providerAmr}) between 1 and 10`,
    ),
    foreignKey({
      name: 'user_sessions_user_fk',
      columns: [table.organizationId, table.userId],
      foreignColumns: [users.organizationId, users.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'user_sessions_environment_fk',
      columns: [table.organizationId, table.environmentId],
      foreignColumns: [environments.organizationId, environments.id],
    }).onDelete('cascade'),
    uniqueIndex('user_sessions_token_hash_key').on(table.tokenHash),
    index('user_sessions_user_id_idx').on(table.userId),
    // C16 retention deletes sessions long past their expiry (Workflow 2B F022).
    index('user_sessions_expires_at_idx').on(table.expiresAt),
    hexDigest('user_sessions_token_hash_hex', table.tokenHash),
    idFormat('user_sessions', table.id, 'uss'),
  ],
);

/**
 * C15 roles. Built-in roles (`admin`, `developer`, `reviewer`, `viewer`) are ordinary rows
 * with `builtin` and a stable `key`; custom roles have no key. `permissions` is a subset
 * of `PERMISSIONS` in `@openverify/core`.
 */
export const roles = pgTable(
  'roles',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Stable key of a built-in role; `NULL` for custom roles. */
    key: text('key'),
    name: text('name').notNull(),
    builtin: boolean('builtin').notNull().default(false),
    permissions: text('permissions')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('roles_organization_id_id_key').on(table.organizationId, table.id),
    uniqueIndex('roles_organization_id_name_key').on(
      table.organizationId,
      sql`lower(${table.name})`,
    ),
    uniqueIndex('roles_organization_id_key_key')
      .on(table.organizationId, table.key)
      .where(sql`${table.key} IS NOT NULL`),
    index('roles_organization_id_created_at_id_idx').on(
      table.organizationId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    check('roles_builtin_has_key', sql`${table.builtin} = (${table.key} IS NOT NULL)`),
    check('roles_key_format', sql`${table.key} ~ '^[a-z][a-z0-9_-]*$'`),
    check('roles_name_not_blank', sql`btrim(${table.name}) <> ''`),
    idFormat('roles', table.id, 'role'),
  ],
);

/** C167.2: an `env_` id, as the array check matches it (each id, comma-separated). */
const ENVIRONMENT_ID = idPattern('env').slice(1, -1);

/** C167.2 (Workflow 9B; contracts B25): the most environments one assignment names. */
export const MAX_ROLE_ASSIGNMENT_ENVIRONMENTS = 20;

/**
 * Which roles a user holds; their permissions are the union (C15). A role that is still
 * assigned cannot be deleted (the foreign key is NO ACTION).
 *
 * C167.2 (Workflow 9B Stage 1b (U); decisions 49 and 70): `environment_ids` names the environments
 * the role is granted in, or is `NULL` for every current and future one (the public "all current and
 * new environments"), which every assignment made before Phase 9 keeps. A session's permissions are
 * those of the assignments reaching its environment (`permissionsForEnvironment`, `api-access`).
 */
export const userRoles = pgTable(
  'user_roles',
  {
    organizationId: text('organization_id').notNull(),
    userId: text('user_id').notNull(),
    roleId: text('role_id').notNull(),
    environmentIds: text('environment_ids').array(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ name: 'user_roles_pkey', columns: [table.userId, table.roleId] }),
    check(
      'user_roles_environment_ids_valid',
      sql`${table.environmentIds} is null or (cardinality(${table.environmentIds}) between 1 and ${sql.raw(String(MAX_ROLE_ASSIGNMENT_ENVIRONMENTS))}
        and array_position(${table.environmentIds}, null) is null
        and array_to_string(${table.environmentIds}, ',') ~ ${sql.raw(`'^${ENVIRONMENT_ID}(,${ENVIRONMENT_ID})*$'`)})`,
    ),
    foreignKey({
      name: 'user_roles_user_fk',
      columns: [table.organizationId, table.userId],
      foreignColumns: [users.organizationId, users.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'user_roles_role_fk',
      columns: [table.organizationId, table.roleId],
      foreignColumns: [roles.organizationId, roles.id],
    }),
    index('user_roles_organization_id_role_id_idx').on(table.organizationId, table.roleId),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserSession = typeof userSessions.$inferSelect;
export type NewUserSession = typeof userSessions.$inferInsert;
export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
export type UserRole = typeof userRoles.$inferSelect;

/**
 * C248.4-C248.6 (Phase 11, Workflow 11B, `sso-oidc`): the SSO service's store over Postgres
 * (`packages/db/src/repositories/sso-{providers,identities}.ts`). Organisation-wide audit entries go
 * to every environment of the organisation, as Phase 9's user changes do; a just-in-time user gets
 * an Argon2id hash of a random secret no one holds, so it signs in only through its provider.
 */
import { randomBytes } from 'node:crypto';
import {
  consumeSsoLoginState,
  findOrganizationIdBySlug,
  findSsoProvider,
  findUserBySsoIdentity,
  getRoles,
  getUserSession,
  insertSsoLoginState,
  linkSsoIdentity,
  listEnvironments,
  listSsoIdentitiesOfUser,
  listSsoProviders,
  markUserSessionMfaVerified,
  normalizeEmail,
  openSsoProviderSecret,
  provisionSsoUser,
  users,
  getUser,
  type Db,
  type SsoProvider,
} from '@openverify/db';
import { and, eq } from 'drizzle-orm';
import type { AuditLogger, IdGenerator } from '../../ports.js';
import type { PasswordHasher } from '../password-hasher.js';
import type { SsoProviderRecord, SsoStore } from './service.js';

export function providerRecordOf(row: SsoProvider): SsoProviderRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    displayName: row.displayName,
    issuer: row.issuer,
    clientId: row.clientId,
    clientSecret: openSsoProviderSecret(row),
    allowedEmailDomains: row.allowedEmailDomains,
    tenantPin:
      row.tenantPinClaim === null || row.tenantPinValue === null
        ? null
        : { claim: row.tenantPinClaim, value: row.tenantPinValue },
    requiredAmr: row.requiredAmr,
    requiredAcr: row.requiredAcr,
    jitProvisioning: row.jitProvisioning,
    defaultRoleIds: row.defaultRoleIds,
    enforced: row.enforced,
  };
}

export interface PostgresSsoStoreOptions {
  db: Db;
  audit: AuditLogger;
  ids: IdGenerator;
  hasher: PasswordHasher;
}

export function createPostgresSsoStore({
  db,
  audit,
  ids,
  hasher,
}: PostgresSsoStoreOptions): SsoStore {
  return {
    findOrganizationIdBySlug: (slug) => findOrganizationIdBySlug(db, slug),
    listProviders: async (organizationId) =>
      (await listSsoProviders(db, organizationId)).map(providerRecordOf),
    async getProvider(id) {
      const row = await findSsoProvider(db, id);
      return row === null ? null : providerRecordOf(row);
    },
    insertLoginState: (state) => insertSsoLoginState(db, state),
    consumeLoginState: (bindingSha256, now) => consumeSsoLoginState(db, bindingSha256, now),
    findLinkedUser: (providerId, issuer, subject) =>
      findUserBySsoIdentity(db, providerId, issuer, subject),
    listIdentitiesOfUser: async (userId) =>
      (await listSsoIdentitiesOfUser(db, userId)).map((row) => ({
        userId: row.userId,
        providerId: row.providerId,
        issuer: row.issuer,
        subject: row.subject,
        linkedAt: row.linkedAt,
      })),
    async findUserByEmail(organizationId, email) {
      const [row] = await db
        .select()
        .from(users)
        .where(
          and(eq(users.organizationId, organizationId), eq(users.email, normalizeEmail(email))),
        )
        .limit(1);
      return row ?? null;
    },
    async linkIdentity(identity) {
      const user = await db
        .select({ organizationId: users.organizationId })
        .from(users)
        .where(eq(users.id, identity.userId))
        .limit(1);
      const organizationId = user[0]?.organizationId;
      return organizationId === undefined
        ? false
        : linkSsoIdentity(db, { ...identity, organizationId });
    },
    async rolePermissions(organizationId, roleIds) {
      const roles = await getRoles(db, organizationId, roleIds);
      return new Map(roles.map((role) => [role.id, role.permissions]));
    },
    async provisionUser({ organizationId, email, name, roleIds, identity }) {
      return provisionSsoUser(db, {
        id: ids.newId('usr'),
        organizationId,
        email,
        name,
        passwordHash: await hasher.hash(randomBytes(32).toString('base64url')),
        roleIds,
        identity,
        at: identity.linkedAt,
      });
    },
    async findLiveSession(sessionId, now) {
      const session = await getUserSession(db, sessionId);
      const live =
        session?.revokedAt === null && session.expiresAt.getTime() > now.getTime() ? session : null;
      if (live === null) {
        return null;
      }
      const user = await getUser(db, live.organizationId, live.userId);
      return user?.status === 'active' ? { user } : null;
    },
    markSessionStepUp: async (sessionId, at) =>
      (await markUserSessionMfaVerified(db, sessionId, at)) !== null,
    async audit({ organizationId, userId, action, resourceId, metadata }) {
      for (const environment of await listEnvironments(db, organizationId)) {
        await audit.record(db, {
          organizationId,
          environmentId: environment.id,
          actor: { type: 'user', id: userId },
          action,
          resourceType: 'user',
          resourceId,
          metadata,
        });
      }
    },
  };
}

/**
 * C248.4, C248.5 (Phase 11, Workflow 11B, `sso-oidc`; reviews P07, F11): console users' links to
 * identities at an SSO provider. A returning user is found only by its `(provider, issuer, subject)`;
 * a user has at most one link to a provider; a just-in-time user is created with its roles and its
 * link in one transaction.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { userSsoIdentities, type UserSsoIdentity } from '../tables/sso.js';
import { userRoles, users, type User } from '../tables/users.js';
import { normalizeEmail } from './users.js';

export interface SsoIdentityInput {
  organizationId: string;
  userId: string;
  providerId: string;
  issuer: string;
  subject: string;
  linkedAt: Date;
}

/** The user linked to this identity, or `null`. */
export async function findUserBySsoIdentity(
  db: Db,
  providerId: string,
  issuer: string,
  subject: string,
): Promise<User | null> {
  const [row] = await db
    .select({ user: users })
    .from(userSsoIdentities)
    .innerJoin(
      users,
      and(
        eq(users.organizationId, userSsoIdentities.organizationId),
        eq(users.id, userSsoIdentities.userId),
      ),
    )
    .where(
      and(
        eq(userSsoIdentities.providerId, providerId),
        eq(userSsoIdentities.issuer, issuer),
        eq(userSsoIdentities.subject, subject),
      ),
    )
    .limit(1);
  return row?.user ?? null;
}

/** The user's links, oldest first. */
export function listSsoIdentitiesOfUser(db: Db, userId: string): Promise<UserSsoIdentity[]> {
  return db
    .select()
    .from(userSsoIdentities)
    .where(eq(userSsoIdentities.userId, userId))
    .orderBy(asc(userSsoIdentities.linkedAt), asc(userSsoIdentities.providerId));
}

/**
 * Links the user to the identity. False when the identity is linked already, or the user already
 * has a link to this provider (a race lost to another first sign-in).
 */
export async function linkSsoIdentity(db: Db, input: SsoIdentityInput): Promise<boolean> {
  const rows = await db
    .insert(userSsoIdentities)
    .values(input)
    .onConflictDoNothing()
    .returning({ userId: userSsoIdentities.userId });
  return rows.length > 0;
}

export interface ProvisionSsoUserInput {
  id: string;
  organizationId: string;
  email: string;
  name: string | null;
  /** An Argon2id hash of a random secret no one knows: the user signs in with SSO. */
  passwordHash: string;
  /** Granted in every environment, current and future (C167.2's `null`). */
  roleIds: readonly string[];
  identity: Omit<SsoIdentityInput, 'organizationId' | 'userId'>;
  at: Date;
}

/** C248.5: a new active user with its roles and its link, in one transaction. */
export async function provisionSsoUser(db: Db, input: ProvisionSsoUserInput): Promise<User> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        id: input.id,
        organizationId: input.organizationId,
        email: normalizeEmail(input.email),
        passwordHash: input.passwordHash,
        name: input.name,
        createdAt: input.at,
        updatedAt: input.at,
      })
      .returning();
    if (user === undefined) {
      throw new Error('provisionSsoUser inserted no user');
    }
    if (input.roleIds.length > 0) {
      await tx.insert(userRoles).values(
        input.roleIds.map((roleId) => ({
          organizationId: input.organizationId,
          userId: user.id,
          roleId,
          environmentIds: null,
        })),
      );
    }
    await tx.insert(userSsoIdentities).values({
      ...input.identity,
      organizationId: input.organizationId,
      userId: user.id,
    });
    return user;
  });
}

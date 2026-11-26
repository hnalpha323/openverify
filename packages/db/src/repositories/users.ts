import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import {
  mfaChallenges,
  mfaFactors,
  userSessions,
  users,
  type MfaChallenge,
  type User,
  type UserSession,
  type UserStatus,
} from '../schema.js';
import {
  newestFirst,
  paginate,
  type CursorTable,
  type Page,
  type PageRequest,
} from './pagination.js';
import { allFilters, equalsAny, firstOrNull, inserted, type OneOrMany } from './rows.js';

export interface NewUserInput {
  id: string;
  organizationId: string;
  /** Normalised with {@link normalizeEmail} before it is stored. */
  email: string;
  /** Argon2id PHC string. */
  passwordHash: string;
  name?: string | null;
}

export interface NewUserSessionInput {
  id: string;
  organizationId: string;
  userId: string;
  /** The environment the session works in; must belong to the user's organization. */
  environmentId: string;
  /** `hashSessionToken(token)` of the `ovu_...` token. */
  tokenHash: string;
  expiresAt: Date;
  /** C15: whether the login passed MFA. Defaults to `false`, the restrictive value. */
  mfaSatisfied?: boolean;
  /** C168.1 (Workflow 9B): when a second factor was checked for this sign-in; `null` for none. */
  mfaVerifiedAt?: Date | null;
  /** C248.6 (KP11-26): the identity provider's `amr` of an SSO sign-in; `null` for none. */
  providerAmr?: readonly string[] | null;
  /**
   * C168.4 (Workflow 9B): when the session was opened, its first "last seen" (`updated_at`), from
   * the caller's clock. Defaults to the database's time.
   */
  at?: Date;
}

export interface ActiveUserSession {
  session: UserSession;
  user: User;
}

/** An active user who has set a password: a login candidate. */
export type UserWithPassword = User & { passwordHash: string };

const hasPassword = (user: User): user is UserWithPassword => user.passwordHash !== null;

/** Operator emails are compared trimmed and lowercased. */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export async function createUser(db: Db, input: NewUserInput): Promise<User> {
  const rows = await db
    .insert(users)
    .values({
      id: input.id,
      organizationId: input.organizationId,
      email: normalizeEmail(input.email),
      passwordHash: input.passwordHash,
      name: input.name ?? null,
    })
    .returning();
  return inserted(rows, 'createUser');
}

export async function getUser(db: Db, organizationId: string, id: string): Promise<User | null> {
  return firstOrNull(
    await db
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.organizationId, organizationId)))
      .limit(1),
  );
}

export async function findUserByEmail(
  db: Db,
  organizationId: string,
  email: string,
): Promise<User | null> {
  return firstOrNull(
    await db
      .select()
      .from(users)
      .where(and(eq(users.organizationId, organizationId), eq(users.email, normalizeEmail(email))))
      .limit(1),
  );
}

/**
 * Every active account with this email and a password, oldest first: the login
 * candidates. Emails are unique per organization only, and the C4 login body has no
 * organization, so login must consider each match. Invited users (no password yet) and
 * deactivated users (C15) are left out, so they cannot log in.
 */
export async function listUsersByEmail(db: Db, email: string): Promise<UserWithPassword[]> {
  const rows = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.email, normalizeEmail(email)),
        eq(users.status, 'active'),
        isNotNull(users.passwordHash),
      ),
    )
    .orderBy(asc(users.createdAt), asc(users.id));
  return rows.filter(hasPassword);
}

export async function createUserSession(db: Db, input: NewUserSessionInput): Promise<UserSession> {
  const rows = await db
    .insert(userSessions)
    .values({
      id: input.id,
      organizationId: input.organizationId,
      userId: input.userId,
      environmentId: input.environmentId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      mfaSatisfied: input.mfaSatisfied ?? false,
      mfaVerifiedAt: input.mfaVerifiedAt ?? null,
      providerAmr:
        input.providerAmr === undefined || input.providerAmr === null
          ? null
          : [...input.providerAmr],
      ...(input.at === undefined
        ? {}
        : { createdAt: input.at, updatedAt: input.at, lastSeenAt: input.at }),
    })
    .returning();
  return inserted(rows, 'createUserSession');
}

/** The dashboard auth lookup: an unexpired, unrevoked session and its user. */
export async function findActiveUserSessionByTokenHash(
  db: Db,
  tokenHash: string,
  now: Date = new Date(),
): Promise<ActiveUserSession | null> {
  return firstOrNull(
    await db
      .select({ session: userSessions, user: users })
      .from(userSessions)
      .innerJoin(
        users,
        and(
          eq(users.organizationId, userSessions.organizationId),
          eq(users.id, userSessions.userId),
        ),
      )
      .where(
        and(
          eq(userSessions.tokenHash, tokenHash),
          isNull(userSessions.revokedAt),
          gt(userSessions.expiresAt, now),
          eq(users.status, 'active'),
        ),
      )
      .limit(1),
  );
}

/** Logs a session out. Returns false when it was already revoked or does not exist. */
export async function revokeUserSession(
  db: Db,
  id: string,
  at: Date = new Date(),
): Promise<boolean> {
  const rows = await db
    .update(userSessions)
    .set({ revokedAt: at })
    .where(and(eq(userSessions.id, id), isNull(userSessions.revokedAt)))
    .returning({ id: userSessions.id });
  return rows.length > 0;
}

export interface NewInvitedUserInput {
  id: string;
  organizationId: string;
  /** Normalised with {@link normalizeEmail} before it is stored. */
  email: string;
  name?: string | null;
  /** `hashSessionToken(token)` of the `ovi_...` invitation token (C9). */
  invitationTokenHash: string;
  /** C9: 7 days. */
  invitationExpiresAt: Date;
  /** The inviting user. */
  invitedBy?: string | null;
}

export interface AcceptInvitationInput {
  tokenHash: string;
  /** Argon2id PHC string of the chosen password. */
  passwordHash: string;
  name: string;
  /** Defaults to now. */
  now?: Date;
}

export interface InvitationRefresh {
  invitationTokenHash: string;
  invitationExpiresAt: Date;
}

export interface UserChanges {
  name?: string | null;
  /** C15 `PATCH /users/:id`: `active` or `deactivated`. */
  status?: Exclude<UserStatus, 'invited'>;
}

export interface ListUsersOptions extends PageRequest {
  status?: OneOrMany<UserStatus> | undefined;
}

const userCursor: CursorTable = {
  table: users,
  id: users.id,
  scope: users.organizationId,
  createdAt: users.createdAt,
};

const userInOrganization = (organizationId: string, id: string) =>
  and(eq(users.id, id), eq(users.organizationId, organizationId));

/** C15 `POST /users/invitations`: a user in status `invited`, without a password. */
export async function createInvitedUser(db: Db, input: NewInvitedUserInput): Promise<User> {
  const rows = await db
    .insert(users)
    .values({
      id: input.id,
      organizationId: input.organizationId,
      email: normalizeEmail(input.email),
      passwordHash: null,
      name: input.name ?? null,
      status: 'invited',
      invitationTokenHash: input.invitationTokenHash,
      invitationExpiresAt: input.invitationExpiresAt,
      invitedBy: input.invitedBy ?? null,
    })
    .returning();
  return inserted(rows, 'createInvitedUser');
}

/**
 * The invited user an unexpired `ovi_...` token belongs to, across organizations (the token
 * is what tells the organization), or `null`.
 */
export async function findInvitedUserByTokenHash(
  db: Db,
  tokenHash: string,
  now: Date = new Date(),
): Promise<User | null> {
  return firstOrNull(
    await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.invitationTokenHash, tokenHash),
          eq(users.status, 'invited'),
          gt(users.invitationExpiresAt, now),
        ),
      )
      .limit(1),
  );
}

/**
 * C15 `POST /invitations/accept`: sets the password and name and activates the user, once.
 * `null` for an unknown, used or expired token.
 */
export async function acceptInvitation(db: Db, input: AcceptInvitationInput): Promise<User | null> {
  return firstOrNull(
    await db
      .update(users)
      .set({
        status: 'active',
        passwordHash: input.passwordHash,
        name: input.name,
        invitationTokenHash: null,
        invitationExpiresAt: null,
      })
      .where(
        and(
          eq(users.invitationTokenHash, input.tokenHash),
          eq(users.status, 'invited'),
          gt(users.invitationExpiresAt, input.now ?? new Date()),
        ),
      )
      .returning(),
  );
}

/** A new token and expiry for a user still `invited` (re-sending an invitation). */
export async function refreshInvitation(
  db: Db,
  organizationId: string,
  id: string,
  refresh: InvitationRefresh,
): Promise<User | null> {
  return firstOrNull(
    await db
      .update(users)
      .set(refresh)
      .where(and(userInOrganization(organizationId, id), eq(users.status, 'invited')))
      .returning(),
  );
}

/** C15 `GET /users`: newest first, with a status filter. */
export async function listUsers(
  db: Db,
  organizationId: string,
  options: ListUsersOptions = {},
): Promise<Page<User>> {
  const filters = allFilters([
    eq(users.organizationId, organizationId),
    equalsAny(users.status, options.status),
  ]);
  if (filters === null) {
    return { items: [], next: null };
  }
  return paginate(db, userCursor, organizationId, options, (after, limit) =>
    db
      .select()
      .from(users)
      .where(and(...filters, after))
      .orderBy(...newestFirst(userCursor))
      .limit(limit),
  );
}

/**
 * C15 `PATCH /users/:id`: name and status. Deactivating does not end sessions by itself;
 * call {@link revokeUserSessionsForUser} in the same transaction.
 */
export async function updateUser(
  db: Db,
  organizationId: string,
  id: string,
  changes: UserChanges,
): Promise<User | null> {
  const set: Partial<typeof users.$inferInsert> = {};
  if (changes.name !== undefined) set.name = changes.name;
  if (changes.status !== undefined) set.status = changes.status;
  if (Object.keys(set).length === 0) {
    return getUser(db, organizationId, id);
  }
  return firstOrNull(
    await db.update(users).set(set).where(userInOrganization(organizationId, id)).returning(),
  );
}

/** Revokes every open session of a user (C15 deactivation). Returns the count. */
export async function revokeUserSessionsForUser(
  db: Db,
  organizationId: string,
  userId: string,
  at: Date = new Date(),
): Promise<number> {
  const rows = await db
    .update(userSessions)
    .set({ revokedAt: at })
    .where(
      and(
        eq(userSessions.organizationId, organizationId),
        eq(userSessions.userId, userId),
        isNull(userSessions.revokedAt),
      ),
    )
    .returning({ id: userSessions.id });
  return rows.length;
}

/**
 * C15 `PUT /sessions/current/environment`. The database refuses an environment of another
 * organization (composite foreign key). `null` when the session does not exist.
 */
export async function setUserSessionEnvironment(
  db: Db,
  sessionId: string,
  environmentId: string,
): Promise<UserSession | null> {
  return firstOrNull(
    await db
      .update(userSessions)
      .set({ environmentId })
      .where(eq(userSessions.id, sessionId))
      .returning(),
  );
}

/** Marks a session as having passed MFA (C15), e.g. after a factor was enrolled. */
export async function markUserSessionMfaSatisfied(
  db: Db,
  sessionId: string,
): Promise<UserSession | null> {
  return firstOrNull(
    await db
      .update(userSessions)
      .set({ mfaSatisfied: true })
      .where(eq(userSessions.id, sessionId))
      .returning(),
  );
}

/**
 * C168.1 (Workflow 9B): a second factor was checked on this session at `at` (a sign-in's factor, a
 * step-up or an enrolment): it starts the step-up window and satisfies MFA. `null` when the session
 * does not exist.
 */
export async function markUserSessionMfaVerified(
  db: Db,
  sessionId: string,
  at: Date,
): Promise<UserSession | null> {
  return firstOrNull(
    await db
      .update(userSessions)
      .set({ mfaSatisfied: true, mfaVerifiedAt: at, updatedAt: at })
      .where(eq(userSessions.id, sessionId))
      .returning(),
  );
}

/**
 * C168.4 (Workflow 9B): revokes every open session of the user but `keptSessionId` (enrolling a
 * factor, "revoke my other sessions"). Returns the count.
 */
export async function revokeOtherUserSessions(
  db: Db,
  organizationId: string,
  userId: string,
  keptSessionId: string,
  at: Date,
): Promise<number> {
  const rows = await db
    .update(userSessions)
    .set({ revokedAt: at })
    .where(
      and(
        eq(userSessions.organizationId, organizationId),
        eq(userSessions.userId, userId),
        ne(userSessions.id, keptSessionId),
        isNull(userSessions.revokedAt),
      ),
    )
    .returning({ id: userSessions.id });
  return rows.length;
}

/**
 * C168.1 (Workflow 9B; contracts B26): the live challenge a passkey step-up answers: the user's,
 * unexpired, unused and unrevoked, issued with the WebAuthn challenge whose SHA-256 is `challengeHash`.
 */
export async function findStepUpChallenge(
  db: Db,
  organizationId: string,
  userId: string,
  challengeHash: string,
  now: Date,
): Promise<MfaChallenge | null> {
  return firstOrNull(
    await db
      .select()
      .from(mfaChallenges)
      .where(
        and(
          eq(mfaChallenges.organizationId, organizationId),
          eq(mfaChallenges.userId, userId),
          eq(mfaChallenges.webauthnChallengeHash, challengeHash),
          isNull(mfaChallenges.consumedAt),
          isNull(mfaChallenges.revokedAt),
          gt(mfaChallenges.expiresAt, now),
        ),
      )
      .limit(1),
  );
}

/** C168.1 (Workflow 9B): one session by id, or `null` (the step-up rule reads `mfa_verified_at`). */
export async function getUserSession(db: Db, id: string): Promise<UserSession | null> {
  return firstOrNull(await db.select().from(userSessions).where(eq(userSessions.id, id)).limit(1));
}

/**
 * C168.1 `POST /dashboard/users/:id/reactivate` (Workflow 9B): a deactivated user becomes invited
 * again with a new token and expiry, keeping its id and history; its password is cleared, so only
 * the invitation signs it in again. `null` when the user is not deactivated.
 */
export async function reinviteDeactivatedUser(
  db: Db,
  organizationId: string,
  id: string,
  refresh: InvitationRefresh,
): Promise<User | null> {
  return firstOrNull(
    await db
      .update(users)
      .set({ status: 'invited', passwordHash: null, ...refresh })
      .where(and(userInOrganization(organizationId, id), eq(users.status, 'deactivated')))
      .returning(),
  );
}

/**
 * C168.4 (Workflow 9B): moves the session's "last seen" to `at` when it is older than `resolutionMs`,
 * so a session writes at most once per resolution. Returns whether it moved. C245.1 (Workflow 11B
 * Stage 1b (A); Stage 1a amendment 5): "last seen" is `last_seen_at`, which the idle limit reads.
 */
export async function touchUserSession(
  db: Db,
  id: string,
  at: Date,
  resolutionMs: number,
): Promise<boolean> {
  const rows = await db
    .update(userSessions)
    .set({ lastSeenAt: at, updatedAt: at })
    .where(
      and(
        eq(userSessions.id, id),
        lt(userSessions.lastSeenAt, new Date(at.getTime() - resolutionMs)),
      ),
    )
    .returning({ id: userSessions.id });
  return rows.length > 0;
}

/** C168.4 `GET /dashboard/sessions`: the user's live sessions, newest first. */
export async function listLiveUserSessions(
  db: Db,
  organizationId: string,
  userId: string,
  now: Date,
): Promise<UserSession[]> {
  return db
    .select()
    .from(userSessions)
    .where(
      and(
        eq(userSessions.organizationId, organizationId),
        eq(userSessions.userId, userId),
        isNull(userSessions.revokedAt),
        gt(userSessions.expiresAt, now),
      ),
    )
    .orderBy(desc(userSessions.createdAt), desc(userSessions.id));
}

/**
 * C168.4 `POST /dashboard/sessions/:id/revoke`: revokes one live session of the user. `false` when
 * the session is not the user's, does not exist or is no longer live.
 */
export async function revokeOwnUserSession(
  db: Db,
  organizationId: string,
  userId: string,
  sessionId: string,
  at: Date,
): Promise<boolean> {
  const rows = await db
    .update(userSessions)
    .set({ revokedAt: at })
    .where(
      and(
        eq(userSessions.id, sessionId),
        eq(userSessions.organizationId, organizationId),
        eq(userSessions.userId, userId),
        isNull(userSessions.revokedAt),
        gt(userSessions.expiresAt, at),
      ),
    )
    .returning({ id: userSessions.id });
  return rows.length > 0;
}

/** C168.5 (Workflow 9B): one user's confirmed factors of one kind. */
export interface UserFactorCount {
  userId: string;
  kind: (typeof mfaFactors.$inferSelect)['type'];
  count: number;
}

/** C168.5: the confirmed factors of these users, counted per kind (never a secret). */
export async function countConfirmedMfaFactors(
  db: Db,
  organizationId: string,
  userIds: readonly string[],
): Promise<UserFactorCount[]> {
  if (userIds.length === 0) {
    return [];
  }
  return db
    .select({
      userId: mfaFactors.userId,
      kind: mfaFactors.type,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(mfaFactors)
    .where(
      and(
        eq(mfaFactors.organizationId, organizationId),
        inArray(mfaFactors.userId, [...userIds]),
        isNotNull(mfaFactors.confirmedAt),
      ),
    )
    .groupBy(mfaFactors.userId, mfaFactors.type)
    .orderBy(asc(mfaFactors.userId), asc(mfaFactors.type));
}

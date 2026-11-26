/**
 * C15 operators: the organization's users with their roles, invitations (an `ovi_` token by
 * email, 7 days, single use), accepting them (name and an Argon2id password), and changing a
 * user's roles or status. The last active admin of an organization can be neither demoted nor
 * deactivated, and deactivation revokes the user's sessions.
 */
import {
  INVITATION_TOKEN_TTL_SECONDS,
  buildUserResource,
  filterValues,
  newInvitationToken,
  toTimestamp,
  userResourceSchema,
  userStatusSchema,
  type AuditActor,
  type EnvironmentKind,
  type RoleAssignment,
  type SetUserRolesBody,
  type UserResource,
} from '@openverify/contracts';
import {
  PERMISSIONS,
  permissionLevel,
  type Permission,
  type PermissionLevel,
} from '@openverify/core';
import {
  acceptInvitation as acceptStoredInvitation,
  countActiveUsersWithRole,
  countConfirmedMfaFactors,
  createInvitedUser,
  findInvitedUserByTokenHash,
  findUserByEmail,
  getEnvironment,
  getOrganization,
  getRoles,
  deleteMfaFactor,
  getUser,
  hashSessionToken,
  lastSignIns,
  listEnvironments,
  listUserRoleAssignments,
  listUserRoles,
  listUsers,
  lockOrganization,
  refreshInvitation,
  reinviteDeactivatedUser,
  replaceRecoveryCodes,
  listMfaFactors,
  revokeUserSessionsForUser,
  setUserRoleAssignments,
  setUserRoles,
  setUserSessionEnvironment,
  updateUser,
  userRoles,
  type Db,
  type Role,
  type User,
} from '@openverify/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  AppError,
  ConflictError,
  NotFoundError,
  PermissionDeniedError,
  UnprocessableContentError,
} from '../errors.js';
import { MailerNotConfiguredError, invitationAcceptUrl, invitationEmail } from '../mail/index.js';
import type { PasswordHasher } from '../operator-auth/password-hasher.js';
import { endUserSessions } from '../operator-auth/session-policy.js';
import type {
  AuditLogger,
  Clock,
  IdGenerator,
  MailMessage,
  Mailer,
  ServiceContext,
} from '../ports.js';
import { actorHasFactor, assertActorHoldsSupersetOf, assertSteppedUp } from './access/acting.js';
import { consoleSignInUrl, mfaResetNoticeEmail } from './access/notice-mails.js';
import { assignmentReaches, mayEnter, permissionsForEnvironment } from './access/permissions.js';
import { recordInEveryEnvironment, roleAssignmentsAuditMetadataSchema } from './access/audit.js';
import {
  assertGrantsHeld,
  changedPermissions,
  effectivePermissions,
  organizationWidePermissions,
  roleScopeInvalid,
  roleScopeProblems,
  type RequestedAssignment,
} from './access/grants.js';
import { AccessProblemError, noEnvironmentRole } from './access/problems.js';
import { auditEntryOf } from './context.js';
import { nextLink, pageRequest, withCursor, type PageQuery } from './pagination.js';
import { assertCanChangeAccess, assertCanGrant } from './roles.js';

/** The tenant, actor and permissions of a change made by a signed-in operator. */
export interface OperatorChange {
  ctx: ServiceContext;
  actor: AuditActor;
  permissions: ReadonlySet<Permission>;
}

export interface UsersServiceDeps {
  db: Db;
  audit: AuditLogger;
  clock: Clock;
  ids: IdGenerator;
}

export interface InvitationDeps extends UsersServiceDeps {
  mailer: Mailer;
  /** `OPENVERIFY_DASHBOARD_PUBLIC_URL`; without it there is no link to send (503). */
  dashboardPublicUrl: string | undefined;
}

/** 503 naming the setting that is missing. */
class NotConfiguredError extends AppError {
  override name = 'NotConfiguredError';

  constructor(detail: string) {
    super({ status: 503, detail });
  }
}

/** What may be logged of an SMTP failure: its kind, never its message (it can name people). */
export interface SmtpFailure {
  name: string;
  /** Nodemailer's code, such as `EAUTH`, `ETIMEDOUT` or `EENVELOPE`. */
  code?: string;
  /** The SMTP reply code, such as 535. */
  responseCode?: number;
  /** The SMTP command that failed, such as `AUTH PLAIN`. */
  command?: string;
}

function smtpFailureOf(error: unknown): SmtpFailure {
  const source = (typeof error === 'object' && error !== null ? error : {}) as Record<
    string,
    unknown
  >;
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
  const code = text(source.code);
  const command = text(source.command);
  const responseCode = typeof source.responseCode === 'number' ? source.responseCode : undefined;
  return {
    name: error instanceof Error ? error.name : typeof error,
    ...(code === undefined ? {} : { code }),
    ...(responseCode === undefined ? {} : { responseCode }),
    ...(command === undefined ? {} : { command }),
  };
}

/**
 * 502: the SMTP server refused or could not be reached. `smtp` keeps the failure's kind, which
 * the error handler logs with the error, so a broken mail setup can be diagnosed; the SMTP
 * message is dropped, since it can carry the recipient's address (Workflow 2B F033).
 */
class MailDeliveryError extends AppError {
  override name = 'MailDeliveryError';
  readonly smtp: SmtpFailure;

  constructor(cause: unknown) {
    super({ status: 502, detail: 'The invitation email could not be sent. Try again later.' });
    this.smtp = smtpFailureOf(cause);
  }
}

/** The C15 user resource; with `roleIds`, its `roles` relationship too. Never credentials. */
export function toUserResource(
  row: User,
  roleIds?: readonly string[],
  mfaEnabled?: boolean,
): UserResource {
  return buildUserResource({
    id: row.id,
    email: row.email,
    name: row.name,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(mfaEnabled === undefined ? {} : { mfaEnabled }),
    ...(roleIds === undefined ? {} : { roleIds }),
  });
}

/** The role ids each user holds, oldest role first, in one query. */
async function roleIdsByUser(
  db: Db,
  organizationId: string,
  userIds: readonly string[],
): Promise<Map<string, string[]>> {
  const byUser = new Map<string, string[]>(userIds.map((id) => [id, []]));
  if (userIds.length === 0) {
    return byUser;
  }
  const rows = await db
    .select({ userId: userRoles.userId, roleId: userRoles.roleId })
    .from(userRoles)
    .where(
      and(eq(userRoles.organizationId, organizationId), inArray(userRoles.userId, [...userIds])),
    )
    .orderBy(asc(userRoles.createdAt), asc(userRoles.roleId));
  for (const { userId, roleId } of rows) {
    byUser.get(userId)?.push(roleId);
  }
  return byUser;
}

/** The user resource with its roles. */
export async function userResourceOf(db: Db, user: User): Promise<UserResource> {
  const roles = await listUserRoles(db, user.organizationId, user.id);
  return toUserResource(
    user,
    roles.map(({ id }) => id),
  );
}

/** `GET /dashboard/users` query, as validated by `listUsersQuerySchema`. */
export interface ListUsersQuery extends PageQuery {
  'filter[status]'?: string | undefined;
  'filter[created-at-start]'?: string | undefined;
  'filter[created-at-end]'?: string | undefined;
}

/**
 * `GET /dashboard/users`: the organization's users, newest first, with their roles. C168.5
 * (Workflow 9B; review P20): their MFA status (`mfa-enabled`, and the factor kinds with their
 * counts) and last sign-in are served only when `options.mfaStatus` (the caller holds
 * `users:write`), so a holder of `users:read` alone cannot list the accounts without MFA. The last
 * sign-in is the newest `user-session.created` entry of the audit log (`null` when never, or past
 * `audit-log-retention-days`).
 */
export async function listUsersDocument(
  db: Db,
  organizationId: string,
  query: ListUsersQuery,
  path: string,
  options: { mfaStatus?: boolean } = {},
): Promise<{ data: UserResource[]; links: { next: string | null } }> {
  const page = await withCursor(() =>
    listUsers(db, organizationId, {
      ...pageRequest(query),
      status: filterValues(query['filter[status]'], userStatusSchema),
    }),
  );
  const userIds = page.items.map(({ id }) => id);
  const mfaStatus = options.mfaStatus === true;
  const environmentIds = mfaStatus
    ? (await listEnvironments(db, organizationId)).map(({ id }) => id)
    : [];
  const [roles, factors, signIns] = await Promise.all([
    roleIdsByUser(db, organizationId, userIds),
    mfaStatus ? countConfirmedMfaFactors(db, organizationId, userIds) : Promise.resolve([]),
    mfaStatus ? lastSignIns(db, environmentIds, userIds) : Promise.resolve(new Map<string, Date>()),
  ]);
  return {
    data: page.items.map((user) => {
      const own = factors.filter((factor) => factor.userId === user.id);
      const resource = toUserResource(
        user,
        roles.get(user.id) ?? [],
        mfaStatus ? own.length > 0 : undefined,
      );
      if (!mfaStatus) {
        return resource;
      }
      const signedIn = signIns.get(user.id);
      return userResourceSchema.parse({
        ...resource,
        attributes: {
          ...resource.attributes,
          'mfa-factors': own.map(({ kind, count }) => ({ kind, count })),
          'last-sign-in-at': signedIn === undefined ? null : toTimestamp(signedIn),
        },
      });
    }),
    links: {
      next: nextLink(path, { 'filter[status]': query['filter[status]'] }, query, page.next),
    },
  };
}

/**
 * The organization's roles with these ids, after checking the actor may grant them.
 * @throws {UnprocessableContentError} when an id names no role of the organization.
 * @throws {PermissionDeniedError} when a role grants a permission the actor lacks.
 */
async function grantableRoles(
  db: Db,
  change: OperatorChange,
  roleIds: readonly string[],
  pointer: string,
): Promise<Role[]> {
  const found = await getRoles(db, change.ctx.organizationId, roleIds);
  if (found.length !== new Set(roleIds).size) {
    throw new UnprocessableContentError('A role id names no role of this organization.', [
      { location: 'body', pointer, detail: 'names a role that does not exist' },
    ]);
  }
  assertCanGrant(
    change.permissions,
    found.flatMap((role) => role.permissions),
  );
  // C167.2 (Workflow 9B; contracts B25): `role-ids` mean every environment, so the operator must
  // hold the permissions organisation-wide, through its own organisation-wide assignments.
  assertGrantsHeld(
    await actorAssignments(db, change),
    [{ scope: null, permissions: found.flatMap((role) => role.permissions) }],
    'grant',
  );
  return found;
}

/** The operator's own assignments (C167.2), which say what it holds in each environment. */
function actorAssignments(db: Db, change: OperatorChange) {
  return listUserRoleAssignments(db, change.ctx.organizationId, change.actor.id);
}

/**
 * Checks that the actor holds every permission of the `current` roles that `roleIds` drops: a
 * role can be taken away only by someone who could grant it (Workflow 2D K002).
 * @throws {PermissionDeniedError} naming the permissions the actor lacks.
 */
function assertCanRemoveRoles(
  change: OperatorChange,
  current: readonly Role[],
  roleIds: readonly string[],
): void {
  const kept = new Set(roleIds);
  assertCanChangeAccess(
    change.permissions,
    current.filter((role) => !kept.has(role.id)).flatMap((role) => role.permissions),
    'remove',
  );
}

export interface InvitationResult {
  email: string;
  roleIds: string[];
  expiresAt: Date;
}

/**
 * `POST /dashboard/users/invitations`: an invited user (or a fresh link for one still
 * invited) with the given roles, and the email with the acceptance link. The user, its roles
 * and the audit entry are committed only once the email was handed to the SMTP server.
 * @throws {ConflictError} when a user with this email exists and is not invited.
 * @throws {AppError} 503 without a dashboard URL or SMTP, 502 when sending fails.
 */
export async function inviteUser(
  deps: InvitationDeps,
  change: OperatorChange,
  input: { email: string; roleIds: readonly string[] },
): Promise<InvitationResult> {
  const { db } = deps;
  if (deps.dashboardPublicUrl === undefined) {
    throw new NotConfiguredError(
      'Invitations are not configured: set OPENVERIFY_DASHBOARD_PUBLIC_URL.',
    );
  }
  const dashboardPublicUrl = deps.dashboardPublicUrl;
  const { organizationId } = change.ctx;
  await grantableRoles(db, change, input.roleIds, '/role-ids');
  const token = newInvitationToken();
  const expiresAt = new Date(deps.clock.now().getTime() + INVITATION_TOKEN_TTL_SECONDS * 1000);
  const organization = await getOrganization(db, organizationId);
  const invitation = {
    invitationTokenHash: hashSessionToken(token),
    invitationExpiresAt: expiresAt,
  };

  const user = await db.transaction(async (tx) => {
    const existing = await findUserByEmail(tx, organizationId, input.email);
    if (existing !== null && existing.status !== 'invited') {
      throw new ConflictError('A user with this email already exists in the organization.');
    }
    if (existing !== null) {
      // A fresh invitation replaces the roles: dropping one takes access away (2D K002).
      assertCanRemoveRoles(
        change,
        await listUserRoles(tx, organizationId, existing.id),
        input.roleIds,
      );
    }
    const invited =
      existing === null
        ? await createInvitedUser(tx, {
            id: deps.ids.newId('usr'),
            organizationId,
            email: input.email,
            invitedBy: change.actor.id,
            ...invitation,
          })
        : await refreshInvitation(tx, organizationId, existing.id, invitation);
    if (invited === null) {
      throw new ConflictError('The user is no longer invited.');
    }
    await setUserRoles(tx, organizationId, invited.id, input.roleIds);
    // C167.2: an organisation-level action, audited in every environment.
    await recordInEveryEnvironment(tx, deps.audit, change.ctx, change.actor, {
      action: 'user.invited',
      resourceType: 'user',
      resourceId: invited.id,
      metadata: { 'role-ids': [...input.roleIds] },
    });
    try {
      await deps.mailer.send(
        invitationEmail({
          to: invited.email,
          organizationName: organization?.name ?? 'your organization',
          acceptUrl: invitationAcceptUrl(dashboardPublicUrl, token),
          expiresAt,
        }),
      );
    } catch (error) {
      if (error instanceof MailerNotConfiguredError) {
        throw new NotConfiguredError(error.message);
      }
      throw new MailDeliveryError(error);
    }
    return invited;
  });
  return { email: user.email, roleIds: [...input.roleIds], expiresAt };
}

/**
 * `POST /dashboard/invitations/accept`: sets the name and password of the invited user once,
 * and records `user.invitation-accepted` in every environment of its organization (the
 * invitee has no session environment yet).
 * @throws {NotFoundError} for an unknown, used or expired token.
 */
export async function acceptInvitation(
  deps: UsersServiceDeps & { hasher: PasswordHasher },
  input: { token: string; password: string; name: string },
  request: Omit<ServiceContext, 'organizationId' | 'environmentId'>,
): Promise<UserResource> {
  const { db } = deps;
  const tokenHash = hashSessionToken(input.token);
  // Look the token up first: an unknown token must not cost an Argon2id hash.
  if ((await findInvitedUserByTokenHash(db, tokenHash, deps.clock.now())) === null) {
    throw new NotFoundError('The invitation does not exist, was used, or has expired.');
  }
  const passwordHash = await deps.hasher.hash(input.password);
  const user = await db.transaction(async (tx) => {
    // Accepting is atomic: of two concurrent requests with the token, one wins.
    const accepted = await acceptStoredInvitation(tx, {
      tokenHash,
      passwordHash,
      name: input.name,
      now: deps.clock.now(),
    });
    if (accepted === null) {
      throw new NotFoundError('The invitation does not exist, was used, or has expired.');
    }
    for (const environment of await listEnvironments(tx, accepted.organizationId)) {
      await deps.audit.record(
        tx,
        auditEntryOf(
          { ...request, organizationId: accepted.organizationId, environmentId: environment.id },
          { type: 'user', id: accepted.id },
          { action: 'user.invitation-accepted', resourceType: 'user', resourceId: accepted.id },
        ),
      );
    }
    return accepted;
  });
  return userResourceOf(db, user);
}

/** The detail of `user_reactivation_required` (AC2), naming the route that reactivates. */
const REACTIVATION_REQUIRED =
  'A deactivated user is reactivated through POST /dashboard/users/:id/reactivate, which sends a ' +
  'new invitation and gives no role back.';

/**
 * `PATCH /dashboard/users/:id`: replaces the roles and/or sets the status. Serialized per
 * organization, so two changes cannot together remove the last active admin. The actor must
 * hold every permission of the roles it grants or removes, and of the user whose status it
 * changes (Workflow 2D K002).
 * @throws {NotFoundError} for a user of another organization.
 * @throws {ConflictError} for the last active admin, or a status change of an invited user.
 * @throws {AccessProblemError} 422 `user_reactivation_required` for `status: active` on a
 *   deactivated user (AC2): `POST /dashboard/users/:id/reactivate` reactivates.
 * @throws {PermissionDeniedError} for access beyond the actor's own.
 */
export async function updateOperator(
  deps: UsersServiceDeps,
  change: OperatorChange,
  userId: string,
  attributes: { 'role-ids'?: string[] | undefined; status?: 'active' | 'deactivated' | undefined },
  options: { sessionId?: string | undefined } = {},
): Promise<UserResource> {
  const { db } = deps;
  const { organizationId } = change.ctx;
  const roleIds = attributes['role-ids'];
  const { status } = attributes;
  if (roleIds !== undefined) {
    await grantableRoles(db, change, roleIds, '/data/attributes/role-ids');
  }
  const user = await db.transaction(async (tx) => {
    await lockOrganization(tx, organizationId);
    const target = await getUser(tx, organizationId, userId);
    if (target === null) {
      throw new NotFoundError('No user with this id exists.');
    }
    if (status !== undefined && target.status === 'invited') {
      throw new ConflictError('An invited user becomes active by accepting the invitation.');
    }
    if (status === 'active' && target.status === 'deactivated') {
      // Orchestrator decision AC2 before Workflow 9C: PATCH would give every role back and skip
      // C168.1's new invitation, superset rule and step-up, so only POST /reactivate reactivates.
      throw new AccessProblemError('user_reactivation_required', REACTIVATION_REQUIRED, [
        {
          location: 'body',
          pointer: '/data/attributes/status',
          detail: 'Status active is set only by POST /dashboard/users/:id/reactivate.',
        },
      ]);
    }
    const current = await listUserRoles(tx, organizationId, userId);
    if (roleIds !== undefined) {
      assertCanRemoveRoles(change, current, roleIds);
      // C167.2: what the user loses in each environment, the operator must hold there.
      const environmentIds = (await listEnvironments(tx, organizationId)).map(({ id }) => id);
      const replaced = (await getRoles(tx, organizationId, roleIds)).map((role) => ({
        role,
        environmentIds: null,
      }));
      const { removed } = changedPermissions(
        effectivePermissions(
          await listUserRoleAssignments(tx, organizationId, userId),
          environmentIds,
        ),
        effectivePermissions(replaced, environmentIds),
      );
      assertGrantsHeld(await actorAssignments(tx, change), removed, 'remove');
    }
    if (status !== undefined && status !== target.status) {
      // Deactivating takes the user's access away, reactivating restores it (2D K002).
      assertCanChangeAccess(
        change.permissions,
        current.flatMap((role) => role.permissions),
        'change-status',
      );
      // C168.1 (Workflow 9B; P02, V05): a superset of the user's permissions wherever it can enter,
      // and a recent factor check from an actor who has a factor. The status change keeps its
      // Phase 2 meaning (a reversible suspension, roles kept); POST /reactivate is C168.1's.
      await assertActorHoldsSupersetOf(tx, organizationId, change.actor.id, userId);
      if (await actorHasFactor(tx, organizationId, change.actor.id)) {
        await assertSteppedUp(tx, options.sessionId, deps.clock.now());
      }
    }
    const admin = current.find((role) => role.key === 'admin');
    const losesAdmin =
      admin !== undefined &&
      target.status === 'active' &&
      (status === 'deactivated' || (roleIds !== undefined && !roleIds.includes(admin.id)));
    if (
      losesAdmin &&
      (await countActiveUsersWithRole(tx, organizationId, 'admin', { excludingUserId: userId })) ===
        0
    ) {
      throw new ConflictError(
        'The organization’s last active admin cannot be demoted or deactivated.',
      );
    }
    if (roleIds !== undefined) {
      await setUserRoles(tx, organizationId, userId, roleIds);
      // C245.3 (Workflow 11B Stage 1b (A); auth-sessions' session-policy.ts): the sessions working
      // where the user no longer holds a role end with the change (amendment 4).
      await endUserSessions(tx, {
        organizationId,
        userId,
        now: deps.clock.now(),
        cause: 'role-change',
      });
    }
    let updated = target;
    if (status !== undefined && status !== target.status) {
      updated = (await updateUser(tx, organizationId, userId, { status })) ?? target;
      if (status === 'deactivated') {
        await revokeUserSessionsForUser(tx, organizationId, userId, deps.clock.now());
      }
    }
    await recordInEveryEnvironment(tx, deps.audit, change.ctx, change.actor, {
      action: 'user.updated',
      resourceType: 'user',
      resourceId: userId,
      metadata: {
        ...(roleIds === undefined ? {} : { 'role-ids': roleIds }),
        ...(status === undefined ? {} : { status }),
      },
    });
    return updated;
  });
  return userResourceOf(db, user);
}

/**
 * `PUT /dashboard/sessions/current/environment`: moves the session into another environment
 * of its organization and records `environment.switched` there. C167.2 (Workflow 9B; review F29):
 * the user must hold a role there, and production needs `environments:production` held there (C15).
 * @throws {NotFoundError} for an environment of another organization.
 * @throws {AccessProblemError} 403 `no_environment_role` where the user holds no role.
 * @throws {PermissionDeniedError} for production without `environments:production` there.
 */
export async function switchSessionEnvironment(
  deps: Pick<UsersServiceDeps, 'db' | 'audit'>,
  change: OperatorChange,
  sessionId: string,
  environmentId: string,
): Promise<{ id: string; kind: EnvironmentKind }> {
  const { db } = deps;
  const environment = await getEnvironment(db, environmentId);
  if (environment?.organizationId !== change.ctx.organizationId) {
    throw new NotFoundError('No environment with this id exists.');
  }
  const assignments = await listUserRoleAssignments(db, change.ctx.organizationId, change.actor.id);
  const reaching = assignments.filter((assignment) =>
    assignmentReaches(assignment, environment.id),
  );
  if (!mayEnter(reaching, { id: environment.id, kind: 'sandbox' })) {
    throw noEnvironmentRole();
  }
  const there = permissionsForEnvironment(reaching, environment.id);
  if (environment.kind === 'production' && !there.has('environments:production')) {
    throw new PermissionDeniedError(
      'The user is missing the required permission: environments:production.',
      ['environments:production'],
    );
  }
  await db.transaction(async (tx) => {
    await setUserSessionEnvironment(tx, sessionId, environment.id);
    await deps.audit.record(
      tx,
      auditEntryOf({ ...change.ctx, environmentId: environment.id }, change.actor, {
        action: 'environment.switched',
        resourceType: 'environment',
        resourceId: environment.id,
        metadata: { from: change.ctx.environmentId },
      }),
    );
  });
  return { id: environment.id, kind: environment.kind };
}

/** `PUT /dashboard/users/:id/roles`'s answer: the assignments as stored. */
export interface UserRoleAssignmentsResult {
  userId: string;
  assignments: RoleAssignment[];
}

/**
 * C167.3 `PUT /dashboard/users/:id/roles` (C167.2; decisions 49 and 70, review P01): replaces the
 * user's assignments, each a role and the environments it is granted in, or `null` for every current
 * and future one. Serialized per organization, like every role change, so two changes cannot
 * together remove the last organisation-wide admin. Audited in every environment.
 * @throws {NotFoundError} for a user of another organization.
 * @throws {UnprocessableContentError} for a role or an environment not of the organization.
 * @throws {AccessProblemError} 422 `role_scope_invalid` for an organisation-level permission or the
 *   admin role in a narrower assignment.
 * @throws {PermissionDeniedError} when the operator does not hold, in an environment, a permission
 *   it grants there or the user loses there.
 * @throws {ConflictError} for the last active organisation-wide admin.
 */
export async function setUserRoleAssignmentsOf(
  deps: UsersServiceDeps,
  change: OperatorChange,
  userId: string,
  body: SetUserRolesBody,
): Promise<UserRoleAssignmentsResult> {
  const { db } = deps;
  const { organizationId } = change.ctx;
  if ((await getUser(db, organizationId, userId)) === null) {
    throw new NotFoundError('No user with this id exists.');
  }
  const roles = new Map(
    (
      await getRoles(
        db,
        organizationId,
        body.assignments.map((assignment) => assignment['role-id']),
      )
    ).map((role) => [role.id, role]),
  );
  const environmentIds = (await listEnvironments(db, organizationId)).map(({ id }) => id);
  const known = new Set(environmentIds);
  const invalid = body.assignments.flatMap((assignment, index) => [
    ...(roles.has(assignment['role-id'])
      ? []
      : [
          {
            location: 'body' as const,
            pointer: `/assignments/${String(index)}/role-id`,
            detail: 'names a role that does not exist',
          },
        ]),
    ...((assignment['environment-ids'] ?? []).every((id) => known.has(id))
      ? []
      : [
          {
            location: 'body' as const,
            pointer: `/assignments/${String(index)}/environment-ids`,
            detail: 'names an environment that is not one of this organization',
          },
        ]),
  ]);
  if (invalid.length > 0) {
    throw new UnprocessableContentError(
      'An assignment names a role or an environment that does not exist.',
      invalid,
    );
  }
  const requested: RequestedAssignment[] = body.assignments.flatMap((assignment) => {
    const role = roles.get(assignment['role-id']);
    return role === undefined ? [] : [{ role, environmentIds: assignment['environment-ids'] }];
  });
  const scopeProblems = roleScopeProblems(requested);
  if (scopeProblems.length > 0) {
    throw roleScopeInvalid(scopeProblems);
  }
  assertGrantsHeld(
    await actorAssignments(db, change),
    requested.flatMap((assignment) =>
      (assignment.environmentIds ?? [null]).map((scope) => ({
        scope,
        permissions: assignment.role.permissions,
      })),
    ),
    'grant',
  );
  await db.transaction(async (tx) => {
    await lockOrganization(tx, organizationId);
    const target = await getUser(tx, organizationId, userId);
    if (target === null) {
      throw new NotFoundError('No user with this id exists.');
    }
    const current = await listUserRoleAssignments(tx, organizationId, userId);
    const { removed } = changedPermissions(
      effectivePermissions(current, environmentIds),
      effectivePermissions(requested, environmentIds),
    );
    assertGrantsHeld(await actorAssignments(tx, change), removed, 'remove');
    const wideAdmin = (assignments: readonly { role: Role; environmentIds: unknown }[]) =>
      assignments.some(
        (assignment) =>
          assignment.environmentIds === null &&
          assignment.role.builtin &&
          assignment.role.key === 'admin',
      );
    if (
      target.status === 'active' &&
      wideAdmin(current) &&
      !wideAdmin(requested) &&
      (await countActiveUsersWithRole(tx, organizationId, 'admin', { excludingUserId: userId })) ===
        0
    ) {
      throw new ConflictError(
        'The organization’s last active admin cannot be demoted or deactivated.',
      );
    }
    await setUserRoleAssignments(
      tx,
      organizationId,
      userId,
      requested.map((assignment) => ({
        roleId: assignment.role.id,
        environmentIds: assignment.environmentIds,
      })),
    );
    // C245.3 (Workflow 11B Stage 1b (A); auth-sessions' session-policy.ts): the same on PUT roles.
    await endUserSessions(tx, {
      organizationId,
      userId,
      now: deps.clock.now(),
      cause: 'role-change',
    });
    await recordInEveryEnvironment(tx, deps.audit, change.ctx, change.actor, {
      action: 'user.roles-assigned',
      resourceType: 'user',
      resourceId: userId,
      metadata: roleAssignmentsAuditMetadataSchema.parse({ assignments: body.assignments }),
    });
  });
  return { userId, assignments: body.assignments };
}

/**
 * K9-22 (Workflow 9D, DS8): `GET /dashboard/users/:id/roles`, the user's assignments as `PUT`
 * stored them, oldest role first.
 * @throws {NotFoundError} for a user of another organization.
 */
export async function userRoleAssignmentsOf(
  db: Db,
  organizationId: string,
  userId: string,
): Promise<UserRoleAssignmentsResult> {
  if ((await getUser(db, organizationId, userId)) === null) {
    throw new NotFoundError('No user with this id exists.');
  }
  const assignments = await listUserRoleAssignments(db, organizationId, userId);
  return {
    userId,
    assignments: assignments.map((assignment) => ({
      'role-id': assignment.role.id,
      'environment-ids': assignment.environmentIds,
    })),
  };
}

/** `GET /dashboard/users/:id/permissions`'s answer (K9-22). */
export interface UserEffectivePermissions {
  userId: string;
  /** The organisation-level permissions, held only through organisation-wide assignments. */
  organization: Permission[];
  /** Per environment, oldest first: the environment-level permissions and whether it is entered. */
  environments: { environmentId: string; mayEnter: boolean; permissions: Permission[] }[];
}

/**
 * K9-22 (Workflow 9D, DS8): what the user's assignments give (C167.2), through the rules the
 * session reads (`permissionsForEnvironment`, `mayEnter`): the organisation-level permissions once,
 * the environment-level ones per environment, each in `PERMISSIONS` order.
 * @throws {NotFoundError} for a user of another organization.
 */
export async function userEffectivePermissionsOf(
  db: Db,
  organizationId: string,
  userId: string,
): Promise<UserEffectivePermissions> {
  if ((await getUser(db, organizationId, userId)) === null) {
    throw new NotFoundError('No user with this id exists.');
  }
  const assignments = await listUserRoleAssignments(db, organizationId, userId);
  const ordered = (held: ReadonlySet<Permission>, level: PermissionLevel) =>
    PERMISSIONS.filter(
      (permission) => held.has(permission) && permissionLevel(permission) === level,
    );
  return {
    userId,
    organization: ordered(organizationWidePermissions(assignments), 'organization'),
    environments: (await listEnvironments(db, organizationId)).map((environment) => ({
      environmentId: environment.id,
      mayEnter: mayEnter(assignments, environment),
      permissions: ordered(permissionsForEnvironment(assignments, environment.id), 'environment'),
    })),
  };
}

/** Sends `message`, mapping a missing mailer to 503 and an SMTP failure to 502. */
async function sendOrFail(mailer: Mailer, message: MailMessage): Promise<void> {
  try {
    await mailer.send(message);
  } catch (error) {
    if (error instanceof MailerNotConfiguredError) {
      throw new NotConfiguredError(error.message);
    }
    throw new MailDeliveryError(error);
  }
}

function invitationsConfigured(deps: InvitationDeps): string {
  if (deps.dashboardPublicUrl === undefined) {
    throw new NotConfiguredError(
      'Invitations are not configured: set OPENVERIFY_DASHBOARD_PUBLIC_URL.',
    );
  }
  return deps.dashboardPublicUrl;
}

/** A new invitation token and its expiry, 7 days from now (C9, decision 47). */
function freshInvitation(deps: Pick<InvitationDeps, 'clock'>) {
  const token = newInvitationToken();
  const expiresAt = new Date(deps.clock.now().getTime() + INVITATION_TOKEN_TTL_SECONDS * 1000);
  return {
    token,
    expiresAt,
    refresh: { invitationTokenHash: hashSessionToken(token), invitationExpiresAt: expiresAt },
  };
}

/**
 * C168.1 `POST /dashboard/invitations/:id/resend` (Workflow 9B; decision 47): a new `ovi_` token for
 * a user still invited, which revokes the old one, valid 7 days, emailed like an invitation. The
 * operator holds a superset of the invited user's permissions (the resend gives them access).
 * Committed only once the email was handed to the SMTP server; audited in every environment.
 * @throws {NotFoundError} for a user of another organization.
 * @throws {ConflictError} for a user who is not invited.
 * @throws {AccessProblemError} 403 `user_more_privileged`.
 * @throws {AppError} 503 without a dashboard URL or SMTP, 502 when sending fails.
 */
export async function resendInvitation(
  deps: InvitationDeps,
  change: OperatorChange,
  userId: string,
): Promise<InvitationResult> {
  const dashboardPublicUrl = invitationsConfigured(deps);
  const { db } = deps;
  const { organizationId } = change.ctx;
  const organization = await getOrganization(db, organizationId);
  const { token, expiresAt, refresh } = freshInvitation(deps);
  const user = await db.transaction(async (tx) => {
    const target = await getUser(tx, organizationId, userId);
    if (target === null) {
      throw new NotFoundError('No user with this id exists.');
    }
    if (target.status !== 'invited') {
      throw new ConflictError('Only a user who is still invited can be sent the invitation again.');
    }
    await assertActorHoldsSupersetOf(tx, organizationId, change.actor.id, userId);
    const refreshed = await refreshInvitation(tx, organizationId, userId, refresh);
    if (refreshed === null) {
      throw new ConflictError('The user is no longer invited.');
    }
    await recordInEveryEnvironment(tx, deps.audit, change.ctx, change.actor, {
      action: 'user.invitation-resent',
      resourceType: 'user',
      resourceId: userId,
    });
    await sendOrFail(
      deps.mailer,
      invitationEmail({
        to: refreshed.email,
        organizationName: organization?.name ?? 'your organization',
        acceptUrl: invitationAcceptUrl(dashboardPublicUrl, token),
        expiresAt,
      }),
    );
    return refreshed;
  });
  const roles = await listUserRoles(db, organizationId, user.id);
  return { email: user.email, roleIds: roles.map(({ id }) => id), expiresAt };
}

/**
 * C168.1 `POST /dashboard/users/:id/reactivate` (Workflow 9B; reviews P02, V05): a deactivated user
 * becomes invited again with a new 7 day invitation, keeping its id and history, its password
 * cleared and **no role back** (roles are granted again through `PUT /dashboard/users/:id/roles`).
 * Needs the superset of the user's permissions and a factor verified within ten minutes on the
 * operator's session. Committed only once the invitation was handed to the SMTP server; audited in
 * every environment.
 * @throws {NotFoundError} for a user of another organization.
 * @throws {ConflictError} for a user who is not deactivated.
 * @throws {AccessProblemError} 403 `user_more_privileged` or `step_up_required`.
 * @throws {AppError} 503 without a dashboard URL or SMTP, 502 when sending fails.
 */
export async function reactivateUser(
  deps: InvitationDeps,
  change: OperatorChange,
  userId: string,
  options: { sessionId?: string | undefined } = {},
): Promise<UserResource> {
  const dashboardPublicUrl = invitationsConfigured(deps);
  const { db } = deps;
  const { organizationId } = change.ctx;
  const organization = await getOrganization(db, organizationId);
  const { token, expiresAt, refresh } = freshInvitation(deps);
  const user = await db.transaction(async (tx) => {
    await lockOrganization(tx, organizationId);
    const target = await getUser(tx, organizationId, userId);
    if (target === null) {
      throw new NotFoundError('No user with this id exists.');
    }
    if (target.status !== 'deactivated') {
      throw new ConflictError('Only a deactivated user can be reactivated.');
    }
    await assertActorHoldsSupersetOf(tx, organizationId, change.actor.id, userId);
    await assertSteppedUp(tx, options.sessionId, deps.clock.now());
    const reinvited = await reinviteDeactivatedUser(tx, organizationId, userId, refresh);
    if (reinvited === null) {
      throw new ConflictError('Only a deactivated user can be reactivated.');
    }
    await setUserRoleAssignments(tx, organizationId, userId, []);
    await recordInEveryEnvironment(tx, deps.audit, change.ctx, change.actor, {
      action: 'user.reactivated',
      resourceType: 'user',
      resourceId: userId,
    });
    await sendOrFail(
      deps.mailer,
      invitationEmail({
        to: reinvited.email,
        organizationName: organization?.name ?? 'your organization',
        acceptUrl: invitationAcceptUrl(dashboardPublicUrl, token),
        expiresAt,
      }),
    );
    return reinvited;
  });
  return toUserResource(user, []);
}

/** How the reset notice went, as the audit records it (never the address). */
export type MfaResetNoticeOutcome = 'sent' | 'not-configured' | 'failed';

/**
 * C168.3 `POST /dashboard/users/:id/reset-mfa` (Workflow 9B; decision 46): removes the user's factors
 * and recovery codes and revokes every session of the user, in one transaction audited in every
 * environment; never on oneself; the superset and step-up rules of C168.1 apply. With `require-mfa`
 * the user enrols again at the next sign-in. Afterwards, when the mailer and the dashboard URL are
 * configured, the user is sent a notice holding a link to the sign-in page only; its outcome is
 * audited, and a notice that could not be sent does not undo the reset. `user:reset-mfa` stays for
 * self-hosters.
 * @throws {NotFoundError} for a user of another organization.
 * @throws {ConflictError} on oneself.
 * @throws {AccessProblemError} 403 `user_more_privileged` or `step_up_required`.
 */
export async function resetUserMfaByOperator(
  deps: InvitationDeps,
  change: OperatorChange,
  userId: string,
  options: { sessionId?: string | undefined } = {},
): Promise<UserResource> {
  const { db } = deps;
  const { organizationId } = change.ctx;
  if (userId === change.actor.id) {
    throw new ConflictError(
      'You cannot reset your own second factors here; remove or replace a factor in your account.',
    );
  }
  const target = await db.transaction(async (tx) => {
    const found = await getUser(tx, organizationId, userId);
    if (found === null) {
      throw new NotFoundError('No user with this id exists.');
    }
    await assertActorHoldsSupersetOf(tx, organizationId, change.actor.id, userId);
    await assertSteppedUp(tx, options.sessionId, deps.clock.now());
    const factors = await listMfaFactors(tx, organizationId, userId);
    for (const factor of factors) {
      await deleteMfaFactor(tx, organizationId, userId, factor.id);
    }
    await replaceRecoveryCodes(tx, organizationId, userId, []);
    const sessionsRevoked = await revokeUserSessionsForUser(
      tx,
      organizationId,
      userId,
      deps.clock.now(),
    );
    await recordInEveryEnvironment(tx, deps.audit, change.ctx, change.actor, {
      action: 'user.mfa-reset',
      resourceType: 'user',
      resourceId: userId,
      metadata: { 'factors-removed': factors.length, 'sessions-revoked': sessionsRevoked },
    });
    return found;
  });
  let outcome: MfaResetNoticeOutcome = 'not-configured';
  if (deps.dashboardPublicUrl !== undefined && deps.mailer.configured) {
    const organization = await getOrganization(db, organizationId);
    try {
      await deps.mailer.send(
        mfaResetNoticeEmail({
          to: target.email,
          organizationName: organization?.name ?? 'your organization',
          signInUrl: consoleSignInUrl(deps.dashboardPublicUrl),
        }),
      );
      outcome = 'sent';
    } catch (error) {
      outcome = error instanceof MailerNotConfiguredError ? 'not-configured' : 'failed';
    }
  }
  await recordInEveryEnvironment(db, deps.audit, change.ctx, change.actor, {
    action: 'user.mfa-reset-notified',
    resourceType: 'user',
    resourceId: userId,
    metadata: { outcome },
  });
  return userResourceOf(db, target);
}

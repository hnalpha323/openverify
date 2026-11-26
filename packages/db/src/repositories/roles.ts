import { and, asc, count, eq, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../client.js';
import { organizations, roles, userRoles, users, type Role } from '../schema.js';
import {
  newestFirst,
  paginate,
  type CursorTable,
  type Page,
  type PageRequest,
} from './pagination.js';
import { firstOrNull, inserted } from './rows.js';

/** A C15 built-in role as `@openverify/core` defines it. */
export interface BuiltinRoleDefinition {
  key: string;
  name: string;
  permissions: readonly string[];
}

export interface NewRoleInput {
  id: string;
  name: string;
  /** A subset of `PERMISSIONS` (checked by the API). */
  permissions: readonly string[];
}

export interface RoleChanges {
  name?: string;
  permissions?: readonly string[];
}

export interface CountActiveUsersOptions {
  /** Leave this user out, e.g. the one being demoted or deactivated. */
  excludingUserId?: string;
}

/** `deleteRole` outcome: C15 forbids deleting built-in roles and roles in use (409). */
export type DeleteRoleResult = 'deleted' | 'not_found' | 'builtin' | 'in_use';

const roleCursor: CursorTable = {
  table: roles,
  id: roles.id,
  scope: roles.organizationId,
  createdAt: roles.createdAt,
};

const roleInOrganization = (organizationId: string, id: string) =>
  and(eq(roles.id, id), eq(roles.organizationId, organizationId));

/**
 * Locks the organization's row until the caller's transaction ends, so changes that must
 * respect "the last active admin stays" (C15) are serialized per organization. Returns
 * `false` when the organization does not exist.
 */
export async function lockOrganization(db: Db, organizationId: string): Promise<boolean> {
  const rows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .for('update');
  return rows.length > 0;
}

/**
 * Makes the organization's built-in roles match `definitions`: missing ones are created
 * (ids from `newId`), existing ones (by key) get the definition's name and permissions.
 * Idempotent; run it when an organization is created and when the API starts, so built-in
 * roles follow `@openverify/core`. Returns the roles in definition order.
 */
export async function syncBuiltinRoles(
  db: Db,
  organizationId: string,
  definitions: readonly BuiltinRoleDefinition[],
  newId: () => string,
): Promise<Role[]> {
  return db.transaction(async (tx) => {
    const synced: Role[] = [];
    for (const definition of definitions) {
      const rows = await tx
        .insert(roles)
        .values({
          id: newId(),
          organizationId,
          key: definition.key,
          name: definition.name,
          builtin: true,
          permissions: [...definition.permissions],
        })
        .onConflictDoUpdate({
          target: [roles.organizationId, roles.key],
          targetWhere: sql`"key" IS NOT NULL`,
          set: { name: definition.name, permissions: [...definition.permissions] },
        })
        .returning();
      synced.push(inserted(rows, 'syncBuiltinRoles'));
    }
    return synced;
  });
}

/** C15 `POST /roles`: a custom role. */
export async function createRole(
  db: Db,
  organizationId: string,
  input: NewRoleInput,
): Promise<Role> {
  const rows = await db
    .insert(roles)
    .values({
      id: input.id,
      organizationId,
      name: input.name,
      permissions: [...input.permissions],
    })
    .returning();
  return inserted(rows, 'createRole');
}

export async function getRole(db: Db, organizationId: string, id: string): Promise<Role | null> {
  return firstOrNull(
    await db.select().from(roles).where(roleInOrganization(organizationId, id)).limit(1),
  );
}

/** C15 `GET /roles`: newest first. */
export async function listRoles(
  db: Db,
  organizationId: string,
  page: PageRequest = {},
): Promise<Page<Role>> {
  return paginate(db, roleCursor, organizationId, page, (after, limit) =>
    db
      .select()
      .from(roles)
      .where(and(eq(roles.organizationId, organizationId), after))
      .orderBy(...newestFirst(roleCursor))
      .limit(limit),
  );
}

/**
 * C15 `PATCH /roles/:id`, custom roles only: `null` for a built-in role or one that is not
 * in this organization.
 */
export async function updateRole(
  db: Db,
  organizationId: string,
  id: string,
  changes: RoleChanges,
): Promise<Role | null> {
  const set: Partial<typeof roles.$inferInsert> = {};
  if (changes.name !== undefined) set.name = changes.name;
  if (changes.permissions !== undefined) set.permissions = [...changes.permissions];
  if (Object.keys(set).length === 0) {
    const role = await getRole(db, organizationId, id);
    return role?.builtin === false ? role : null;
  }
  return firstOrNull(
    await db
      .update(roles)
      .set(set)
      .where(and(roleInOrganization(organizationId, id), eq(roles.builtin, false)))
      .returning(),
  );
}

/** C15 `DELETE /roles/:id`: custom roles that nobody holds. */
export async function deleteRole(
  db: Db,
  organizationId: string,
  id: string,
): Promise<DeleteRoleResult> {
  return db.transaction(async (tx) => {
    const role = firstOrNull(
      await tx.select().from(roles).where(roleInOrganization(organizationId, id)).for('update'),
    );
    if (role === null) {
      return 'not_found';
    }
    if (role.builtin) {
      return 'builtin';
    }
    const [holders] = await tx
      .select({ count: count() })
      .from(userRoles)
      .where(and(eq(userRoles.organizationId, organizationId), eq(userRoles.roleId, id)));
    if ((holders?.count ?? 0) > 0) {
      return 'in_use';
    }
    await tx.delete(roles).where(roleInOrganization(organizationId, id));
    return 'deleted';
  });
}

/**
 * Replaces the user's roles (C15 `PATCH /users/:id` `role-ids`). The database refuses a
 * role of another organization.
 */
export async function setUserRoles(
  db: Db,
  organizationId: string,
  userId: string,
  roleIds: readonly string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(userRoles)
      .where(and(eq(userRoles.organizationId, organizationId), eq(userRoles.userId, userId)));
    const unique = [...new Set(roleIds)];
    if (unique.length > 0) {
      await tx
        .insert(userRoles)
        .values(unique.map((roleId) => ({ organizationId, userId, roleId })));
    }
  });
}

/** The roles a user holds, oldest first. */
export async function listUserRoles(
  db: Db,
  organizationId: string,
  userId: string,
): Promise<Role[]> {
  const rows = await db
    .select({ role: roles })
    .from(userRoles)
    .innerJoin(
      roles,
      and(eq(roles.organizationId, userRoles.organizationId), eq(roles.id, userRoles.roleId)),
    )
    .where(and(eq(userRoles.organizationId, organizationId), eq(userRoles.userId, userId)))
    .orderBy(asc(roles.createdAt), asc(roles.id));
  return rows.map((row) => row.role);
}

/**
 * C167.2 (Workflow 9B Stage 1b (U)): a role a user holds and where: the environments it is granted
 * in, or `null` for every current and future one.
 */
export interface UserRoleAssignment {
  role: Role;
  environmentIds: string[] | null;
}

/** C167.2: the user's assignments with their environments, oldest role first. */
export async function listUserRoleAssignments(
  db: Db,
  organizationId: string,
  userId: string,
): Promise<UserRoleAssignment[]> {
  const rows = await db
    .select({ role: roles, environmentIds: userRoles.environmentIds })
    .from(userRoles)
    .innerJoin(
      roles,
      and(eq(roles.organizationId, userRoles.organizationId), eq(roles.id, userRoles.roleId)),
    )
    .where(and(eq(userRoles.organizationId, organizationId), eq(userRoles.userId, userId)))
    .orderBy(asc(roles.createdAt), asc(roles.id));
  return rows.map((row) => ({ role: row.role, environmentIds: row.environmentIds }));
}

/**
 * C167.2 (Workflow 9B; review F29): the SQL predicate "the `user_roles` row `assignment` (a table
 * alias, such as sql`ur`) reaches `environmentId`", for the Phase 8 resolutions written in SQL
 * (`visible-to-roles`, the case readers and writers, the notified users), which `packages/db` holds
 * and so cannot call the API's `services/access/`. An assignment reaches an environment when its
 * `environment_ids` is `NULL` (every current and future environment) or names it; the API's
 * `assignmentReaches` is the same rule. Owner: `api-access`.
 */
export type RoleAssignmentReaches = (assignment: SQL, environmentId: SQL | string) => SQL;

export const roleAssignmentReaches: RoleAssignmentReaches = (assignment, environmentId) =>
  sql`(${assignment}.environment_ids is null or ${environmentId} = any(${assignment}.environment_ids))`;

/** C15: a user's permissions are the union of their roles' permissions. */
export async function listUserPermissions(
  db: Db,
  organizationId: string,
  userId: string,
): Promise<string[]> {
  const permissions = new Set<string>();
  for (const role of await listUserRoles(db, organizationId, userId)) {
    for (const permission of role.permissions) {
      permissions.add(permission);
    }
  }
  return [...permissions];
}

/**
 * Active users holding the built-in role `key` organisation-wide (C15 "the last active admin cannot be
 * demoted or deactivated"). Call it after {@link lockOrganization}, in the transaction
 * that makes the change.
 */
export async function countActiveUsersWithRole(
  db: Db,
  organizationId: string,
  key: string,
  options: CountActiveUsersOptions = {},
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(distinct ${users.id})`.mapWith(Number) })
    .from(userRoles)
    .innerJoin(
      roles,
      and(eq(roles.organizationId, userRoles.organizationId), eq(roles.id, userRoles.roleId)),
    )
    .innerJoin(
      users,
      and(eq(users.organizationId, userRoles.organizationId), eq(users.id, userRoles.userId)),
    )
    .where(
      and(
        eq(userRoles.organizationId, organizationId),
        eq(roles.key, key),
        // C167.2: the built-in admin is assignable organisation-wide only, and grants nothing
        // through a narrower assignment, so only those count as the organisation's admins.
        isNull(userRoles.environmentIds),
        eq(users.status, 'active'),
        options.excludingUserId === undefined ? undefined : ne(users.id, options.excludingUserId),
      ),
    );
  return row?.count ?? 0;
}

/** Roles by id, inside the organization (to validate `role-ids`). */
export async function getRoles(
  db: Db,
  organizationId: string,
  ids: readonly string[],
): Promise<Role[]> {
  if (ids.length === 0) {
    return [];
  }
  return db
    .select()
    .from(roles)
    .where(and(eq(roles.organizationId, organizationId), inArray(roles.id, [...ids])));
}

/**
 * C167.2 (Workflow 9B, `api-access`): one assignment to store: a role and the environments it is
 * granted in, or `null` for every current and future one.
 */
export interface RoleAssignmentInput {
  roleId: string;
  environmentIds: readonly string[] | null;
}

/**
 * C167.3 `PUT /dashboard/users/:id/roles`: replaces every assignment of the user, each role once.
 * The database refuses a role of another organization (composite foreign key) and an environment
 * list outside 1 to 20 `env_` ids (`user_roles_environment_ids_valid`); the API checks that each id
 * is an environment of the organization.
 */
export async function setUserRoleAssignments(
  db: Db,
  organizationId: string,
  userId: string,
  assignments: readonly RoleAssignmentInput[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(userRoles)
      .where(and(eq(userRoles.organizationId, organizationId), eq(userRoles.userId, userId)));
    if (assignments.length > 0) {
      await tx.insert(userRoles).values(
        assignments.map((assignment) => ({
          organizationId,
          userId,
          roleId: assignment.roleId,
          environmentIds:
            assignment.environmentIds === null ? null : [...assignment.environmentIds],
        })),
      );
    }
  });
}

/** C167.3 `GET /dashboard/roles/grantable`: every role of the organization, oldest first. */
export async function listOrganizationRoles(db: Db, organizationId: string): Promise<Role[]> {
  return db
    .select()
    .from(roles)
    .where(eq(roles.organizationId, organizationId))
    .orderBy(asc(roles.createdAt), asc(roles.id));
}

/**
 * C167.2: where a role is assigned: each assignment's environments, `null` for an organisation-wide
 * one (editing a role's permissions needs them in every environment where it is assigned).
 */
export async function listRoleAssignmentEnvironments(
  db: Db,
  organizationId: string,
  roleId: string,
): Promise<(string[] | null)[]> {
  const rows = await db
    .select({ environmentIds: userRoles.environmentIds })
    .from(userRoles)
    .where(and(eq(userRoles.organizationId, organizationId), eq(userRoles.roleId, roleId)));
  return rows.map((row) => row.environmentIds);
}
